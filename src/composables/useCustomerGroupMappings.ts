/**
 * useCustomerGroupMappings —— 客户组 → 主账号 映射管理
 *
 * 业务逻辑：
 *   - 工厂 CSV 第 1 列 = "客户组"（如 S客户、A中鹏，共 34 个）
 *   - 管理员手动把客户组"拉取"到主账号（1_public / 2_cash / 3_export）
 *   - 映射完成后，导入库存时会自动写入 account_products 白名单
 *   - 1 个客户组可映射到多个主账号
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface CustomerGroupMapping {
  id: string
  customer_group: string
  account_id: string
  is_active: boolean
  remark: string | null
  account?: {
    id: string
    account_name: string
    account_type: string
  }
}

export function useCustomerGroupMappings() {
  const items = ref<CustomerGroupMapping[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchAll = async () => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('customer_group_mappings')
      .select('*, account:accounts(id, account_name, account_type)')
      .order('customer_group')
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []) as CustomerGroupMapping[]
    loading.value = false
    return items.value
  }

  /** 批量 upsert 映射（按 (customer_group, account_id) 联合唯一） */
  const bulkUpsert = async (rows: Array<{
    customer_group: string
    account_id: string
    is_active?: boolean
    remark?: string | null
  }>) => {
    if (rows.length === 0) return 0
    const { error: e, count } = await supabase
      .from('customer_group_mappings')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(rows as any, { onConflict: 'customer_group,account_id', count: 'exact' })
    if (e) { error.value = e.message; throw e }
    return count ?? rows.length
  }

  /** 删除某客户组映射 */
  const remove = async (id: string) => {
    const { error: e } = await supabase
      .from('customer_group_mappings')
      .delete()
      .eq('id', id)
    if (e) { error.value = e.message; throw e }
  }

  /** 给定客户组集合，反查所有涉及的账户 ID（用于写入 account_products） */
  const resolveAccountIds = async (
    customerGroups: string[],
  ): Promise<string[]> => {
    if (customerGroups.length === 0) return []
    const { data, error: e } = await supabase
      .from('customer_group_mappings')
      .select('account_id')
      .in('customer_group', customerGroups)
      .eq('is_active', true)
    if (e) { error.value = e.message; return [] }
    const ids = new Set<string>()
    ;(data ?? []).forEach((r: any) => ids.add(r.account_id))
    return Array.from(ids)
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    bulkUpsert,
    remove,
    resolveAccountIds,
  }
}