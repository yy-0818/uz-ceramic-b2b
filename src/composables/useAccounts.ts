/**
 * useAccounts —— 账户列表（后台用），含客户组映射表
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type { AccountType, AccountStatus } from '@/types/database'

export interface AccountRow {
  id: string
  account_name: string
  company_name: string
  account_type: AccountType
  status: AccountStatus
  parent_id: string | null
}

export function useAccounts() {
  const items = ref<AccountRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchAll = async () => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('accounts')
      .select('id, account_name, company_name, account_type, status, parent_id')
      .order('account_type', { ascending: true })
      .order('account_name', { ascending: true })
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []) as AccountRow[]
    loading.value = false
    return items.value
  }

  return { items, loading, error, fetchAll }
}
