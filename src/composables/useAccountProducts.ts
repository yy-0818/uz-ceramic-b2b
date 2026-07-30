/**
 * useAccountProducts —— 库存白名单分配
 *
 * 核心 API：
 *   - fetchForAccount(accountId)  拉取某账户的白名单（含产品信息）
 *   - fetchForProducts(productIds)  按商品反向查账户（用于后台）
 *   - bulkAssign(assignments)      批量 upsert 白名单
 *   - setVisible(accountId, productId, visible)  切换可见性
 *
 * 状态提升到模块单例：同一页面多次进入 / 页面间共享时，数据只从 Supabase 拉取一次。
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface AccountProductRow {
  account_id: string
  product_id: string
  is_visible: boolean
  stock_level_1: number
  stock_level_2: number
  updated_at: string
  // 关联数据（join 查询时填充）
  product?: {
    id: string
    model: string
    category: string
    conversion_rate: number
    remark: string | null
  }
  account?: {
    id: string
    account_name: string
    account_type: string
  }
}

// Module-level singleton state — shared across all useAccountProducts() calls
const items = ref<AccountProductRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const fetched = ref(false)

/** 清除所有缓存（切换账号时调用） */
export function resetAccountProducts() {
  items.value = []
  loading.value = false
  error.value = null
  fetched.value = false
}

export function useAccountProducts() {

  /** 客户视角：拉自己（+ parent）可见的白名单 */
  const fetchForCurrentAccount = async () => {
    loading.value = true
    // RLS 已自动过滤；前端 select 关联产品信息
    const { data, error: e } = await supabase
      .from('account_products')
      .select('*, product:products(id, model, category, conversion_rate, remark)')
      .eq('is_visible', true)
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []) as AccountProductRow[]
    loading.value = false
    fetched.value = true
    return items.value
  }

  /** 后台：按账户查 */
  const fetchForAccount = async (accountId: string) => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('account_products')
      .select('*, product:products(id, model, category, conversion_rate, remark)')
      .eq('account_id', accountId)
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []) as AccountProductRow[]
    loading.value = false
    fetched.value = true
    return items.value
  }

  /** 后台：按商品查账户（用于白名单反向） */
  const fetchForProduct = async (productId: string) => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('account_products')
      .select('*, account:accounts(id, account_name, account_type)')
      .eq('product_id', productId)
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []) as AccountProductRow[]
    loading.value = false
    fetched.value = true
    return items.value
  }

  /** 批量 upsert（按主键 account_id + product_id） */
  const bulkAssign = async (
    assignments: Array<{
      account_id: string
      product_id: string
      is_visible: boolean
      stock_level_1: number
      stock_level_2: number
    }>,
  ) => {
    if (assignments.length === 0) return 0
    const { error: e, count } = await supabase
      .from('account_products')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(assignments as any, { onConflict: 'account_id,product_id', count: 'exact' })
    if (e) { error.value = e.message; throw e }
    return count ?? assignments.length
  }

  /** 切换可见性 */
  const setVisible = async (accountId: string, productId: string, visible: boolean) => {
    const { error: e } = await supabase
      .from('account_products')
      .upsert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { account_id: accountId, product_id: productId, is_visible: visible } as any,
        { onConflict: 'account_id,product_id' },
      )
    if (e) { error.value = e.message; throw e }
  }

  return {
    items, loading, error, fetched,
    fetchForCurrentAccount, fetchForAccount, fetchForProduct,
    bulkAssign, setVisible,
    $reset: resetAccountProducts,
  }
}
