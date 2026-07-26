/**
 * useProducts —— products + stock_colors 联动管理
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface Product {
  id: string
  model: string
  category: string
  conversion_rate: number
  remark: string | null
  image_url: string | null
  display_order: number
}

export interface ProductColor {
  id: string
  product_id: string
  color_code: string
  stock_level: 1 | 2
  boxes: number
}

/** 商品页用的扁平视图：product + 所有色号 */
export interface ProductWithColors {
  product_id: string
  model: string
  category: string
  conversion_rate: number
  remark: string | null
  image_url: string | null
  display_order: number
  total_boxes_level1: number
  total_boxes_level2: number
  colors: Array<{ color_code: string; stock_level: number; boxes: number }>
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
  }>): Promise<Product[]> => {
    if (rows.length === 0) return []
    const { data, error: e } = await supabase
      .from('products')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(rows as any, { onConflict: 'model' })
      .select('*')
    if (e) { error.value = e.message; throw e }
    return (data ?? []) as Product[]
  }

  /**
   * 一次写入三张表：products + stock_colors + （可选）account_products 白名单
   * @param products 含 model/category/conversionRate/remark/colors[]/customerGroups[]
   * @param accountIds 该产品要分配到的账户列表（来自客户组映射）
   */
  const bulkImportWithColors = async (
    products: Array<{
      model: string
      category: string
      conversionRate: number
      remark: string | null
      totalLevel1: number
      totalLevel2: number
      colors: Array<{ colorCode: string; stockLevel: 1 | 2; boxes: number }>
    }>,
    accountIds: string[] = [],
  ): Promise<{ products: number; colors: number; whiteRows: number }> => {
    if (products.length === 0) {
      return { products: 0, colors: 0, whiteRows: 0 }
    }

    // 1. upsert products
    const productRows = products.map((p) => ({
      model: p.model,
      category: p.category,
      conversion_rate: p.conversionRate,
      remark: p.remark,
    }))
    const upserted = await bulkUpsert(productRows)

    // 2. 删除已有色号 + 重新插入（简化的"覆盖"语义）
    const modelSet = new Set(products.map((p) => p.model))
    const upsertedIds = upserted.filter((u) => modelSet.has(u.model)).map((u) => u.id)
    if (upsertedIds.length > 0) {
      const { error: delErr } = await supabase
        .from('stock_colors')
        .delete()
        .in('product_id', upsertedIds)
      if (delErr) { error.value = delErr.message; throw delErr }
    }

    // 3. 插入 stock_colors
    const colorRows: Array<{
      product_id: string
      color_code: string
      stock_level: 1 | 2
      boxes: number
    }> = []
    upserted.forEach((u) => {
      const src = products.find((p) => p.model === u.model)
      if (!src) return
      src.colors.forEach((c) => {
        if (c.boxes > 0) {
          colorRows.push({
            product_id: u.id,
            color_code: c.colorCode,
            stock_level: c.stockLevel,
            boxes: c.boxes,
          })
        }
      })
    })
    if (colorRows.length > 0) {
      const { error: cErr } = await supabase
        .from('stock_colors')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(colorRows as any, { onConflict: 'product_id,color_code,stock_level' })
      if (cErr) { error.value = cErr.message; throw cErr }
    }

    // 4. 写入 account_products 白名单
    let whiteRows = 0
    if (accountIds.length > 0) {
      const apRows: Array<{
        account_id: string
        product_id: string
        is_visible: boolean
        stock_level_1: number
        stock_level_2: number
      }> = []
      upserted.forEach((u) => {
        const src = products.find((p) => p.model === u.model)
        if (!src) return
        for (const accId of accountIds) {
          apRows.push({
            account_id: accId,
            product_id: u.id,
            is_visible: true,
            stock_level_1: src.totalLevel1,
            stock_level_2: src.totalLevel2,
          })
        }
      })
      if (apRows.length > 0) {
        const { error: apErr } = await supabase
          .from('account_products')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(apRows as any, { onConflict: 'account_id,product_id' })
        if (apErr) { error.value = apErr.message; throw apErr }
        whiteRows = apRows.length
      }
    }

    return {
      products: upserted.length,
      colors: colorRows.length,
      whiteRows,
    }
  }

  /** 商品页用：拉取所有商品 + 色号（一次性 view 查询） */
  const fetchAllWithColors = async (): Promise<ProductWithColors[]> => {
    const { data, error: e } = await supabase
      .from('v_products_with_colors')
      .select('*')
    if (e) { error.value = e.message; throw e }
    return (data ?? []) as unknown as ProductWithColors[]
  }

  return {
    items,
    loading,
    error,
    fetchAll,
    fetchAllWithColors,
    bulkUpsert,
    bulkImportWithColors,
  }
}