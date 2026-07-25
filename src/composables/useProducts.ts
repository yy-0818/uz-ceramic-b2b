/**
 * useProducts —— products 表的 CRUD composable
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface Product {
  id: string
  model: string
  category: string
  conversion_rate: number
  remark: string | null
}

export function useProducts() {
  const items = ref<Product[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    const { data, error: e } = await supabase
      .from('products')
      .select('*')
      .order('category', { ascending: true })
      .order('model', { ascending: true })
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []) as Product[]
    loading.value = false
    return items.value
  }

  /** 批量 upsert（按 model 唯一） */
  const bulkUpsert = async (rows: Array<{
    model: string
    category: string
    conversion_rate: number
    remark: string | null
  }>) => {
    if (rows.length === 0) return [] as Product[]
    const { data, error: e } = await supabase
      .from('products')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(rows as any, { onConflict: 'model' })
      .select('*')
    if (e) { error.value = e.message; throw e }
    return (data ?? []) as Product[]
  }

  return { items, loading, error, fetchAll, bulkUpsert }
}
