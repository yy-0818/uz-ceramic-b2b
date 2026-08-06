// supabase/functions/reset-staff-password/index.ts
// Admin flow: 重置员工 (admin/checker/warehouse/finance) 密码 → 返回 temp password
//   1. 校验调用者是 admin
//   2. 校验目标用户的 role 是 staff role (防止误重置 customer)
//   3. 生成随机临时密码
//   4. 用 service_role 改密码
//   5. 返回 temp password

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STAFF_ROLES = ['admin', 'checker', 'warehouse', 'finance']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const ctx = await requireAdmin(req)
  if (!ctx.ok) return ctx.response

  try {
    const { user_id } = await req.json()
    if (!user_id) return json({ error: 'missing user_id' }, 400)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // 1. 先用 getUserById 可靠地确认 auth user 存在（GoTrue API, bypass RLS）
    const { data: userData, error: uErr } = await supabaseAdmin.auth.admin.getUserById(user_id)
    if (uErr || !userData?.user) {
      console.log('[reset-staff-password] getUserById failed:', uErr?.message)
      return json({ error: 'auth 用户不存在' }, 404)
    }

    // 2. 查 public.users 获取 role（用于判断是否是员工账号）
    //    注意：PostgREST 查询可能因 RLS 返回空（服务角色 key 在某些配置下也会被 RLS 影响）
    //    → 用 maybeSingle(), 空结果不抛异常
    let role: string | null = null
    try {
      const { data: profile, error: pErr } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', user_id)
        .maybeSingle()
      if (pErr) {
        console.log('[reset-staff-password] users table query error:', pErr.message)
      }
      role = profile?.role ?? null
    } catch (e) {
      console.log('[reset-staff-password] users table exception:', String(e))
    }

    // 3. role 决定是否允许重置:
    //    - 空/null（RLS 查不到）→ 视为非员工账号，拒绝（安全优先）
    //    - staff role → 允许
    if (!role || !STAFF_ROLES.includes(role)) {
      return json({ error: '只能重置员工账号 (admin/checker/warehouse/finance)' }, 400)
    }

    // 4. 生成临时密码 + 改密码
    const email = userData.user.email
    const tempPassword = generatePassword()
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password: tempPassword })
    if (updErr) return json({ error: updErr.message }, 500)

    return json({ ok: true, temp_password: tempPassword, email: email ?? undefined })
  } catch (e: any) {
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
  const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', data.user.id).maybeSingle()
  if (!profile) {
    console.log('[reset-staff-password] requireAdmin: caller profile not found in users table, role unknown')
    return { ok: false, response: json({ error: 'caller profile not found' }, 401) }
  }
  if (profile.role !== 'admin') {
    return { ok: false, response: json({ error: 'admin only' }, 403) }
  }
  return { ok: true }
}

function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const num = '23456789'
  const all = upper + lower + num
  let s = ''
  s += upper[Math.floor(Math.random() * upper.length)]
  s += lower[Math.floor(Math.random() * lower.length)]
  s += num[Math.floor(Math.random() * num.length)]
  for (let i = 0; i < 9; i++) s += all[Math.floor(Math.random() * all.length)]
  return s
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
