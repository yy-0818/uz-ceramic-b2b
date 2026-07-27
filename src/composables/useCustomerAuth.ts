/**
 * useCustomerAuth —— 客户登录 / 邀请 / 重置密码
 *
 * 业务规则：
 *   - 客户登录 = 父账号 login_email + 密码（auth.users 双重生成）
 *   - accounts.login_email + accounts.user_id 唯一对应一个 auth user
 *   - 子账号共享父.user_id（不单独登录）
 *
 * API:
 *   - createInvite(parentId)                  生成邀请链接（7 天有效）
 *   - resetPassword(parentId, newPassword)    admin 重置密码 → 拿到临时密码
 *   - completeInvite(token, password)         客户点链接 → 设密码
 *   - bindLoginEmail(parentId, email)         把父账号绑到 auth.users
 *   - signIn(email, password)                 客户登录
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

const INVITE_TTL_DAYS = 7

export interface CustomerInvite {
  id: string
  account_id: string
  token: string
  expires_at: string
  used_at: string | null
  created_at: string
}

function generateToken(): string {
  // 22 字节 base64url = 30 字符左右
  const buf = new Uint8Array(22)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function useCustomerAuth() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 给父账号发邀请链接
   * 流程：
   *   1. 拉父账号的 login_email（优先用 admin 在 UI 填的；为空则按 name 生成占位邮箱）
   *   2. 生成 token
   *   3. 写 customer_invites
   *   4. 返回 token + 完整 URL + 客户登录邮箱
   */
  const createInvite = async (
    parentId: string,
    parentName: string,
    parentAccountId: string,
  ): Promise<{ token: string; url: string; loginEmail: string; emailSource: 'preset' | 'generated' }> => {
    loading.value = true
    try {
      // 1. 拉父账号 login_email（admin 在 UI 里可填）
      const { data: parent } = await supabase
        .from('accounts')
        .select('login_email, account_name')
        .eq('id', parentId)
        .single()
      const parentRow = parent as { login_email: string | null; account_name: string } | null
      let loginEmail = parentRow?.login_email?.trim()
      let emailSource: 'preset' | 'generated' = 'preset'
      if (!loginEmail) {
        const safe = (parentName || parentRow?.account_name || 'customer')
          .replace(/\s+/g, '_').toLowerCase()
        loginEmail = `${safe}_${parentAccountId.slice(0, 8)}@customer.local`
        emailSource = 'generated'
      }

      // 2. 生成 token
      const token = generateToken()
      const expires = new Date()
      expires.setDate(expires.getDate() + INVITE_TTL_DAYS)
      const { error: e } = await supabase.from('customer_invites').insert({
        account_id: parentId,
        token,
        expires_at: expires.toISOString(),
        created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      } as any)
      if (e) throw e
      const origin = window.location.origin
      const url = `${origin}/customer-invite?token=${token}`
      return { token, url, loginEmail, emailSource }
    } finally {
      loading.value = false
    }
  }

  /**
   * 验证 token，返回该 token 对应的 account_id（用于 Invite 页面）
   */
  const validateInvite = async (token: string): Promise<{ accountId: string; expiresAt: string } | null> => {
    const { data, error: e } = await supabase
      .from('customer_invites')
      .select('account_id, expires_at, used_at')
      .eq('token', token)
      .single()
    if (e || !data) return null
    const d = data as any
    if (d.used_at) return null
    if (new Date(d.expires_at) < new Date()) return null
    return { accountId: d.account_id, expiresAt: d.expires_at }
  }

  /**
   * 客户点邀请链接 → 设置密码 → 流量：
   *   1. 验证 token（validateInvite）
   *   2. 创建 auth.users（admin SDK）或调用 admin 端 API
   *   3. 写 accounts.login_email + accounts.user_id
   *   4. 标记 invite.used_at
   *
   * 注意：创建 auth.users 需要 service_role 密钥（不能直接前端调）。
   * 本函数假设前端被管理员代理：客户填完表单后调一个 Edge Function。
   * 这里实现的是占位：
   *   - 如果 SUPABASE_FUNCTIONS_URL 已配，则 POST 到 /functions/v1/complete-invite
   *   - 否则报"未启用"错误
   */
  const completeInvite = async (token: string, password: string, loginEmail: string): Promise<void> => {
    loading.value = true
    try {
      const fnUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim()
      const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
      if (!fnUrl) {
        throw new Error('邀请完成功能未启用（缺 VITE_SUPABASE_FUNCTIONS_URL）。请管理员先帮客户设密码。')
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      // apikey header：complete-invite 网关 verify_jwt=false，但仍透传 apikey
      // 让 Supabase Auth API 自身速率限制 + 后端日志关联生效
      if (anonKey) headers['apikey'] = anonKey
      const res = await fetch(`${fnUrl}/complete-invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token, password, login_email: loginEmail }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || '邀请完成失败')
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * admin 重置密码：拿到一个新的临时密码返回
   * 真实调用 Edge Function（service_role 修改密码）
   * 前端必须带上 admin 的 session token（Edge Function 内部校验 admin 角色）
   */
  const resetPassword = async (parentId: string): Promise<string> => {
    loading.value = true
    try {
      const fnUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim()
      if (!fnUrl) {
        throw new Error('重置密码功能未启用（缺 VITE_SUPABASE_FUNCTIONS_URL）')
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('需要登录管理员账号才能重置密码')
      }
      const res = await fetch(`${fnUrl}/reset-customer-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parent_id: parentId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || '重置失败')
      }
      const { temp_password } = await res.json()
      return temp_password
    } finally {
      loading.value = false
    }
  }

  /**
   * 父账号绑定登录邮箱（创建/复用 auth user）
   * 同上：需要 Edge Function（service_role）+ admin token
   */
  const bindLoginEmail = async (parentId: string, email: string, password: string): Promise<void> => {
    loading.value = true
    try {
      const fnUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim()
      if (!fnUrl) {
        throw new Error('绑定邮箱功能未启用')
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('需要登录管理员账号')
      }
      const res = await fetch(`${fnUrl}/bind-customer-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parent_id: parentId, email, password }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || '绑定失败')
      }
    } finally {
      loading.value = false
    }
  }

  /** 客户登录（直接调 supabase.auth.signInWithPassword） */
  const signIn = async (email: string, password: string) => {
    const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
    if (e) throw e
    return data
  }

  return {
    loading, error,
    createInvite, validateInvite, completeInvite,
    resetPassword, bindLoginEmail, signIn,
  }
}
