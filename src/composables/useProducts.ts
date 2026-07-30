/**
 * useProducts —— products + stock_colors 联动管理
 *
 * 状态提升到模块单例：
 *   - 同一页面多次进入 / 页面间共享时，数据只从 Supabase 拉取一次，
 *     后续直接使用缓存，避免重复骨架屏闪烁。
 *   - fetched 标记记录"是否已从后端拉取过"；骨架屏只在 !fetched 时显示。
 *
 * allProductsWithColors 也在模块级：避免组件重新 mount 时数据丢失。
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
  /** 库存表 A 列"客户组"——导入时写入 */
  stock_group: string | null
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
// Module-level singleton state — shared across all useProducts() calls
const items = ref<Product[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
/** True after first successful fetch; used to suppress skeleton on revisit */
const fetched = ref(false)
/** ProductWithColors view cache — survives component re-mount */
const allProductsWithColors = ref<ProductWithColors[]>([])

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
    fetched.value = true
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
      /** 该产品在哪些库存组出现（取第一个有值的即可，写入 stock_group） */
      stockGroup?: string
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
      stock_group: p.stockGroup ?? null,
    }))
    console.log('[import] step 1: upsert products', { count: productRows.length })
    const upserted = await bulkUpsert(productRows)
    console.log('[import] step 1 done: upserted products', { count: upserted.length, sample: upserted[0] })

    // 2. 删除已有色号 + 重新插入（简化的"覆盖"语义）
    // 注意：DELETE ?product_id=in.(...) 拼成 URL 会被 Cloudflare 截断（520），
    //       当 product 数 > 500 时 URL 超过 50KB。必须分批，每批 200 个。
    const modelSet = new Set(products.map((p) => p.model))
    const upsertedIds = upserted.filter((u) => modelSet.has(u.model)).map((u) => u.id)
    if (upsertedIds.length > 0) {
      const CHUNK = 200
      for (let i = 0; i < upsertedIds.length; i += CHUNK) {
        const slice = upsertedIds.slice(i, i + CHUNK)
        const { error: delErr } = await supabase
          .from('stock_colors')
          .delete()
          .in('product_id', slice)
        if (delErr) { error.value = delErr.message; throw delErr }
        console.log('[import] step 2: deleted chunk', { from: i, to: i + slice.length })
      }
      console.log('[import] step 2 done: deleted old stock_colors', { count: upsertedIds.length })
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
    console.log('[import] step 3: insert stock_colors', { count: colorRows.length, sample: colorRows.slice(0, 3) })
    if (colorRows.length > 0) {
      // 同样分批：避免单次请求 body > 1MB 限制
      const CHUNK = 1000
      let inserted = 0
      for (let i = 0; i < colorRows.length; i += CHUNK) {
        const slice = colorRows.slice(i, i + CHUNK)
        const { error: cErr, data: cData } = await supabase
          .from('stock_colors')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(slice as any, { onConflict: 'product_id,color_code,stock_level' })
          .select('id')
        if (cErr) { error.value = cErr.message; throw cErr }
        inserted += cData?.length ?? 0
        console.log('[import] step 3: inserted chunk', { from: i, to: i + slice.length, returned: cData?.length })
      }
      console.log('[import] step 3 done: inserted stock_colors', { returned: inserted })
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
        const CHUNK = 1000
        for (let i = 0; i < apRows.length; i += CHUNK) {
          const slice = apRows.slice(i, i + CHUNK)
          const { error: apErr } = await supabase
            .from('account_products')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .upsert(slice as any, { onConflict: 'account_id,product_id' })
          if (apErr) { error.value = apErr.message; throw apErr }
        }
        whiteRows = apRows.length
        console.log('[import] step 4 done: account_products', { count: apRows.length })
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
    if (fetched.value && allProductsWithColors.value.length > 0) {
      return allProductsWithColors.value
    }
    const { data, error: e } = await supabase
      .from('v_products_with_colors')
      .select('*')
    if (e) { error.value = e.message; throw e }
    allProductsWithColors.value = (data ?? []) as unknown as ProductWithColors[]
    fetched.value = true
    return allProductsWithColors.value
  }

  /**
   * 清空库存相关三张表：account_products → stock_colors → products。
   * 注意顺序：必须先删依赖表，再删 products。
   * 分批执行避免 URL / body 超限（Cloudflare 520）。
   */
  const clearAll = async (): Promise<{ products: number; colors: number; whiteRows: number }> => {
    const CHUNK = 200

    // 1. account_products
    const { count: whiteCount, error: wErr } = await supabase
      .from('account_products')
      .select('*', { count: 'exact', head: true })
    if (wErr) { error.value = wErr.message; throw wErr }
    if ((whiteCount ?? 0) > 0) {
      const { data: whiteRows } = await supabase
        .from('account_products')
        .select('id')
      const ids = (whiteRows ?? []).map((r: any) => r.id)
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        const { error: dErr } = await supabase
          .from('account_products')
          .delete()
          .in('id', slice)
        if (dErr) { error.value = dErr.message; throw dErr }
      }
    }

    // 2. stock_colors（必须先于 products，因为外键依赖）
    const { data: colorIds } = await supabase
      .from('stock_colors')
      .select('id')
    const cIds = (colorIds ?? []).map((r: any) => r.id)
    for (let i = 0; i < cIds.length; i += CHUNK) {
      const slice = cIds.slice(i, i + CHUNK)
      const { error: cErr } = await supabase
        .from('stock_colors')
        .delete()
        .in('id', slice)
      if (cErr) { error.value = cErr.message; throw cErr }
    }

    // 3. products
    const { data: pRows } = await supabase
      .from('products')
      .select('id')
    const pIds = (pRows ?? []).map((r: any) => r.id)
    for (let i = 0; i < pIds.length; i += CHUNK) {
      const slice = pIds.slice(i, i + CHUNK)
      const { error: pErr } = await supabase
        .from('products')
        .delete()
        .in('id', slice)
      if (pErr) { error.value = pErr.message; throw pErr }
    }

    items.value = []
    fetched.value = false
    return { products: pIds.length, colors: cIds.length, whiteRows: whiteCount ?? 0 }
  }

  return {
    items,
    loading,
    error,
    fetched,
    allProductsWithColors,
    fetchAll,
    fetchAllWithColors,
    bulkUpsert,
    bulkImportWithColors,
    clearAll,
  }
}