/**
 * useNotifications — 通知中心 composable
 * - fetchList: 拉最近 N 条
 * - fetchUnreadCount: 未读数
 * - markRead / markAllRead
 * - realtime subscribe: 新通知进来 → 加进 list + 触发浏览器 Notification
 * - 用户切换 / 登出时自动停止订阅
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

export interface Notification {
  id: string
  kind: 'chat_message' | 'order_status' | 'staff_assigned' | 'staff_transferred' | 'system'
  title: string
  body: string
  link: string | null
  payload: Record<string, any>
  read_at: string | null
  created_at: string
}

const BROWSER_NOTIFY_KEY = 'chat.notifications.browser_enabled'

let _singleton: ReturnType<typeof create> | null = null

export function useNotifications() {
  if (_singleton) return _singleton
  _singleton = create()
  return _singleton
}

function create() {
  const { appUser } = useAuth()

  const list = ref<Notification[]>([])
  const unread = ref(0)
  const loading = ref(false)
  let channel: ReturnType<typeof supabase.channel> | null = null
  let currentUid: string | null = null

  const fetchList = async (limit = 50, onlyUnread = false): Promise<Notification[]> => {
    if (!appUser.value?.id) return []
    loading.value = true
    try {
      const { data, error } = await (supabase as any).rpc('rpc_notifications_list', {
        p_limit: limit,
        p_only_unread: onlyUnread,
      })
      if (error) throw error
      list.value = (data ?? []) as Notification[]
      return list.value
    } finally {
      loading.value = false
    }
  }

  const fetchUnreadCount = async (): Promise<number> => {
    if (!appUser.value?.id) return 0
    const { data, error } = await (supabase as any).rpc('rpc_notifications_unread_count')
    if (error) {
      console.warn('[notifications] unread_count failed', error)
      return unread.value
    }
    unread.value = (data ?? 0) as number
    return unread.value
  }

  const markRead = async (id: string): Promise<void> => {
    const before = list.value
    const idx = list.value.findIndex((n) => n.id === id)
    if (idx >= 0) {
      const n = list.value[idx]
      list.value[idx] = { ...n, read_at: new Date().toISOString() }
      unread.value = Math.max(unread.value - 1, 0)
    }
    try {
      await (supabase as any).rpc('rpc_notifications_mark_read', { p_id: id })
    } catch (e) {
      // 回滚
      list.value = before
      await fetchUnreadCount()
      throw e
    }
  }

  const markAllRead = async (): Promise<number> => {
    const before = list.value
    const now = new Date().toISOString()
    list.value = list.value.map((n) => n.read_at ? n : { ...n, read_at: now })
    unread.value = 0
    try {
      const { data } = await (supabase as any).rpc('rpc_notifications_mark_all_read')
      return (data ?? 0) as number
    } catch (e) {
      list.value = before
      await fetchUnreadCount()
      throw e
    }
  }

  const ensureSubscribed = async () => {
    const uid = appUser.value?.id
    if (!uid) return
    if (channel && currentUid === uid) return
    if (channel) {
      try { await supabase.removeChannel(channel) } catch { /* ignore */ }
      channel = null
    }
    currentUid = uid
    channel = supabase
      .channel(`notifications:${uid}`)
      .on(
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        (payload: any) => {
          const n = payload?.new as Notification
          if (!n) return
          // 避免重复
          if (list.value.some((x) => x.id === n.id)) return
          list.value = [n, ...list.value].slice(0, 100)
          if (!n.read_at) {
            unread.value += 1
            maybeBrowserNotify(n)
          }
        },
      )
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        (payload: any) => {
          const n = payload?.new as Notification
          if (!n) return
          const idx = list.value.findIndex((x) => x.id === n.id)
          if (idx >= 0) list.value[idx] = n
          // unread count 由 mark_read 自己 -1, 这里不需要
        },
      )
      .subscribe()
  }

  const stop = async () => {
    if (channel) {
      try { await supabase.removeChannel(channel) } catch { /* ignore */ }
      channel = null
    }
    currentUid = null
    list.value = []
    unread.value = 0
  }

  onBeforeUnmount(() => {
    // singleton, 不在此处 stop (跨页面共享)
  })

  // 浏览器 Notification
  const browserEnabled = ref<boolean>(
    typeof window !== 'undefined' && window.localStorage?.getItem(BROWSER_NOTIFY_KEY) === '1',
  )
  const browserSupported = computed(() => typeof window !== 'undefined' && 'Notification' in window)

  const requestBrowserPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!browserSupported.value) return 'unsupported'
    try {
      const perm = await Notification.requestPermission()
      const ok = perm === 'granted'
      browserEnabled.value = ok
      window.localStorage?.setItem(BROWSER_NOTIFY_KEY, ok ? '1' : '0')
      return perm
    } catch {
      return 'denied'
    }
  }

  const maybeBrowserNotify = (n: Notification) => {
    if (!browserEnabled.value) return
    if (document.visibilityState === 'visible') return
    try {
      const { title, body } = renderText(n)
      const note = new Notification(title || 'Notification', {
        body,
        icon: '/favicon.ico',
        tag: n.id,
      })
      note.onclick = () => {
        try {
          window.focus()
          if (n.link) window.location.href = n.link
        } catch { /* ignore */ }
        note.close()
      }
      setTimeout(() => { try { note.close() } catch { /* ignore */ } }, 8000)
    } catch { /* ignore */ }
  }

  // i18n 渲染 helper — 注入到 useNotifications, 由 useI18n 装上
  let i18nRender: (kindKey: string, payload: Record<string, any>) => { title: string; body: string } =
    (k, p) => ({ title: '', body: '' })

  const setI18nRenderer = (fn: typeof i18nRender) => { i18nRender = fn }

  const renderText = (n: Notification) => {
    const kindKey = (n.payload?.kind_key as string) || n.kind
    return i18nRender(kindKey, n.payload || {})
  }

  return {
    list,
    unread,
    loading,
    browserEnabled,
    browserSupported,
    fetchList,
    fetchUnreadCount,
    markRead,
    markAllRead,
    ensureSubscribed,
    stop,
    requestBrowserPermission,
    renderText,
    setI18nRenderer,
  }
}
