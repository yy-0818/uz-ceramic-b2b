// supabase/functions/complete-invite/index.ts
// Customer flow: 客户点邀请链接 → 提交密码
//   1. 验证 customer_invites token
//   2. 在 auth.users 创建账号（用 accounts.login_email）
//   3. 写 accounts.user_id
//   4. 写 public.users（role=customer，account_id=父账号.id）
//   5. 标记 invite.used_at
//
// 公开端点：客户点链接不需要登录（token 本身就是凭证）。
// 网关 JWT 校验已关闭（supabase/config.toml: verify_jwt = false），
// 故此函数必须自实现防护：
//   - Origin / Referer 白名单（同站请求，防止跨站滥用）
//   - 失败计数：超过 5 次错误 token → 401 锁定 60s（KV 计数）
//
// 需要 service_role（env.SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动注入）

// @ts-nocheck  // Deno edge function, no local types
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Origin 白名单：生产域名 + Vercel preview + localhost
// 模式匹配：字符串后缀匹配 (a.endsWith)，以便覆盖 vercel.app preview 子域
const ORIGIN_SUFFIXES = [
  '.vercel.app',              // Vercel 任意 preview / production 子域
  'localhost:5173',
  'localhost:4173',
  '127.0.0.1:5173',
  '127.0.0.1:4173',
]

function originAllowed(origin: string): boolean {
  try {
    const u = new URL(origin)
    return ORIGIN_SUFFIXES.some(s => u.origin.endsWith(s) || u.host.endsWith(s))
  } catch {
    return false
  }
}
const MAX_FAILS = 5
const LOCKOUT_MS = 60_000

// IP-based fail counter (in-memory, best-effort)
// Edge function 多实例间 KV 不一致；只用 in-memory 限频是软限制，
// 真正的硬限靠 Supabase Auth API 自身的速率限制 + token 一次性消费。
const failCount = new Map<string, { count: number; lockUntil: number }>()
function recordFail(ip: string) {
  const now = Date.now()
  const entry = failCount.get(ip)
  if (!entry || entry.lockUntil < now) {
    failCount.set(ip, { count: 1, lockUntil: 0 })
    return false
  }
  entry.count += 1
  if (entry.count >= MAX_FAILS) {
    entry.lockUntil = now + LOCKOUT_MS
    return true   // locked
  }
  return false
}
function isLocked(ip: string): boolean {
  const entry = failCount.get(ip)
  return !!entry && entry.lockUntil > Date.now()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // 1. Origin 校验（公开端点必加）
  //    暂记录所有 origin 到日志以便诊断；按 ORIGIN_SUFFIXES 白名单拒
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (!originAllowed(origin)) {
    console.log('[complete-invite] origin rejected:', JSON.stringify(origin))
    return json({ error: 'forbidden origin', got: origin }, 403)
  }

  // 2. 简易速率限制
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('cf-connecting-ip') ?? 'unknown'
  if (isLocked(ip)) {
    return json({ error: 'too many failed attempts, retry later' }, 429)
  }

  try {
    const { token, password, login_email } = await req.json()
    console.log('[complete-invite] payload:', JSON.stringify({ token_len: token?.length, password_len: password?.length, login_email }))
    if (!token || !password || !login_email) {
      return json({ error: 'missing token/password/email' }, 400)
    }
    if (password.length < 8) {
      return json({ error: 'password too short (>=8)' }, 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login_email)) {
      return json({ error: 'invalid email' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    console.log('[complete-invite] env ok:', !!Deno.env.get('SUPABASE_URL'), !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

    // 3. 验证 invite
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('customer_invites')
      .select('*')
      .eq('token', token)
      .single()
    if (invErr || !inv) {
      console.log('[complete-invite] invite lookup err:', JSON.stringify(invErr))
      const locked = recordFail(ip)
      return json({ error: locked ? 'too many failed attempts, retry later' : 'invite not found' }, locked ? 429 : 404)
    }
    if (inv.used_at) return json({ error: 'invite already used' }, 410)
    if (new Date(inv.expires_at) < new Date()) {
      return json({ error: 'invite expired' }, 410)
    }

    // 4. 创建 auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: login_email,
      password,
      email_confirm: true,
    })
    console.log('[complete-invite] createUser ok:', !!created?.user?.id, createErr?.message)

    let userId: string | null = null
    let mode: 'create' | 'reset' = 'create'

    if (createErr) {
      if (createErr.message?.includes('already') || createErr.status === 422) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers()
        const existing = list?.users?.find((u) => u.email === login_email)
        if (!existing) return json({ error: 'user already exists but not findable' }, 500)
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
          existing.id,
          { password },
        )
        if (updErr) return json({ error: updErr.message }, 500)
        userId = existing.id
        mode = 'reset'
      } else {
        return json({ error: createErr.message }, 500)
      }
    } else {
      userId = created.user?.id
    }
    if (!userId) return json({ error: 'no user id returned' }, 500)

    // 5. 写 accounts.user_id + accounts.login_email + 6. 写 public.users + 7. 标 invite.used_at
    try {
      await bindAndMark(inv.account_id, userId, login_email, inv.id, supabaseAdmin)
    } catch (bindErr: any) {
      console.log('[complete-invite] bindAndMark err:', JSON.stringify(bindErr?.message ?? bindErr))
      return json({ error: `bind failed: ${bindErr?.message ?? bindErr}` }, 500)
    }

    return json({ ok: true, user_id: userId, mode })
  } catch (e: any) {
    console.log('[complete-invite] top-level err:', String(e?.message ?? e), e?.stack)
    return json({ error: String(e?.message ?? e), stack: e?.stack }, 500)
  }
})

async function bindAndMark(accountId, userId, loginEmail, inviteId, supabaseAdmin) {
  // 1. 写 accounts.user_id + accounts.login_email（用入参，不重读）
  await supabaseAdmin
    .from('accounts')
    .update({ user_id: userId, login_email: loginEmail })
    .eq('id', accountId)

  // 2. 写 public.users（role=customer，account_id=父账号）
  //    on conflict 用 update 确保重新 invite 时也能覆盖 role
  //    trigger trg_handle_new_user 对 role=customer 跳过，所以这里必须自己写
  await supabaseAdmin
    .from('users')
    .upsert({
      id: userId,
      account_id: accountId,
      role: 'customer',
      is_main: true,        // 客户登录默认主联系
      full_name: loginEmail, // 后续用户可在个人中心改
    }, { onConflict: 'id' })

  // 3. 标记 invite.used_at
  await supabaseAdmin
    .from('customer_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', inviteId)
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}