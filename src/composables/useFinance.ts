/**
 * useFinance —— 财务记账流水（伪资金流）
 *
 * 业务（仅"登记"，不接真实通道）：
 *  - 财务对 audited 状态的订单，登记 debit（客户欠款）
 *  - 收款后登记 credit（实际到账）
 *  - 所有流水写入 finance_ledger
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface LedgerEntry {
  id: string
  order_id: string
  account_id: string
  direction: 'debit' | 'credit'
  amount: number
  currency: string
  memo: string | null
  recorded_by: string | null
  recorded_at: string
  order?: { order_no: string; status: string }
}

export function useFinance() {
  const entries = ref<LedgerEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 拉某订单的流水 */
  const fetchByOrder = async (orderId: string) => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('finance_ledger')
      .select('*, order:orders(order_no, status)')
      .eq('order_id', orderId)
      .order('recorded_at', { ascending: false })
    if (e) { error.value = e.message; loading.value = false; return [] }
    entries.value = (data ?? []) as LedgerEntry[]
    loading.value = false
    return entries.value
  }

  /** 拉某账户的流水 */
  const fetchByAccount = async (accountId: string) => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('finance_ledger')
      .select('*, order:orders(order_no, status)')
      .eq('account_id', accountId)
      .order('recorded_at', { ascending: false })
    if (e) { error.value = e.message; loading.value = false; return [] }
    entries.value = (data ?? []) as LedgerEntry[]
    loading.value = false
    return entries.value
  }

  /** 登记一笔流水 */
  const record = async (input: {
    order_id: string
    account_id: string
    direction: 'debit' | 'credit'
    amount: number
    currency?: string
    memo?: string | null
  }) => {
    if (input.amount <= 0) throw new Error('金额必须 > 0')
    const { data: user } = await supabase.auth.getUser()
    const { error: e } = await supabase.from('finance_ledger').insert({
      ...input,
      currency: input.currency ?? 'UZS',
      recorded_by: user.user?.id ?? null,
    } as any)
    if (e) throw e
  }

  /** 计算订单净收支 */
  const netAmount = (orderId: string) =>
    entries.value
      .filter((x) => x.order_id === orderId)
      .reduce((s, x) => s + (x.direction === 'credit' ? x.amount : -x.amount), 0)

  return { entries, loading, error, fetchByOrder, fetchByAccount, record, netAmount }
}
