// supabase/functions/complete-invite/index.ts
// Customer flow: 客户点邀请链接 → 提交密码
// 1. 验证 customer_invites token
// 2. 在 auth.users 创建账号（用 accounts.login_email）
// 3. 写 accounts.user_id
// 4. 标记 invite.used_at
//
// 需要 service_role（env.SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动注入）

// @ts-nocheck  // Deno edge function, no local types
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }
  try {
    const { token, password, login_email } = await req.json()
    if (!token || !password || !login_email) {
      return json({ error: 'missing token/password/email' }, 400)
    }
    if (password.length < 8) {
      return json({ error: 'password too short (>=8)' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // 1. 验证 invite
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('customer_invites')
      .select('*')
      .eq('token', token)
      .single()
    if (invErr || !inv) return json({ error: 'invite not found' }, 404)
    if (inv.used_at) return json({ error: 'invite already used' }, 410)
    if (new Date(inv.expires_at) < new Date()) {
      return json({ error: 'invite expired' }, 410)
    }

    // 2. 创建 auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: login_email,
      password,
      email_confirm: true,
    })
    if (createErr) {
      // 已存在的 user → 重置密码
      if (createErr.message?.includes('already') || createErr.status === 422) {
        // 找到现有 user，按 email 查
        const { data: list } = await supabaseAdmin.auth.admin.listUsers()
        const existing = list?.users?.find((u) => u.email === login_email)
        if (!existing) return json({ error: 'user already exists but not findable' }, 500)
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
          existing.id,
          { password },
        )
        if (updErr) return json({ error: updErr.message }, 500)
        // 继续用 existing.id
        await bindAndMark(inv.account_id, existing.id, inv.id, supabaseAdmin)
        return json({ ok: true, user_id: existing.id, mode: 'reset' })
      }
      return json({ error: createErr.message }, 500)
    }
    const userId = created.user?.id
    if (!userId) return json({ error: 'no user id returned' }, 500)
    await bindAndMark(inv.account_id, userId, inv.id, supabaseAdmin)
    return json({ ok: true, user_id: userId, mode: 'create' })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})

async function bindAndMark(accountId, userId, inviteId, supabaseAdmin) {
  // 1. 写 accounts.user_id + accounts.login_email
  await supabaseAdmin
    .from('accounts')
    .update({
      user_id: userId,
      login_email: (await supabaseAdmin.from('accounts').select('login_email').eq('id', accountId).single()).data?.login_email,
    })
    .eq('id', accountId)
  // 2. 标记 invite.used_at
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
