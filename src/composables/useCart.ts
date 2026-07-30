/**
 * useCart —— 客户下单购物车（Pinia 之外的轻量 composable）
 *
 * 设计：
 * - 内部按 (product_id, color_code, stock_level) 唯一标识一条购物车项
 * - 提供 reactive items 列表
 * - qtyOf(productId) 返回该商品所有色号箱数之和（聚合读法，向后兼容）
 * - qtyOfColor(productId, color, level) 返回单个色号的箱数
 * - totalBoxes() / totalM2() 用于购物车汇总
 * - 持久化：localStorage key = 'cart:current'
 */
import { ref, computed, watch } from 'vue'

export interface CartItem {
  product_id: string
  /** 色号（如 D1 / A12） */
  color_code: string
  /** 1 = stock_level_1, 2 = stock_level_2 */
  stock_level: 1 | 2
  model: string
  boxes: number
  conversion_rate: number
}

/** 复合 key */
function keyOf(item: Pick<CartItem, 'product_id' | 'color_code' | 'stock_level'>): string {
  return `${item.product_id}::${item.color_code}::${item.stock_level}`
}

const STORAGE_KEY = 'cart:current'
const items = ref<CartItem[]>([])
let initialized = false

function load() {
  if (initialized) return
  initialized = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 兼容旧数据：旧版本只有 product_id，无 color_code/stock_level，
      // 升级时补上占位字段，避免提交订单时缺关键信息。
      items.value = (parsed as any[]).map((it) => ({
        product_id: it.product_id,
        color_code: it.color_code ?? '',
        stock_level: (it.stock_level ?? 1) as 1 | 2,
        model: it.model,
        boxes: it.boxes,
        conversion_rate: it.conversion_rate,
      }))
    }
  } catch { /* ignore */ }
  watch(items, (v) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ }
  }, { deep: true })
}

/** 重置并清空 localStorage（切换账号时调用） */
export function resetCart() {
  items.value = []
  initialized = false
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function useCart() {
  load()

  const totalBoxes = () => items.value.reduce((s, i) => s + i.boxes, 0)
  const totalM2 = () => items.value.reduce((s, i) => s + i.boxes * i.conversion_rate, 0)

  /** 聚合：返回该商品所有色号箱数之和（兼容老 API） */
  const qtyOf = (productId: string) =>
    items.value.filter((i) => i.product_id === productId).reduce((s, i) => s + i.boxes, 0)

/**
 * 把任意 stock_level 数值规范化为 1 | 2。
 * supabase 读出的是 number，调用方传 number 更顺手；这里做一次白名单归一。
 */
function normLevel(level: number): 1 | 2 {
  return level === 2 ? 2 : 1
}

/** 精确：返回该 (product, color, level) 单条的数量 */
const qtyOfColor = (productId: string, colorCode: string, stockLevel: number) =>
  items.value.find((i) =>
    i.product_id === productId && i.color_code === colorCode && i.stock_level === normLevel(stockLevel),
  )?.boxes ?? 0

/** 兼容老签名：按 product_id + color_code + stock_level 覆盖 */
const setQty = (
  productId: string,
  model: string,
  conversionRate: number,
  boxes: number,
  colorCode: string = '',
  stockLevel: number = 1,
) => {
  const lvl = normLevel(stockLevel)
  const idx = items.value.findIndex(
    (i) => i.product_id === productId && i.color_code === colorCode && i.stock_level === lvl,
  )
  if (idx >= 0) {
    items.value[idx] = { ...items.value[idx], boxes }
  } else {
    items.value.push({
      product_id: productId,
      color_code: colorCode,
      stock_level: lvl,
      model,
      conversion_rate: conversionRate,
      boxes,
    })
  }
}

const remove = (productId: string, colorCode?: string, stockLevel?: number) => {
  if (colorCode === undefined || stockLevel === undefined) {
    // 移除该 product 所有色号（兼容老调用）
    items.value = items.value.filter((i) => i.product_id !== productId)
  } else {
    const lvl = normLevel(stockLevel)
    items.value = items.value.filter((i) =>
      !(i.product_id === productId && i.color_code === colorCode && i.stock_level === lvl),
    )
  }
}

  const clear = () => { items.value = [] }

  const count = computed(() => items.value.length)

  return {
    items, totalBoxes, totalM2,
    qtyOf, qtyOfColor,
    setQty, remove, clear, count,
    keyOf,
    $reset: resetCart,
  }
}