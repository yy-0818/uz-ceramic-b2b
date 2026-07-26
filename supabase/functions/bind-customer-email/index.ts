// supabase/functions/bind-customer-email/index.ts
// Admin flow: 把一个父账号绑到一个已存在的 auth user（不需要新 invite）
// 实际场景：admin 帮你建过客户 → 现在想让客户能登录
// 1. 拉 accounts.user_id (可能 null)
// 2. 在 auth.users 创建一个 user（email = 父.login_email，密码 = 入参）
// 3. 写 accounts.user_id

// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  try {
    const { parent_id, password, login_email } = await req.json()
    if (!parent_id || !password || !login_email) {
      return json({ error: 'missing parent_id/password/email' }, 400)
    }
    if (password.length < 8) return json({ error: 'password too short' }, 400)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // 1. 拉父账号
    const { data: acc, error: aErr } = await supabaseAdmin
      .from('accounts')
      .select('id, user_id')
      .eq('id', parent_id)
      .single()
    if (aErr || !acc) return json({ error: 'account not found' }, 404)
    if (acc.user_id) return json({ error: '该主账号已绑定用户' }, 400)

    // 2. 创建 auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: login_email,
      password,
      email_confirm: true,
    })
    if (createErr) return json({ error: createErr.message }, 500)
    const userId = created.user?.id
    if (!userId) return json({ error: 'no user id' }, 500)

    // 3. 写 accounts
    const { error: updErr } = await supabaseAdmin
      .from('accounts')
      .update({ user_id: userId, login_email })
      .eq('id', parent_id)
    if (updErr) return json({ error: updErr.message }, 500)

    return json({ ok: true, user_id: userId })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
