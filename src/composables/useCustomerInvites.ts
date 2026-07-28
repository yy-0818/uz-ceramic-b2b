/**
 * useCustomerInvites.ts
 * 客户邀请链接管理 composable —— 邀请历史 / 作废 / 重新生成
 */
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked'

export interface CustomerInvite {
  id: string
  account_id: string
  token: string
  expires_at: string
  used_at: string | null
  used_by: string | null        // auth.users.id（激活人）
  created_by: string | null
  created_by_name: string | null
  created_at: string
  status: InviteStatus
  // joined
  account_name?: string
  login_email?: string
}

export interface InviteWithLogin extends CustomerInvite {
  login_email: string
  account_name: string
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------
export function useCustomerInvites() {
  const loading = ref(false)
  const invites = ref<CustomerInvite[]>([])

  // ---------------------------------------------------------------------------
  // 拉指定父账号的邀请历史（按 created_at 倒序）
  // ---------------------------------------------------------------------------
  const fetchForAccount = async (accountId: string): Promise<CustomerInvite[]> => {
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('customer_invites')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })

      if (error) throw error
      invites.value = (data ?? []) as CustomerInvite[]
      return invites.value
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // 拉全部历史（admin overview）
  // ---------------------------------------------------------------------------
  const fetchAll = async (): Promise<CustomerInvite[]> => {
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('customer_invites')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      invites.value = (data ?? []) as CustomerInvite[]
      return invites.value
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // RPC：作废一个邀请（pending / expired / revoked 状态可作废）
  // ---------------------------------------------------------------------------
  const revokeInvite = async (inviteId: string): Promise<void> => {
    loading.value = true
    try {
      const { error } = await supabase.rpc('fn_revoke_invite', { inv_id: inviteId })
      if (error) throw error
      // 本地乐观更新
      const idx = invites.value.findIndex((i) => i.id === inviteId)
      if (idx !== -1) invites.value[idx] = { ...invites.value[idx], status: 'revoked' }
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // RPC：重新生成邀请（自动作废旧记录、插入新记录）
  // ---------------------------------------------------------------------------
  const regenerateInvite = async (inviteId: string): Promise<CustomerInvite> => {
    loading.value = true
    try {
      const { data, error } = await supabase.rpc('fn_regenerate_invite', { inv_id: inviteId })
      if (error) throw error
      // 本地替换旧记录（把旧 record 替换成新 record）
      const idx = invites.value.findIndex((i) => i.id === inviteId)
      if (idx !== -1) {
        invites.value[idx] = data as CustomerInvite
      } else {
        // 列表里没找到（说明不是当前账号的历史）——追加到顶部
        invites.value.unshift(data as CustomerInvite)
      }
      return data as CustomerInvite
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // computed：统计
  // ---------------------------------------------------------------------------
  const stats = computed(() => ({
    total: invites.value.length,
    pending: invites.value.filter((i) => i.status === 'pending').length,
    used: invites.value.filter((i) => i.status === 'used').length,
    expired: invites.value.filter((i) => i.status === 'expired').length,
    revoked: invites.value.filter((i) => i.status === 'revoked').length,
  }))

  return {
    loading: computed(() => loading.value),
    invites,
    stats,
    fetchForAccount,
    fetchAll,
    revokeInvite,
    regenerateInvite,
  }
}
