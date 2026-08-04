/**
 * useChat —— 在线客服聊天 composable
 *
 * Phase 1：私聊 + 文本 + 实时 + 在线状态 + 未读数 + 已读
 * Phase 2：图片 / 订单卡片 / 表情
 *
 * 模块级单例：会话列表共享缓存，避免多页面切换都重拉。
 * 单个会话内的消息数组由 listMessages() 拉到组件 local state，
 * Realtime 订阅把增量 merge 进去。
 */
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { resetChatUpload } from './useChatUpload'

// ---------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------
export type ChatConversationStatus = 'open' | 'closed' | 'archived'
export type ChatMemberType = 'customer' | 'staff'
export type ChatMessageType = 'text' | 'system'
export type ChatPresenceStatus = 'online' | 'away' | 'offline'

export interface ChatConversation {
  id: string
  account_id: string
  subject_order_id: string | null
  assigned_to: string | null
  status: ChatConversationStatus
  last_message_at: string | null
  created_at: string
  updated_at: string
  // joined
  account?: { account_name: string; company_name: string }
  subject_order?: { order_no: string; status: string } | null
  assigned?: { id: string; full_name: string | null; role: string } | null
  last_message?: { body: string; sender_id: string; created_at: string; message_type: ChatMessageType } | null
  unread_count?: number
}

export interface ChatMember {
  id: string
  conversation_id: string
  user_id: string
  member_type: ChatMemberType
  last_read_message_id: string | null
  last_read_at: string | null
  joined_at: string
  left_at: string | null
  // joined
  user?: { id: string; full_name: string | null; role: string; account_id: string }
}

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: string
  message_type: ChatMessageType
  message_kind: 'text' | 'image' | 'order_card'
  body: string
  client_message_id: string
  reply_to_id: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  // joined
  sender?: { id: string; full_name: string | null; role: string }
}

export interface ChatMessageAttachment {
  id: string
  message_id: string
  storage_path: string
  mime: string
  size_bytes: number
  width: number | null
  height: number | null
}

export interface ChatMessageReaction {
  emoji: string
  user_ids: string[]
}

export interface ChatMessageMetadata {
  message_id: string
  payload: {
    order_id?: string
    order_no?: string
    status?: string
    total_amount?: number
    reactions?: ChatMessageReaction[]
    [key: string]: unknown
  }
  updated_at: string
}

export interface ChatSearchHit {
  message_id: string
  conversation_id: string
  sender_id: string
  sender_name: string | null
  body: string
  message_kind: 'text' | 'image' | 'order_card'
  created_at: string
  account_id: string
  account_name: string | null
  order_no: string | null
}

export interface ChatPresence {
  user_id: string
  device_id: string
  status: ChatPresenceStatus
  last_seen_at: string
  updated_at: string
  // joined
  user?: { id: string; full_name: string | null; role: string; account_id: string }
}

// ---------------------------------------------------------------------
// 模块级单例 — 会话列表
// ---------------------------------------------------------------------
const conversations = ref<ChatConversation[]>([])
const loadingList = ref(false)
const listError = ref<string | null>(null)
const fetched = ref(false)

export function resetChat() {
  conversations.value = []
  loadingList.value = false
  listError.value = null
  fetched.value = false
  try { resetChatUpload() } catch { /* ignore */ }
}

// ---------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 简单的"几秒前/几分钟前/几小时前/几天前"相对时间。
 * 不引第三方 date-fns 避免再扩张 bundle。
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const s = Math.floor(diff / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(iso).toLocaleDateString()
}

/**
 * 推导某个用户的"在线状态" — 基于 last_seen_at
 *  - < 60s   → online
 *  - < 5min  → away
 *  - else    → offline
 */
export function presenceState(iso: string | null | undefined, raw?: ChatPresenceStatus): ChatPresenceStatus {
  if (raw === 'offline') return 'offline'
  if (!iso) return 'offline'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return 'offline'
  if (diff < 60_000) return 'online'
  if (diff < 5 * 60_000) return 'away'
  return 'offline'
}

// ---------------------------------------------------------------------
// Converstations
// ---------------------------------------------------------------------
const CONV_SELECT = `
  id, account_id, subject_order_id, assigned_to, status,
  last_message_at, created_at, updated_at,
  account:accounts!chat_conversations_account_id_fkey(account_name, company_name),
  subject_order:orders!chat_conversations_subject_order_id_fkey(order_no, status),
  assigned:users!chat_conversations_assigned_to_fkey(id, full_name, role)
`

// ---------------------------------------------------------------------
// 内存缓存层（模块级单例，跨组件共享）
// ---------------------------------------------------------------------
const CACHE_TTL_MS = 5 * 60_000 // 5 分钟内复用缓存（消息是历史数据，很少变化）
const LIST_CACHE_TTL_MS = 30_000 // 会话列表缓存更短（未读数/最后消息会变）

interface CacheEntry<T> {
  data: T
  timestamp: number
  inFlight?: Promise<T> // 正在请求中的 promise（去重）
}

// 消息缓存：按 conversationId 缓存
const messagesCache = new Map<string, CacheEntry<ChatMessage[]>>()
// 成员缓存：按 conversationId 缓存
const membersCache = new Map<string, CacheEntry<ChatMember[]>>()
// 附件缓存：按 messageId 缓存
const attachmentsCache = new Map<string, CacheEntry<ChatMessageAttachment[]>>()
// 元数据缓存
const metadataCache = new Map<string, CacheEntry<ChatMessageMetadata>>()
// 会话列表缓存（key: 'customer' / 'staff:open' / 'staff:closed' / 'staff:archived' / 'staff:all'）
const conversationsCache = new Map<string, CacheEntry<ChatConversation[]>>()

// 消息总数缓存（用于判断"是否还有更多历史"）
const conversationMessageCounts = new Map<string, CacheEntry<number>>()
const MESSAGE_COUNT_TTL_MS = 60_000

// 附件 / 元数据的 in-flight 缓存（key = sorted messageIds 拼接）
const attachmentsInFlight = new Map<string, Promise<Record<string, ChatMessageAttachment[]>>>()
const metadataInFlight = new Map<string, Promise<Record<string, ChatMessageMetadata>>>()

// typing 缓存（TTL 5 秒，因为 typing 状态变化很快）
const typingCache = new Map<string, CacheEntry<{ user_id: string; full_name: string | null }[]>>()

function isCacheValid<T>(entry: CacheEntry<T> | undefined, ttl = CACHE_TTL_MS): boolean {
  if (!entry) return false
  return Date.now() - entry.timestamp < ttl
}

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string, ttl = CACHE_TTL_MS): T | undefined {
  const entry = map.get(key)
  if (isCacheValid(entry, ttl)) return entry!.data
  if (entry) map.delete(key)
  return undefined
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, data: T): void {
  map.set(key, { data, timestamp: Date.now() })
}

/**
 * 复用正在请求中的 promise，避免并发请求同一资源
 */
function getOrSetInFlight<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  factory: () => Promise<T>,
  ttl = CACHE_TTL_MS,
): Promise<T> {
  const entry = map.get(key)
  if (entry?.inFlight) return entry.inFlight
  if (isCacheValid(entry, ttl)) return Promise.resolve(entry!.data)
  const p = factory()
  map.set(key, { data: entry?.data as T, timestamp: entry?.timestamp ?? 0, inFlight: p })
  p.then((data) => {
    map.set(key, { data, timestamp: Date.now() })
  }).catch((e) => {
    // 失败时不清缓存（保留上次成功的数据），但要清 inFlight
    if (entry) {
      map.set(key, { data: entry.data, timestamp: entry.timestamp })
    } else {
      map.delete(key)
    }
    throw e
  })
  return p
}

/**
 * 使指定会话的所有缓存失效（收到新消息、UPDATE 等时调用）
 */
export function invalidateConversationCache(conversationId: string): void {
  messagesCache.delete(conversationId)
  membersCache.delete(conversationId)
  attachmentsCache.clear() // 附件分散在多个 key，简单起见全清
  metadataCache.clear()
}

/**
 * 清空所有聊天缓存
 */
export function clearChatCache(): void {
  messagesCache.clear()
  membersCache.clear()
  attachmentsCache.clear()
  metadataCache.clear()
  conversationsCache.clear()
  typingCache.clear()
  conversationMessageCounts.clear()
  attachmentsInFlight.clear()
  metadataInFlight.clear()
}

export function useChat() {
  // -------------------------------------------------------------------
  // 拉取会话列表（包含最后一条消息 + 未读数）
  // -------------------------------------------------------------------
  const fetchConversations = async (options?: { skipCache?: boolean }): Promise<ChatConversation[]> => {
    // skipCache: 强制重新拉
    if (options?.skipCache) {
      conversationsCache.delete('customer')
    }
    const key = 'customer'

    // 缓存命中: 直接返回（避免每次 ChatListPage 挂载都重新拉）
    if (!options?.skipCache) {
      const cached = getCached(conversationsCache, key, LIST_CACHE_TTL_MS)
      if (cached) {
        conversations.value = cached
        fetched.value = true
        return cached
      }
    }

    // 复用正在请求中的 promise（防止 onMounted + watch immediate 重复触发）
    const entry = conversationsCache.get(key)
    if (entry?.inFlight) {
      loadingList.value = true
      try {
        const data = await entry.inFlight
        conversations.value = data
        fetched.value = true
        return data
      } catch {
        return []
      } finally {
        loadingList.value = false
      }
    }

    // 标记 in-flight
    const p = (async () => {
      loadingList.value = true
      listError.value = null
      try {
        // 1. 主表
        const { data, error } = await supabase
          .from('chat_conversations')
          .select(CONV_SELECT)
          .order('last_message_at', { ascending: false, nullsFirst: false })
        if (error) throw error
        const rows = (data ?? []) as ChatConversation[]

        // 2. 对每个会话, 拉最后一条消息 + 当前用户未读数
        const me = (await supabase.auth.getUser()).data.user
        const meId = me?.id ?? null
        if (rows.length === 0) return []

        const ids = rows.map((r) => r.id)
        const lastMsgMap = new Map<string, { body: string; sender_id: string; created_at: string; message_type: ChatMessageType }>()
        const unreadMap = new Map<string, number>()

        // 2.1 最后一条消息
        const { data: lastMsgs } = await supabase
          .from('chat_messages')
          .select('conversation_id, body, sender_id, created_at, message_type')
          .in('conversation_id', ids)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
        for (const m of (lastMsgs ?? []) as any[]) {
          if (!lastMsgMap.has(m.conversation_id)) {
            lastMsgMap.set(m.conversation_id, m)
          }
        }

        // 2.2 当前用户未读数
        if (meId) {
          const { data: mems } = await supabase
            .from('chat_conversation_members')
            .select('conversation_id, last_read_message_id, joined_at')
            .eq('user_id', meId)
            .is('left_at', null)
            .in('conversation_id', ids)
          const memMap = new Map<string, { last_read_message_id: string | null; joined_at: string }>()
          for (const m of (mems ?? []) as any[]) {
            memMap.set(m.conversation_id, { last_read_message_id: m.last_read_message_id, joined_at: m.joined_at })
          }

          const { data: unreadMsgs } = await supabase
            .from('chat_messages')
            .select('conversation_id, sender_id, created_at')
            .in('conversation_id', ids)
            .neq('sender_id', meId)
            .is('deleted_at', null)
          for (const u of (unreadMsgs ?? []) as any[]) {
            const mem = memMap.get(u.conversation_id)
            if (!mem) continue
            if (new Date(u.created_at) > new Date(mem.joined_at)) {
              unreadMap.set(u.conversation_id, (unreadMap.get(u.conversation_id) ?? 0) + 1)
            }
          }
        }

        for (const r of rows) {
          r.last_message = lastMsgMap.get(r.id) ?? null
          r.unread_count = unreadMap.get(r.id) ?? 0
        }
        return rows
      } catch (e: any) {
        listError.value = e?.message ?? String(e)
        return []
      } finally {
        loadingList.value = false
      }
    })()

    conversationsCache.set(key, { data: conversations.value, timestamp: 0, inFlight: p })
    try {
      const rows = await p
      conversations.value = rows
      fetched.value = true
      // 写入缓存
      conversationsCache.set(key, { data: rows, timestamp: Date.now() })
      return rows
    } catch {
      conversationsCache.delete(key)
      fetched.value = true
      return []
    }
  }

  const invalidateList = () => {
    fetched.value = false
    // 同时清会话列表缓存（让下一次 fetchConversations 真正去拉新数据）
    conversationsCache.clear()
  }

  // -------------------------------------------------------------------
  // 工作台 (staff/admin): 拉全部会话 (可选按状态过滤) 一次性拿到最后一条 + 未读
  //   - 走 RPC rpc_chat_admin_list_conversations() (避免重复拼接)
  // -------------------------------------------------------------------
  const listAdminConversations = async (
    status: ChatConversationStatus | 'all' = 'open',
    options?: { skipCache?: boolean },
  ): Promise<ChatConversation[]> => {
    const key = `staff:${status}`

    // skipCache: 强制重新拉
    if (options?.skipCache) {
      conversationsCache.delete(key)
    }

    // 缓存命中
    if (!options?.skipCache) {
      const cached = getCached(conversationsCache, key, LIST_CACHE_TTL_MS)
      if (cached) {
        conversations.value = cached
        fetched.value = true
        return cached
      }
    }

    // 复用 in-flight
    const entry = conversationsCache.get(key)
    if (entry?.inFlight) {
      loadingList.value = true
      try {
        const data = await entry.inFlight
        conversations.value = data
        fetched.value = true
        return data
      } catch {
        return []
      } finally {
        loadingList.value = false
      }
    }

    const p = (async () => {
      loadingList.value = true
      listError.value = null
      try {
        const statusArg = status === 'all' ? null : status
        const { data, error } = await (supabase as any)
          .rpc('rpc_chat_admin_list_conversations', {
            p_status: statusArg,
            p_limit: 200,
            p_offset: 0,
          })
        if (error) throw error
        const rows = (data ?? []) as any[]
        return rows.map((r) => ({
          id: r.id,
          account_id: r.account_id,
          subject_order_id: r.subject_order_id,
          assigned_to: r.assigned_to,
          status: r.status,
          last_message_at: r.last_message_at_actual ?? r.last_message_at,
          created_at: r.created_at,
          updated_at: r.updated_at,
          account: { account_name: r.account_name ?? '—', company_name: r.company_name ?? '' },
          subject_order: r.order_no ? { order_no: r.order_no, status: '' } : null,
          assigned: r.assigned_to
            ? { id: r.assigned_to, full_name: r.assigned_name ?? null, role: '' }
            : null,
          last_message: r.last_message_body
            ? {
                body: r.last_message_body,
                sender_id: r.last_message_sender,
                created_at: r.last_message_at_actual ?? r.last_message_at,
                message_type: 'text' as const,
              }
            : null,
          unread_count: Number(r.unread_for_me ?? 0),
        }))
      } catch (e: any) {
        listError.value = e?.message ?? String(e)
        return []
      } finally {
        loadingList.value = false
      }
    })()

    conversationsCache.set(key, { data: conversations.value, timestamp: 0, inFlight: p })
    try {
      const out = await p
      conversations.value = out
      fetched.value = true
      conversationsCache.set(key, { data: out, timestamp: Date.now() })
      return out
    } catch {
      conversationsCache.delete(key)
      fetched.value = true
      return []
    }
  }

  // -------------------------------------------------------------------
  // 工作台分组: 按 account_id 聚合
  // - 返回: 每个 account 的 "聊天分组", 下面是 ordered 会话列表
  // -------------------------------------------------------------------
  const groupByAccount = (rows: ChatConversation[] = conversations.value) => {
    const groups = new Map<
      string,
      {
        account_id: string
        account_name: string
        company_name: string
        conversations: ChatConversation[]
        total_unread: number
        latest_message_at: string | null
      }
    >()
    for (const c of rows) {
      const key = c.account_id
      if (!groups.has(key)) {
        groups.set(key, {
          account_id: key,
          account_name: c.account?.account_name ?? '—',
          company_name: c.account?.company_name ?? '',
          conversations: [],
          total_unread: 0,
          latest_message_at: null,
        })
      }
      const g = groups.get(key)!
      g.conversations.push(c)
      g.total_unread += c.unread_count ?? 0
      const ts = c.last_message_at ?? c.updated_at
      if (ts && (!g.latest_message_at || ts > g.latest_message_at)) {
        g.latest_message_at = ts
      }
    }
    const list = Array.from(groups.values()).sort((a, b) => {
      if (!a.latest_message_at) return 1
      if (!b.latest_message_at) return -1
      return b.latest_message_at.localeCompare(a.latest_message_at)
    })
    for (const g of list) {
      g.conversations.sort((a, b) =>
        (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''),
      )
    }
    return list
  }

  // -------------------------------------------------------------------
  // 关闭/重开会话 (staff): 更新 chat_conversations.status
  // -------------------------------------------------------------------
  const setConversationStatus = async (
    conversationId: string,
    nextStatus: ChatConversationStatus,
  ): Promise<void> => {
    const { error } = await (supabase.from('chat_conversations') as any)
      .update({ status: nextStatus })
      .eq('id', conversationId)
    if (error) throw error
    invalidateList()
  }

  // -------------------------------------------------------------------
  // 指派 / 改变 assigned_to
  // -------------------------------------------------------------------
  const assignConversation = async (
    conversationId: string,
    staffUserId: string | null,
  ): Promise<void> => {
    const { error } = await (supabase.from('chat_conversations') as any)
      .update({ assigned_to: staffUserId })
      .eq('id', conversationId)
    if (error) throw error
    invalidateList()
  }

  // -------------------------------------------------------------------
  // 客服主动开启一个 account 的新会话 (一般咨询, 无 order)
  // -------------------------------------------------------------------
  const ensureStaffConversation = async (
    accountId: string,
    subjectOrderId: string | null = null,
  ): Promise<ChatConversation> => {
    return await ensureConversation({
      account_id: accountId,
      subject_order_id: subjectOrderId,
    })
  }

  // -------------------------------------------------------------------
  // 找/创建会话
  //   - 客户模式: 传入 subject_order_id (可空), 自动用当前主账号
  //   - staff 模式: 传入 account_id, 创建该客户主账号下的会话
  // 如果 (account_id, subject_order_id) 已经存在 open 会话, 直接返回
  // -------------------------------------------------------------------
  const ensureConversation = async (params: {
    account_id: string
    subject_order_id?: string | null
  }): Promise<ChatConversation> => {
    const subject = params.subject_order_id ?? null
    // 1. 查是否已存在
    let q = supabase
      .from('chat_conversations')
      .select(CONV_SELECT)
      .eq('account_id', params.account_id)
      .eq('status', 'open')
    if (subject) {
      q = q.eq('subject_order_id', subject)
    } else {
      q = q.is('subject_order_id', null)
    }
    const { data: existing } = await q.maybeSingle()
    if (existing) return existing as ChatConversation

    // 2. 创建
    const { data: created, error: cErr } = await supabase
      .from('chat_conversations')
      .insert({
        account_id: params.account_id,
        subject_order_id: subject,
        status: 'open',
      } as any)
      .select(CONV_SELECT)
      .single()
    if (cErr) throw cErr

    // 3. 加入会话成员 (客户自己 + 当前 staff 员工)
    const me = (await supabase.auth.getUser()).data.user
    if (!me) throw new Error('未登录')
    const { data: myRow } = await supabase.from('users').select('role').eq('id', me.id).single() as { data: { role: string } | null }
    const memberType: ChatMemberType = myRow?.role === 'customer' ? 'customer' : 'staff'

    // 客户的 user_id 通常指向父账号; 但 staff (admin/checker) 才显式插入
    const memberRows: { conversation_id: string; user_id: string; member_type: ChatMemberType }[] = [
      { conversation_id: (created as any).id, user_id: me.id, member_type: memberType },
    ]

    // 注: 当前架构中'客户'的 auth.uid() 对应父账号的 user_id, 一个客户登录态
    // 全程只有 1 个 auth user (多人共享一个父账号登录). 客户自己不必再插
    // 'siblings'. staff 端会在 OrderDetailPage 调用 ensureConversation 时
    // 把当前 staff 也加入.
    const { error: mErr } = await supabase
      .from('chat_conversation_members')
      .insert(memberRows as any)
    if (mErr) throw mErr

    await invalidateList()
    return created as ChatConversation
  }

  // -------------------------------------------------------------------
  // 拉单个会话的成员 + 其它信息
  // -------------------------------------------------------------------
  const fetchMembers = async (conversationId: string, options?: { skipCache?: boolean }): Promise<ChatMember[]> => {
    // skipCache 强制重拉
    if (options?.skipCache) {
      membersCache.delete(conversationId)
    }
    return getOrSetInFlight(membersCache, conversationId, async () => {
      const { data, error } = await supabase
        .from('chat_conversation_members')
        .select(`
          id, conversation_id, user_id, member_type,
          last_read_message_id, last_read_at, joined_at, left_at,
          user:users!chat_conversation_members_user_id_fkey(id, full_name, role, account_id)
        `)
        .eq('conversation_id', conversationId)
        .is('left_at', null)
      if (error) throw error
      return (data ?? []) as ChatMember[]
    })
  }

  // -------------------------------------------------------------------
  // 消息列表（cursor-based 分页）
  //   - 不传 before: 拉最近 N 条（首页）
  //   - 传 before: 拉该消息之前（更早的）N 条
  // 缓存策略：仅缓存首页（不传 before），分页不缓存
  // -------------------------------------------------------------------
  const fetchMessages = async (
    conversationId: string,
    limitOrOpts: number | { limit?: number; before?: string } = 50,
    options?: { skipCache?: boolean },
  ): Promise<ChatMessage[]> => {
    // 兼容旧调用: fetchMessages(id, 100, { skipCache })
    const opts = typeof limitOrOpts === 'object' ? limitOrOpts : { limit: limitOrOpts }
    const limit = opts.limit ?? 50
    const before = opts.before
    const isFirstPage = !before

    // 首页用 in-flight + 缓存；分页不缓存（每次都查）
    if (isFirstPage) {
      if (options?.skipCache) {
        messagesCache.delete(conversationId)
      }
      return getOrSetInFlight(messagesCache, conversationId, async () => {
        const { data, error } = await supabase
          .from('chat_messages')
          .select(`
            id, conversation_id, sender_id, message_type, message_kind, body,
            client_message_id, reply_to_id, created_at, edited_at, deleted_at,
            sender:users!chat_messages_sender_id_fkey(id, full_name, role)
          `)
          .eq('conversation_id', conversationId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)
        if (error) throw error
        // 翻转成升序（按时间顺序）
        return ((data ?? []) as ChatMessage[]).slice().reverse()
      })
    }

    // 分页查询：找 beforeMessage.created_at，然后取它之前的 N 条
    // 用单个查询 + 索引字段，避免 2 次 round-trip
    const { data: beforeMsg, error: beforeErr } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('id', before)
      .maybeSingle()
    if (beforeErr) throw beforeErr
    const beforeAt = (beforeMsg as any)?.created_at as string | undefined
    if (!beforeAt) {
      // before 找不到（被删除）→ 退到拉最近 N 条
      // 但要注意：客户端期望"更早的"，所以直接返回空数组
      return []
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        id, conversation_id, sender_id, message_type, message_kind, body,
        client_message_id, reply_to_id, created_at, edited_at, deleted_at,
        sender:users!chat_messages_sender_id_fkey(id, full_name, role)
      `)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .lt('created_at', beforeAt)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
    if (error) throw error
    // 翻转成升序
    return ((data ?? []) as ChatMessage[]).slice().reverse()
  }

  // -------------------------------------------------------------------
  const fetchMessageCount = async (conversationId: string): Promise<number> => {
    const cached = getCached(conversationMessageCounts, conversationId, MESSAGE_COUNT_TTL_MS)
    if (cached !== undefined) return cached
    return getOrSetInFlight(conversationMessageCounts, conversationId, async () => {
      const { count, error } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
      if (error) throw error
      return count ?? 0
    }, MESSAGE_COUNT_TTL_MS)
  }

  // -------------------------------------------------------------------
  // 发送消息 (idempotent based on client_message_id)
  // -------------------------------------------------------------------
  const sendMessage = async (
    conversationId: string,
    body: string,
    clientMessageId: string = uuid(),
    replyToId: string | null = null,
  ): Promise<ChatMessage> => {
    const me = (await supabase.auth.getUser()).data.user
    if (!me) throw new Error('未登录')
    const trimmed = body.trim()
    if (!trimmed) throw new Error('消息内容为空')

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        sender_id: me.id,
        message_type: 'text',
        message_kind: 'text',
        body: trimmed,
        client_message_id: clientMessageId,
        reply_to_id: replyToId,
      } as any)
      .select(`
        id, conversation_id, sender_id, message_type, message_kind, body,
        client_message_id, reply_to_id, created_at, edited_at, deleted_at,
        sender:users!chat_messages_sender_id_fkey(id, full_name, role)
      `)
      .single()
    if (error) {
      // 重复 client_message_id → idempotent: 返回已存在的那条
      if ((error as any).code === '23505') {
        const { data: existing } = await supabase
          .from('chat_messages')
          .select(`
            id, conversation_id, sender_id, message_type, message_kind, body,
            client_message_id, reply_to_id, created_at, edited_at, deleted_at,
            sender:users!chat_messages_sender_id_fkey(id, full_name, role)
          `)
          .eq('sender_id', me.id)
          .eq('client_message_id', clientMessageId)
          .maybeSingle()
        if (existing) return existing as ChatMessage
      }
      throw error
    }
    return data as ChatMessage
  }

  // -------------------------------------------------------------------
  // M2: 拉一个会话的所有附件 (单 batch 内联)
  // -------------------------------------------------------------------
  const fetchAttachments = async (messageIds: string[], options?: { skipCache?: boolean }): Promise<Record<string, ChatMessageAttachment[]>> => {
    if (messageIds.length === 0) return {}

    // 优先从缓存逐个获取
    const result: Record<string, ChatMessageAttachment[]> = {}
    const missing: string[] = []
    if (!options?.skipCache) {
      for (const mid of messageIds) {
        const cached = getCached(attachmentsCache, mid)
        if (cached) result[mid] = cached
        else missing.push(mid)
      }
      if (missing.length === 0) return result
    } else {
      missing.push(...messageIds)
    }

    // 同一组 missing 在请求中就复用 promise（去重并发）
    const key = missing.slice().sort().join(',')
    if (attachmentsInFlight.has(key)) {
      const inflight = await attachmentsInFlight.get(key)!
      return { ...result, ...inflight }
    }

    const p = (async () => {
      const { data, error } = await supabase
        .from('chat_message_attachments')
        .select('id, message_id, storage_path, mime, size_bytes, width, height')
        .in('message_id', missing)
      if (error) throw error
      const fetched: Record<string, ChatMessageAttachment[]> = {}
      for (const row of (data ?? []) as any[]) {
        const att = row as ChatMessageAttachment
        if (!fetched[att.message_id]) fetched[att.message_id] = []
        fetched[att.message_id].push(att)
        setCached(attachmentsCache, att.message_id, [att])
      }
      // 没附件的消息也缓存空数组，避免下次又查
      for (const mid of missing) {
        if (!fetched[mid]) {
          setCached(attachmentsCache, mid, [])
          fetched[mid] = []
        }
      }
      return fetched
    })()

    attachmentsInFlight.set(key, p)
    try {
      const data = await p
      return { ...result, ...data }
    } finally {
      attachmentsInFlight.delete(key)
    }
  }

  // -------------------------------------------------------------------
  // M2: 拉 metadata (订单卡片 / 自定义 payload)
  // ---------------------------------------------------------------------
  const fetchMetadata = async (messageIds: string[], options?: { skipCache?: boolean }): Promise<Record<string, ChatMessageMetadata>> => {
    if (messageIds.length === 0) return {}

    // 优先从缓存逐个获取
    const out: Record<string, ChatMessageMetadata> = {}
    const missing: string[] = []
    if (!options?.skipCache) {
      for (const mid of messageIds) {
        const cached = getCached(metadataCache, mid)
        if (cached) out[mid] = cached
        else missing.push(mid)
      }
      if (missing.length === 0) return out
    } else {
      missing.push(...messageIds)
    }

    // 同一组 missing 在请求中就复用 promise（去重并发）
    const key = missing.slice().sort().join(',')
    if (metadataInFlight.has(key)) {
      const inflight = await metadataInFlight.get(key)!
      return { ...out, ...inflight }
    }

    const p = (async () => {
      const { data, error } = await supabase
        .from('chat_message_metadata')
        .select('message_id, payload, updated_at')
        .in('message_id', missing)
      if (error) throw error
      const fetched: Record<string, ChatMessageMetadata> = {}
      for (const row of (data ?? []) as any[]) {
        const meta = row as ChatMessageMetadata
        fetched[meta.message_id] = meta
        setCached(metadataCache, meta.message_id, meta)
      }
      // 没 metadata 的消息也缓存空对象
      for (const mid of missing) {
        if (!fetched[mid]) {
          const empty: ChatMessageMetadata = { message_id: mid, payload: {}, updated_at: '' }
          setCached(metadataCache, mid, empty)
          fetched[mid] = empty
        }
      }
      return fetched
    })()

    metadataInFlight.set(key, p)
    try {
      const data = await p
      return { ...out, ...data }
    } finally {
      metadataInFlight.delete(key)
    }
  }

  // -------------------------------------------------------------------
  // M2: 发送订单卡片
  //   - 通过 RPC 一次性写消息 + metadata
  // -------------------------------------------------------------------
  const sendOrderCard = async (
    conversationId: string,
    orderId: string,
    clientMessageId: string = uuid(),
  ): Promise<{ messageId: string }> => {
    const { data, error } = await (supabase as any).rpc(
      'rpc_chat_create_order_card_message',
      {
        p_conversation: conversationId,
        p_order_id: orderId,
        p_client_message_id: clientMessageId,
      },
    )
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    return { messageId: row?.message_id }
  }

  // -------------------------------------------------------------------
  // M1 batch: 批量关闭 / 重开
  // -------------------------------------------------------------------
  const batchSetStatus = async (
    conversationIds: string[],
    nextStatus: ChatConversationStatus,
  ): Promise<void> => {
    if (conversationIds.length === 0) return
    const { error } = await (supabase.from('chat_conversations') as any)
      .update({ status: nextStatus })
      .in('id', conversationIds)
    if (error) throw error
    invalidateList()
  }

  const batchReassign = async (
    conversationIds: string[],
    staffUserId: string | null,
  ): Promise<void> => {
    if (conversationIds.length === 0) return
    const { error } = await (supabase.from('chat_conversations') as any)
      .update({ assigned_to: staffUserId })
      .in('id', conversationIds)
    if (error) throw error
    invalidateList()
  }

  // -------------------------------------------------------------------
  // 标记已读 (RPC: 精确化位点 + 写 per-message read punct)
  // -------------------------------------------------------------------
  const markRead = async (conversationId: string, messageId: string): Promise<void> => {
    const { error } = await (supabase as any)
      .rpc('rpc_chat_mark_read', {
        p_conversation: conversationId,
        p_message_id: messageId,
      })
    if (error) {
      // 兜底: 走老逻辑, 不阻塞 UI
      const me = (await supabase.auth.getUser()).data.user
      if (!me) return
      await (supabase.from('chat_conversation_members') as any)
        .update({
          last_read_message_id: messageId,
          last_read_at: new Date().toISOString(),
        })
        .eq('conversation_id', conversationId)
        .eq('user_id', me.id)
        .is('left_at', null)
    }
    // 列表未读自动刷 (realtime 也会推, 这里触发 invalidate)
    invalidateList()
  }

  // -------------------------------------------------------------------
  // Phase 3: Typing 广播 (6s TTL)
  // ---------------------------------------------------------------------
  const notifyTyping = async (conversationId: string): Promise<void> => {
    const me = (await supabase.auth.getUser()).data.user
    if (!me) return
    const nowIso = new Date().toISOString()
    const expires = new Date(Date.now() + 6_000).toISOString()
    const { error } = await (supabase.from('chat_typing') as any)
      .upsert({
        conversation_id: conversationId,
        user_id: me.id,
        started_at: nowIso,
        expires_at: expires,
      }, { onConflict: 'conversation_id,user_id' })
    if (error && typeof console !== 'undefined') {
      console.warn('[chat] notifyTyping failed', error)
    }
  }

  /**
   * 拉一个会话"正在输入的人" (排除自己, 排除已过期)
   */
  const fetchTyping = async (conversationId: string): Promise<{ user_id: string; full_name: string | null }[]> => {
    // 缓存命中直接返回（避免频繁 SELECT）
    const TYPING_CACHE_TTL_MS = 5_000
    const cached = getCached(typingCache, conversationId, TYPING_CACHE_TTL_MS)
    if (cached) return cached

    return getOrSetInFlight(typingCache, conversationId, async () => {
      const me = (await supabase.auth.getUser()).data.user
      const { data, error } = await supabase
        .from('chat_typing')
        .select(`
          user_id,
          user:users!chat_typing_user_id_fkey(id, full_name, role)
        `)
        .eq('conversation_id', conversationId)
        .gt('expires_at', new Date().toISOString())
      if (error) return []
      const list = (data ?? []) as any[]
      return list
        .filter((r) => r.user_id !== me?.id)
        .map((r) => ({ user_id: r.user_id, full_name: r.user?.full_name ?? null }))
    }, TYPING_CACHE_TTL_MS)
  }

  // -------------------------------------------------------------------
  // Phase 3.5: 编辑 / 撤回
  // ---------------------------------------------------------------------
  const editMessage = async (messageId: string, newBody: string): Promise<void> => {
    const { error } = await (supabase as any)
      .rpc('rpc_chat_edit_message', {
        p_message_id: messageId,
        p_new_body: newBody,
      })
    if (error) throw error
  }

  const deleteMessage = async (messageId: string): Promise<void> => {
    const { error } = await (supabase as any)
      .rpc('rpc_chat_soft_delete_message', {
        p_message_id: messageId,
      })
    if (error) throw error
  }

  // -------------------------------------------------------------------
  // Phase 3.5: 客服接管 / 转接
  // ---------------------------------------------------------------------
  const joinConversation = async (conversationId: string): Promise<void> => {
    const { error } = await (supabase as any)
      .rpc('rpc_chat_join_conversation', {
        p_conversation: conversationId,
      })
    if (error) throw error
    invalidateList()
  }

  const transferConversation = async (
    conversationId: string,
    toStaffId: string | null,
  ): Promise<void> => {
    const { error } = await (supabase as any)
      .rpc('rpc_chat_transfer_conversation', {
        p_conversation: conversationId,
        p_to_staff_id: toStaffId,
      })
    if (error) throw error
    invalidateList()
  }

  // Phase 4: 系统消息 (staff 手动 / 自动)
  const postSystemMessage = async (
    conversationId: string,
    body: string,
    meta?: Record<string, any> | null,
  ): Promise<string> => {
    const { data, error } = await (supabase as any)
      .rpc('rpc_chat_post_system_message', {
        p_conversation: conversationId,
        p_body: body,
        p_meta: meta ?? null,
      })
    if (error) throw error
    invalidateList()
    return data as string
  }

  // -------------------------------------------------------------------
  // Phase 3: 消息搜索 (staff 偏多)
  // ---------------------------------------------------------------------
  const searchMessages = async (
    keyword: string,
    accountId?: string | null,
    limit = 50,
  ): Promise<ChatSearchHit[]> => {
    const { data, error } = await (supabase as any)
      .rpc('rpc_chat_search_messages', {
        p_keyword: keyword,
        p_account_id: accountId ?? null,
        p_limit: limit,
      })
    if (error) throw error
    return (data ?? []) as ChatSearchHit[]
  }

  // -------------------------------------------------------------------
  // 在线状态 upsert
  // -------------------------------------------------------------------
  const heartbeat = async (deviceId = 'web', status: ChatPresenceStatus = 'online'): Promise<void> => {
    const me = (await supabase.auth.getUser()).data.user
    if (!me) return
    const { error } = await supabase
      .from('chat_presence')
      .upsert({
        user_id: me.id,
        device_id: deviceId,
        status,
        last_seen_at: new Date().toISOString(),
      } as any)
    if (error) {
      // 心跳失败不阻塞 UI
      if (typeof console !== 'undefined') console.warn('[chat] heartbeat failed', error)
    }
  }

  const fetchPresence = async (userIds: string[]): Promise<ChatPresence[]> => {
    if (userIds.length === 0) return []
    const { data, error } = await supabase
      .from('chat_presence')
      .select(`
        user_id, device_id, status, last_seen_at, updated_at,
        user:users!chat_presence_user_id_fkey(id, full_name, role, account_id)
      `)
      .in('user_id', userIds)
    if (error) throw error
    return (data ?? []) as ChatPresence[]
  }

  // -------------------------------------------------------------------
  // Realtime 订阅（控制器）
  // -------------------------------------------------------------------
  const subscribeConversation = (
    conversationId: string,
    onMessage: (msg: ChatMessage) => void,
    onMember: (member: ChatMember) => void,
    onUpdated?: (msg: ChatMessage) => void,
  ): { unsubscribe: () => Promise<void> } => {
    const channel = supabase
      .channel(`chat:${conversationId}`, {
        config: { broadcast: { self: false }, presence: { key: '' } },
      })
      .on(
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload: any) => {
          const m = payload?.new as ChatMessage
          if (m) {
            // 把新消息 append 到缓存（而不是清空）
            // - 避免下次打开会话时 cache miss 又查 DB
            // - realtime 回调已经把消息推到 UI，缓存里也有，无需重拉
            const entry = messagesCache.get(conversationId)
            if (entry && isCacheValid(entry)) {
              // 仅在该消息还没在缓存里时 append（避免重复）
              if (!entry.data.some((x) => x.id === m.id)) {
                entry.data = [...entry.data, m]
              }
            }
            onMessage(m)
          }
        },
      )
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload: any) => {
          const m = payload?.new as ChatMessage
          if (!m) return
          // UPDATE（编辑/撤回）: 就地替换缓存里的旧消息
          const entry = messagesCache.get(conversationId)
          if (entry && isCacheValid(entry)) {
            const idx = entry.data.findIndex((x) => x.id === m.id)
            if (idx !== -1) {
              entry.data = [...entry.data.slice(0, idx), m, ...entry.data.slice(idx + 1)]
            }
          }
          if (onUpdated) onUpdated(m)
          else onMessage(m) // 兼容旧调用方
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'chat_conversation_members', filter: `conversation_id=eq.${conversationId}` },
        (payload: any) => {
          const m = payload?.new as ChatMember | null
          if (m) {
            // 成员状态变更（如已读位置变更），就地更新缓存里的成员
            const entry = membersCache.get(conversationId)
            if (entry && isCacheValid(entry)) {
              const idx = entry.data.findIndex((x) => x.id === m.id)
              if (idx !== -1) {
                entry.data = [...entry.data.slice(0, idx), m, ...entry.data.slice(idx + 1)]
              } else {
                entry.data = [...entry.data, m]
              }
            }
            onMember(m)
          }
        },
      )
      .subscribe()
    return {
      unsubscribe: async () => {
        try {
          // 真正等待 channel 断开（避免下次重新订阅时残留回调）
          await channel.unsubscribe()
          supabase.removeChannel(channel)
        } catch { /* ignore */ }
      },
    }
  }

  return {
    conversations: computed(() => conversations.value),
    loadingList: computed(() => loadingList.value),
    listError: computed(() => listError.value),
    fetched: computed(() => fetched.value),
    fetchConversations,
    listAdminConversations,
    groupByAccount,
    setConversationStatus,
    assignConversation,
    batchSetStatus,
    batchReassign,
    ensureStaffConversation,
    ensureConversation,
    fetchMembers,
    fetchMessages,
    fetchAttachments,
    fetchMetadata,
    fetchMessageCount,
    sendOrderCard,
    sendMessage,
    editMessage,
    deleteMessage,
    joinConversation,
    transferConversation,
    postSystemMessage,
    markRead,
    notifyTyping,
    fetchTyping,
    searchMessages,
    heartbeat,
    fetchPresence,
    subscribeConversation,
    invalidateList,
    invalidateCache: invalidateConversationCache,
  }
}
