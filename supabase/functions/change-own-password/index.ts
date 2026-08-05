// supabase/functions/change-own-password/index.ts
// 通用入口：登录用户改自己的密码（客户 + 员工）
//   1. 校验调用者是有效登录用户（拿自己的 session JWT）
//   2. 验证当前密码（旧密码）— 通过 signInWithPassword 比对，避免泄漏 service_role
//   3. 用 updateUserById 改密码（service_role）
//
// 安全要点：
//   - 必须已登录：网关 verify_jwt=true
//   - 必须验证旧密码：防止"被盗用 cookie 时改密码"
//
// 注意：Supabase Auth 改密码后旧 session 默认仍有效（直到 access_token 过期，约 1h）
// 这是 Supabase 默认行为。如需立即作废旧 session，需额外加 logout all sessions。

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  // 1. 校验 token (网关 verify_jwt=true 已校验 JWT 签名, 这里再校验 user 存在)
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return json({ error: 'missing bearer token' }, 401)
  }
  const jwt = auth.slice(7)

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(jwt)
  if (callerErr || !callerData?.user) {
    return json({ error: 'invalid token' }, 401)
  }
  const userId = callerData.user.id
  const email = callerData.user.email
  if (!email) return json({ error: 'user has no email' }, 400)

  try {
    const { current_password, new_password } = await req.json()
    if (!current_password || !new_password) {
      return json({ error: 'missing current_password/new_password' }, 400)
    }
    if (new_password.length < 8) {
      return json({ error: '新密码长度至少 8 位' }, 400)
    }
    if (current_password === new_password) {
      return json({ error: '新密码不能与旧密码相同' }, 400)
    }

    // 2. 验证旧密码 — 用一个独立 anon client 调 signInWithPassword
    //    不用 service_role 是因为: service_role 跳过 auth, 直接能改密码, 无法验证旧密码
    //    anon client 必须配上 url + anon key
    const supabaseAnon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await supabaseAnon.auth.signInWithPassword({
      email,
      password: current_password,
    })
    if (signInErr) {
      console.log('[change-own-password] old password verify failed:', signInErr.message)
      return json({ error: '当前密码不正确' }, 401)
    }

    // 3. 改密码
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: new_password })
    if (updErr) return json({ error: updErr.message }, 500)

    return json({ ok: true, user_id: userId })
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
