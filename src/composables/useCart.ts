/**
 * useCart —— 客户下单购物车（Pinia 之外的轻量 composable）
 *
 * 设计：
 * - 内部 Map<product_id, CartItem>，避免重复
 * - 提供 reactive items 列表
 * - qtyOf(productId) 用于步进器读数
 * - totalBoxes() / totalM2() 用于购物车汇总
 * - 持久化：localStorage key = 'cart:current'
 * 注：实际订单 submit 会在 Phase 3 实现
 */
import { ref, computed, watch } from 'vue'

export interface CartItem {
  product_id: string
  model: string
  boxes: number
  conversion_rate: number
}

const STORAGE_KEY = 'cart:current'
const items = ref<CartItem[]>([])
let initialized = false

function load() {
  if (initialized) return
  initialized = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) items.value = JSON.parse(raw)
  } catch { /* ignore */ }
  watch(items, (v) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch { /* ignore */ }
  }, { deep: true })
}

export function useCart() {
  load()

  const totalBoxes = () => items.value.reduce((s, i) => s + i.boxes, 0)
  const totalM2 = () => items.value.reduce((s, i) => s + i.boxes * i.conversion_rate, 0)

  const qtyOf = (productId: string) =>
    items.value.find((i) => i.product_id === productId)?.boxes ?? 0

  const setQty = (productId: string, model: string, conversionRate: number, boxes: number) => {
    const idx = items.value.findIndex((i) => i.product_id === productId)
    if (idx >= 0) {
      items.value[idx] = { ...items.value[idx], boxes }
    } else {
      items.value.push({ product_id: productId, model, conversion_rate: conversionRate, boxes })
    }
  }

  const remove = (productId: string) => {
    items.value = items.value.filter((i) => i.product_id !== productId)
  }

  const clear = () => { items.value = [] }

  const count = computed(() => items.value.length)

  return { items, totalBoxes, totalM2, qtyOf, setQty, remove, clear, count }
}
