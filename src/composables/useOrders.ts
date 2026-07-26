/**
 * useOrders —— 订单 composable
 *
 * 核心能力：
 *  - 客户：拉自己的订单 + 提交新订单（生成 order_no）
 *  - 审核/财务/仓库：按状态筛选订单
 *  - 状态机更新（pending → audited → accounted → shipped）
 */
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'

export type OrderStatus = 'pending' | 'audited' | 'accounted' | 'shipped' | 'cancelled'

export interface OrderRow {
  id: string
  order_no: string
  account_id: string
  sub_account_id: string | null
  status: OrderStatus
  remark: string | null
  created_at: string
  audited_at: string | null
  accounted_at: string | null
  shipped_at: string | null
  account?: { account_name: string; company_name: string }
  sub_account?: { id: string; account_name: string; inn: string }
  items?: OrderItemRow[]
  total_amount?: number
}

export interface OrderItemRow {
  id: string
  product_id: string
  boxes: number
  m2_per_box: number
  m2_total: number
  unit_price: number | null
  line_total: number
  stock_level: 1 | 2
  remark: string | null
  product?: { model: string; category: string; conversion_rate: number }
}

export interface CartItemForSubmit {
  product_id: string
  model: string
  boxes: number
  conversion_rate: number
  /** 1 表示从 stock_level_1 扣，2 表示从 stock_level_2 扣；默认 1 */
  stock_level?: 1 | 2
}

export function useOrders() {
  const items = ref<OrderRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const totalAmount = computed(() =>
    items.value.reduce((s, o) => s + (o.total_amount ?? 0), 0),
  )

  /** 客户：拉自己的订单（含子账户信息） */
  const fetchMine = async () => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('orders')
      .select('*, account:accounts(account_name, company_name), sub_account:accounts!orders_sub_account_id_fkey(id, account_name, inn), items:order_items(*, product:products(model, category, conversion_rate))')
      .order('created_at', { ascending: false })
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []).map(decorateOrder)
    loading.value = false
    return items.value
  }

  /** 员工：按状态拉所有订单 */
  const fetchByStatus = async (status?: OrderStatus) => {
    loading.value = true
    let q = supabase
      .from('orders')
      .select('*, account:accounts(account_name, company_name), sub_account:accounts!orders_sub_account_id_fkey(id, account_name, inn), items:order_items(*, product:products(model, category, conversion_rate))')
      .order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    const { data, error: e } = await q
    if (e) { error.value = e.message; loading.value = false; return [] }
    items.value = (data ?? []).map(decorateOrder)
    loading.value = false
    return items.value
  }

  /** 计算总金额 + 装入 OrderRow */
  const decorateOrder = (o: any): OrderRow => ({
    ...o,
    total_amount: (o.items ?? []).reduce((s: number, i: any) => s + Number(i.line_total ?? 0), 0),
  })

  /**
   * 客户提交订单
   * 流程：
   *  1) 用 RPC 调 fn_generate_order_no() 取单号
   *  2) 插入 orders (status=pending)
   *  3) 批量插入 order_items
   *  注：这里直接用客户端 SDK；如并发严格可换 RPC
   */
  const submit = async (
    accountId: string,
    cartItems: CartItemForSubmit[],
    remark: string | null = null,
    subAccountId: string | null = null,
  ): Promise<OrderRow> => {
    if (cartItems.length === 0) throw new Error('购物车为空')

    // 1. 取业务单号
    const { data: orderNo, error: noErr } = await supabase.rpc('fn_generate_order_no' as any)
    if (noErr) throw noErr
    const no = String(orderNo ?? '').trim()
    if (!no) throw new Error('生成单号失败')

    // 2. 插入主表（account_id = 主账号，sub_account_id = 下单子账号）
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert({
        order_no: no,
        account_id: accountId,
        sub_account_id: subAccountId,
        status: 'pending',
        remark,
      } as any)
      .select('*')
      .single()
    if (oErr) throw oErr

    // 3. 批量插入明细
    const itemsPayload = cartItems.map((c) => ({
      order_id: (order as any).id,
      product_id: c.product_id,
      boxes: c.boxes,
      m2_per_box: c.conversion_rate,
      stock_level: c.stock_level ?? 1,
      unit_price: null,
      remark: null,
    }))
    const { error: iErr } = await supabase.from('order_items').insert(itemsPayload as any)
    if (iErr) throw iErr

    return decorateOrder(order)
  }

  /**
   * 状态机转移
   * 由数据库触发器负责校验合法性 + 写入日志 + 扣减库存
   */
  const transition = async (orderId: string, to: OrderStatus, note?: string) => {
    const patch: any = { status: to }
    // 标记执行人
    if (to === 'audited')    patch.audited_by   = (await supabase.auth.getUser()).data.user?.id
    if (to === 'accounted')  patch.accounted_by = (await supabase.auth.getUser()).data.user?.id
    if (to === 'shipped')    patch.shipped_by   = (await supabase.auth.getUser()).data.user?.id

    // Supabase v2 类型在 Update 含可选字段时与 Partial<Row> 兼容性有限，此处做一次明确断言
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('orders') as any).update(patch).eq('id', orderId)
    if (e) throw e
  }

  /** 审核员改价（更新 order_items.unit_price） */
  const updateItemPrice = async (itemId: string, unitPrice: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('order_items') as any).update({ unit_price: unitPrice }).eq('id', itemId)
    if (e) throw e
  }

  /** 审核员改量（更新 order_items.boxes） */
  const updateItemBoxes = async (itemId: string, boxes: number) => {
    if (boxes <= 0) throw new Error('箱数必须 > 0')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('order_items') as any).update({ boxes }).eq('id', itemId)
    if (e) throw e
  }

  return {
    items, loading, error, totalAmount,
    fetchMine, fetchByStatus,
    submit, transition, updateItemPrice, updateItemBoxes,
  }
}
