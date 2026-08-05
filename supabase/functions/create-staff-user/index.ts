// supabase/functions/create-staff-user/index.ts
// Admin 后台创建员工账号（checker / warehouse / finance / admin）
//
// 用法：
//   POST {SUPABASE_URL}/functions/v1/create-staff-user
//   body: { email, password, role, full_name, phone? }
//   auth: 当前 admin 用户的 JWT
//
// 流程（admin 必须已登录，且 role=admin）：
//   1. 验证调用方是 admin
//   2. 验证 role 在合法清单
//   3. 验证 password 强度
//   4. service_role.auth.admin.createUser(email, password, email_confirm=true)
//   5. 显式写 public.users(id, account_id=_internal, role, full_name, phone)
//      — 防止 trg_handle_new_user 写入的默认值覆盖我们想要的 role
//
// 错误响应：
//   400 input invalid
//   401 caller not admin
//   409 email already exists
//   500 supabase internal error
//
// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ALLOWED_ORIGINS = [
  '.vercel.app',
  'localhost:5173',
  'localhost:4173',
  '127.0.0.1:5173',
  '127.0.0.1:4173',
]

const STAFF_ROLES = ['admin', 'checker', 'warehouse', 'finance']
const PASSWORD_MIN = 8
const INTERNAL_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000'

function originAllowed(origin: string): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return ALLOWED_ORIGINS.some((s) => u.host.endsWith(s))
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (!originAllowed(origin)) {
    return json({ error: 'forbidden origin', got: origin }, 403)
  }

  // 1. 验证 JWT：调用方必须已登录
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return json({ error: 'missing authorization header' }, 401)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json body' }, 400)
  }

  const { email, password, role, full_name, phone } = body ?? {}
  if (!email || !password || !role || !full_name) {
    return json({ error: 'email/password/role/full_name 都是必填' }, 400)
  }
  if (!STAFF_ROLES.includes(role)) {
    return json({ error: `role 必须为以下之一: ${STAFF_ROLES.join('/')}` }, 400)
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return json({ error: `password 长度至少 ${PASSWORD_MIN} 位` }, 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'email 格式不正确' }, 400)
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // 2. 验证调用方是 admin（用 service_role 查 caller 自己的 profile）
    const { data: callerUser, error: callerErr } = await supabaseAdmin.auth.getUser(jwt)
    if (callerErr || !callerUser?.user) {
      return json({ error: 'invalid authorization token' }, 401)
    }
    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', callerUser.user.id)
      .single()
    if (profileErr || !callerProfile) {
      return json({ error: 'caller profile not found' }, 401)
    }
    if (callerProfile.role !== 'admin') {
      return json({ error: '需 admin 权限' }, 403)
    }

    // 3. 创建 auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // metadata 也会被 trg_handle_new_user 读，但我们之后会显式 upsert 覆盖
      user_metadata: { role, full_name },
    })

    let userId: string | null = null
    if (createErr) {
      // email 已存在 → 用现有用户的 id，把 role 字段对齐（不改密码）
      if (createErr.message?.toLowerCase().includes('already') || createErr.status === 422) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers()
        const existing = list?.users?.find((u) => u.email === email)
        if (!existing) {
          return json({ error: 'email 已注册但查找失败' }, 500)
        }
        userId = existing.id
      } else {
        return json({ error: `createUser failed: ${createErr.message}` }, 500)
      }
    } else {
      userId = created?.user?.id ?? null
    }
    if (!userId) return json({ error: 'no user id returned' }, 500)

    // 4. 显式写 public.users，覆盖 trigger 默认值
    //    - account_id = _internal 哨兵
    //    - is_main = false（员工不是主联系）
    const { error: upsertErr } = await supabaseAdmin
      .from('users')
      .upsert({
        id: userId,
        account_id: INTERNAL_ACCOUNT_ID,
        role,
        is_main: false,
        full_name,
        phone: phone || null,
      }, { onConflict: 'id' })

    if (upsertErr) {
      return json({
        error: `auth users created but profile upsert failed: ${upsertErr.message}`,
        user_id: userId,
      }, 500)
    }

    return json({ ok: true, user_id: userId, role })
  } catch (e: any) {
    console.error('[create-staff-user] top-level error:', e?.message, e?.stack)
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
