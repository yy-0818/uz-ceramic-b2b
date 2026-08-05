// supabase/functions/bind-customer-email/index.ts
// Admin flow: 把一个父账号绑到一个已存在的 auth user（不需要新 invite）
// 实际场景：admin 帮你建过客户 → 现在想让客户能登录
//   1. 校验调用者是 admin
//   2. 拉 accounts.user_id (可能 null)
//   3. 在 auth.users 创建一个 user（email = 入参，密码 = 入参）
//   4. 写 accounts.user_id + accounts.login_email
//   5. 写 public.users（role=customer, account_id=父账号）

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const ctx = await requireAdmin(req)
  if (!ctx.ok) return ctx.response

  try {
    const { parent_id, password, login_email } = await req.json()
    if (!parent_id || !password || !login_email) {
      return json({ error: 'missing parent_id/password/email' }, 400)
    }
    if (password.length < 8) return json({ error: 'password too short' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login_email)) {
      return json({ error: 'invalid email' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // 2. 拉父账号
    const { data: acc, error: aErr } = await supabaseAdmin
      .from('accounts')
      .select('id, user_id, account_name')
      .eq('id', parent_id)
      .single()
    if (aErr || !acc) return json({ error: 'account not found' }, 404)
    if (acc.user_id) return json({ error: '该主账号已绑定用户' }, 400)

    // 3. 创建 auth user（必须 metadata role=customer 让 trigger 跳过，
    //    这里显式 metadata 是为了即使将来 trigger 改了也能安全）
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: login_email,
      password,
      email_confirm: true,
      user_metadata: { role: 'customer', account_name: acc.account_name },
    })
    if (createErr) return json({ error: createErr.message }, 500)
    const userId = created.user?.id
    if (!userId) return json({ error: 'no user id' }, 500)

    // 4. 写 accounts
    const { error: updErr } = await supabaseAdmin
      .from('accounts')
      .update({ user_id: userId, login_email })
      .eq('id', parent_id)
    if (updErr) return json({ error: updErr.message }, 500)

    // 5. 写 public.users.
    //    如果失败, accounts 已绑 login_email + user_id 但 public.users 没更新
    //    → 客户登录后角色不对 (触发器推断角色失败).
    //    显式检测错误并清理 accounts 绑回, 让 admin 可重试.
    const { error: usersErr } = await supabaseAdmin.from('users').upsert(
      {
        id: userId,
        account_id: parent_id,
        role: 'customer',
        is_main: true,
        full_name: acc.account_name,
      },
      { onConflict: 'id' },
    )
    if (usersErr) {
      console.log('[bind-customer-email] users upsert failed, rolling back accounts:', usersErr.message)
      // 回滚 accounts 绑定 (auth.users 已创建, 这里只能清掉 user_id 让 admin 重试)
      await supabaseAdmin.from('accounts').update({ user_id: null, login_email: null }).eq('id', parent_id)
      return json({ error: `users 写入失败: ${usersErr.message}` }, 500)
    }

    return json({ ok: true, user_id: userId })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

async function requireAdmin(req: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, response: json({ error: 'missing bearer token' }, 401) }
  }
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const token = auth.slice(7)
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    return { ok: false, response: json({ error: 'invalid token' }, 401) }
  }
  const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', data.user.id).single()
  if (profile?.role !== 'admin') {
    return { ok: false, response: json({ error: 'admin only' }, 403) }
  }
  return { ok: true }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
