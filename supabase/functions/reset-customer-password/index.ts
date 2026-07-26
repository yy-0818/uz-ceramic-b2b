// supabase/functions/reset-customer-password/index.ts
// Admin flow: 重置主账号对应的客户密码 → 返回 temp password
// 1. 拉 accounts.user_id + accounts.login_email
// 2. 生成随机临时密码
// 3. 用 service_role 改密码
// 4. 把所有未使用的 invite 标 used（防止旧链接被用）

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
    const { parent_id } = await req.json()
    if (!parent_id) return json({ error: 'missing parent_id' }, 400)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // 1. 拉父账号
    const { data: acc, error: aErr } = await supabaseAdmin
      .from('accounts')
      .select('id, user_id, login_email, account_name')
      .eq('id', parent_id)
      .single()
    if (aErr || !acc) return json({ error: 'account not found' }, 404)
    if (!acc.user_id) return json({ error: '该主账号尚未绑登录账号，请先邀请客户登录' }, 400)
    if (!acc.login_email) return json({ error: '该主账号没有 login_email' }, 400)

    // 2. 生成临时密码
    const tempPassword = generatePassword()

    // 3. 改密码
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      acc.user_id,
      { password: tempPassword },
    )
    if (updErr) return json({ error: updErr.message }, 500)

    // 4. 标记未使用的 invite 为 used
    await supabaseAdmin
      .from('customer_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('account_id', parent_id)
      .is('used_at', null)

    return json({ ok: true, temp_password: tempPassword, email: acc.login_email })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

function generatePassword() {
  // 12 字符，包含大小写 + 数字
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const num = '23456789'
  const all = upper + lower + num
  let s = ''
  s += upper[Math.floor(Math.random() * upper.length)]
  s += lower[Math.floor(Math.random() * lower.length)]
  s += num[Math.floor(Math.random() * num.length)]
  for (let i = 0; i < 9; i++) s += all[Math.floor(Math.random() * all.length)]
  // shuffle
  return s.split('').sort(() => Math.random() - 0.5).join('')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
