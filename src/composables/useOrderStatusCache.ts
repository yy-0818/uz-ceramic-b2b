/**
 * useOrderStatusCache —— 订单状态单例缓存
 * Phase 7: 多个 ChatOrderCard 共享同一份订单实时状态, 避免重复订阅.
 *
 * 用法:
 *   const cache = useOrderStatusCache()
 *   const status = cache.getStatus(orderId, initialStatus)
 *   // 订阅并自动响应式更新
 *   const live = cache.subscribe(orderId)
 */
import { ref, onScopeDispose } from 'vue'
import { supabase } from '@/lib/supabase'

type Entry = { status: string; total_amount: number; order_no: string; updated_at: string }
const cache = new Map<string, Entry>()

const listeners = new Map<string, Set<(e: Entry) => void>>()
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null
let subscribed = false

const ensureChannel = () => {
  if (subscribed || typeof window === 'undefined') return
  subscribed = true
  realtimeChannel = supabase
    .channel('orders-realtime-cache')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      (payload) => {
        const o = payload.new as any
        if (!o?.id) return
        const prev = cache.get(o.id)
        cache.set(o.id, {
          status: o.status,
          total_amount: Number(o.total_amount ?? prev?.total_amount ?? 0),
          order_no: o.order_no ?? prev?.order_no ?? '—',
          updated_at: o.updated_at ?? new Date().toISOString(),
        })
        const subs = listeners.get(o.id)
        if (subs) {
          for (const cb of subs) {
            try { cb(cache.get(o.id)!) } catch { /* ignore */ }
          }
        }
      },
    )
    .subscribe()
}

export function useOrderStatusCache() {
  const getStatus = (orderId: string, fallback: string): string => {
    return cache.get(orderId)?.status ?? fallback
  }

  const getTotal = (orderId: string, fallback = 0): number => {
    return cache.get(orderId)?.total_amount ?? fallback
  }

  const subscribe = (orderId: string, onUpdate: (e: Entry) => void) => {
    ensureChannel()
    if (!listeners.has(orderId)) listeners.set(orderId, new Set())
    listeners.get(orderId)!.add(onUpdate)
    onScopeDispose(() => {
      const set = listeners.get(orderId)
      if (set) {
        set.delete(onUpdate)
        if (set.size === 0) listeners.delete(orderId)
      }
    })
  }

  /** 首次拉一次全量 — 渲染旧消息的卡片时调用, 补齐 status. dedup short window. */
  const _hydrateInflight = new Set<string>()
  const hydrate = async (orderIds: string[]) => {
    if (orderIds.length === 0) return
    const dedup = (cache as any)._cache as Map<string, any> | undefined
    const filtered = orderIds.filter((id) => {
      if (dedup?.has(id)) return false
      if (_hydrateInflight.has(id)) return false
      _hydrateInflight.add(id)
      return true
    })
    if (filtered.length === 0) return
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, status, total_amount, order_no, updated_at')
        .in('id', filtered)
      if (error) throw error
      for (const o of (data ?? []) as any[]) {
        cache.set(o.id, {
          status: o.status,
          total_amount: Number(o.total_amount ?? 0),
          order_no: o.order_no,
          updated_at: o.updated_at,
        })
        // hydrate 完成后通知订阅者 (与 realtime 行为一致)
        const subs = listeners.get(o.id)
        if (subs) {
          const e = cache.get(o.id)!
          for (const cb of subs) { try { cb(e) } catch { /* ignore */ } }
        }
      }
    } catch { /* ignore */ }
    finally {
      for (const id of filtered) _hydrateInflight.delete(id)
    }
  }

  /** 提供给 OrderDetailPage 使用 — 立即更新缓存 */
  const setImmediate = (orderId: string, status: string, totalAmount: number, orderNo: string) => {
    cache.set(orderId, {
      status,
      total_amount: totalAmount,
      order_no: orderNo,
      updated_at: new Date().toISOString(),
    })
    const subs = listeners.get(orderId)
    if (subs) {
      const e = cache.get(orderId)!
      for (const cb of subs) { try { cb(e) } catch { /* ignore */ } }
    }
  }

  return { getStatus, getTotal, subscribe, hydrate, setImmediate, _cache: cache }
}