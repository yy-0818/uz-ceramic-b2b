<!--
  ChatPanel —— 单会话聊天面板 (M2)
  - 自动 ensureConversation (account_id + subject_order_id)
  - 拉历史 + 订阅 realtime 增量
  - 本地 optimistic 发送 (文本 + 图片) + 失败重试
  - 标记已读
  - 支持 '发送订单卡片' 按钮触发外部函数 (OrderDetailPage 提供)
  - 支持 signed URL 预取 + 一次性下发到 ChatBubble
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Loader2, ArrowLeft, ExternalLink, Wifi, WifiOff, Package, ArrowRightLeft, UserPlus, X } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import {
  useChat,
  type ChatMessage,
  type ChatMember,
  type ChatConversation,
  type ChatMessageAttachment,
  type ChatMessageMetadata,
  presenceState,
} from '@/composables/useChat'
import { useChatUpload } from '@/composables/useChatUpload'
import { useAuth } from '@/composables/useAuth'
import { useOrderStatusCache } from '@/composables/useOrderStatusCache'
import { useTeamMembers } from '@/composables/useTeamMembers'
import { useMessageReactions } from '@/composables/useMessageReactions'
import { supabase } from '@/lib/supabase'
import ChatBubble from './ChatBubble.vue'
import ChatTyping from './ChatTyping.vue'
import ChatDateDivider from './ChatDateDivider.vue'
import ChatComposer, { type PendingImage } from './ChatComposer.vue'
import ChatStatusDot from './ChatStatusDot.vue'
import ChatAvatar from './ChatAvatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import ChatPanelHeader from './ChatPanelHeader.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatEditBar from './ChatEditBar.vue'

const props = defineProps<{
  accountId: string
  subjectOrderId?: string | null
  contextLabel?: string
  to?: 'customer' | 'staff'
  /** 嵌入式使用 (OrderDetailPage 嵌入) 时隐藏顶部 */
  embedded?: boolean
  /** 嵌入式使用, 允许关闭面板 (父组件通过 v-model 控制) */
  visible?: boolean
  /** M2: 由外部提供 "发送订单卡片" 函数. 返回 Promise<string|void> (消息 ID). */
  sendOrderCardHandler?: () => Promise<string | void> | string | void
  /** M2: 当前订单的订单卡片信息 (客服/客户在订单详情下) */
  orderCardInfo?: {
    order_no: string
    status?: string
    item_count?: number
    total_boxes?: number
    total_amount?: number
    updated_at?: string
  } | null
}>()

const emit = defineEmits<{
  close: []
  message: [msg: ChatMessage]
}>()

const { t } = useI18n()
const chat = useChat()
const uploader = useChatUpload()
const { appUser } = useAuth()
const statusCache = useOrderStatusCache()
const reactionsComposable = useMessageReactions()

const conversation = ref<ChatConversation | null>(null)
const members = ref<ChatMember[]>([])
const messages = ref<ChatMessage[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const connection = ref<'online' | 'reconnecting' | 'offline'>(navigator.onLine ? 'online' : 'offline')
const lastMessageId = ref<string | null>(null)
const staffTyping = ref(false)

// M2: 附件 + metadata
const attachmentsByMessage = ref<Record<string, ChatMessageAttachment[]>>({})
const metadataByMessage = ref<Record<string, ChatMessageMetadata>>({})
const signedUrls = ref<Record<string, string>>({})

let typingTimer: number | undefined
const onTyping = () => {
  if (!conversation.value) return
  if (typingTimer) return
  typingTimer = window.setTimeout(() => { typingTimer = undefined }, 4000)
  chat.notifyTyping(conversation.value.id).catch(() => { /* ignore */ })
}

// M2: 待上传图片 (composer 推入)
interface PendingUpload {
  clientMessageId: string
  localUrl: string
  file: File
  status: 'uploading' | 'failed' | 'sent'
  failure?: string
  messageId?: string
}
const pendingUploads = ref<PendingUpload[]>([])

// Phase 3: typing
const typingUsers = ref<{ user_id: string; full_name: string | null }[]>([])
let typingFetchTimer: number | undefined
let typingBroadcastTimer: number | undefined

// Phase 3.5: 编辑 / 撤回
const editingMessage = ref<ChatMessage | null>(null)
const editDraft = ref('')
const editSubmitting = ref(false)

// Phase 3.5: 转接
const { members: staffOptions, load: loadTeam } = useTeamMembers()
const showTransferMenu = ref(false)
const showActionMenu = ref(false)

// 本地发送中的文本消息
interface PendingMessage {
  client_message_id: string
  body: string
  created_at: string
  status: 'pending' | 'failed'
  failure?: string
}
const pending = ref<PendingMessage[]>([])

// 子组件引用
const messageList = ref<InstanceType<typeof ChatMessageList> | null>(null)

const scrollToBottom = () => {
  messageList.value?.scrollToBottom()
}

type Row =
  | { kind: 'msg'; message: ChatMessage; delivery: 'pending' | 'sent' | 'failed' | 'read'; failure?: string }
  | { kind: 'date'; iso: string }
  | { kind: 'typing' }

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  let lastDate = ''
  const pushDate = (iso: string) => {
    const d = new Date(iso).toDateString()
    if (d !== lastDate) {
      out.push({ kind: 'date', iso })
      lastDate = d
    }
  }
  for (const m of messages.value) {
    pushDate(m.created_at)
    if (m.message_type === 'text' || m.message_type === 'system') {
      out.push({ kind: 'msg', message: m, delivery: readDelivery(m) })
    }
  }
  for (const p of pending.value) {
    pushDate(p.created_at)
    out.push({
      kind: 'msg',
      message: {
        id: p.client_message_id,
        conversation_id: conversation.value?.id ?? '',
        sender_id: appUser.value?.id ?? '',
        message_type: 'text',
        message_kind: 'text',
        body: p.body,
        client_message_id: p.client_message_id,
        reply_to_id: null,
        created_at: p.created_at,
        edited_at: null,
        deleted_at: null,
        sender: { id: appUser.value?.id ?? '', full_name: appUser.value?.full_name ?? null, role: appUser.value?.role ?? 'customer' },
      } as ChatMessage,
      delivery: p.status === 'pending' ? 'pending' : 'failed',
      failure: p.failure,
    })
  }
  // M2: pending images 作为 'pending' 状态的 image message
  for (const u of pendingUploads.value) {
    pushDate(new Date().toISOString())
    const mm: ChatMessage = {
      id: u.clientMessageId,
      conversation_id: conversation.value?.id ?? '',
      sender_id: appUser.value?.id ?? '',
      message_type: 'text',
      message_kind: 'image',
      body: '[图片]',
      client_message_id: u.clientMessageId,
      reply_to_id: null,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      sender: { id: appUser.value?.id ?? '', full_name: appUser.value?.full_name ?? null, role: appUser.value?.role ?? 'customer' },
    }
    const fakeAtt: ChatMessageAttachment = {
      id: u.clientMessageId,
      message_id: u.clientMessageId,
      storage_path: u.clientMessageId, // dummy path, 但 pending 时不显示图
      mime: u.file.type,
      size_bytes: u.file.size,
      width: null,
      height: null,
    }
    attachmentsByMessage.value[u.clientMessageId] = [fakeAtt]
    out.push({
      kind: 'msg',
      message: mm,
      delivery: u.status === 'uploading' ? 'pending' : 'failed',
      failure: u.failure,
    })
  }
  if (staffTyping.value) out.push({ kind: 'typing' })
  return out
})

function readDelivery(m: ChatMessage): 'sent' | 'read' {
  if (!appUser.value) return 'sent'
  // 自己的消息不应该因为自己已读就显示为"已读"
  // 这里需要查找"对方"成员的 last_read_message_id
  // 如果只有自己一个成员（如 staff 看到自己发的消息），则只显示"已发送"
  const others = members.value.filter((mm) => mm.user_id !== appUser.value!.id)
  // 没有对方成员 → 对方还没加入会话 → 只显示"已发送"
  if (others.length === 0) return 'sent'
  // 只要任一对方成员读到了这条消息，就算"已读"
  return others.some((other) => other.last_read_message_id && other.last_read_message_id >= m.id)
    ? 'read'
    : 'sent'
}

let unsub: (() => Promise<void>) | null = null
let typingChannel: any = null
let openInFlight: Promise<void> | null = null
let openingConversationId: string | null = null

/**
 * 同步 unsubscribed channel. supabase realtime 的 unsubscribe/removeChannel 异步, 必须 await
 * 才能避免 "cannot add postgres_changes callbacks ... after subscribe()"
 */
const safeUnsub = async () => {
  const u = unsub
  unsub = null
  if (u) {
    // 真正等待 channel 断开（sub 返回的 unsubscribe 是 async）
    try { await u() } catch { /* ignore */ }
  }

  const tc = typingChannel
  typingChannel = null
  if (tc) {
    try {
      const removed = await supabase.removeChannel(tc)
      await removed
    } catch { /* ignore */ }
  }
}

const openConversation = async (opts?: { skipCache?: boolean }) => {
  // mutex: 同一会话并发请求直接复用
  const targetId = props.accountId ?? ''
  if (openInFlight && openingConversationId === targetId) {
    return openInFlight
  }
  const p = (async () => {
    loading.value = true
    loadError.value = null
    try {
      await safeUnsub()

      const conv = await chat.ensureConversation({
        account_id: props.accountId,
        subject_order_id: props.subjectOrderId ?? null,
      })
      conversation.value = conv
      const [ms, mems] = await Promise.all([
        chat.fetchMessages(conv.id, 100, { skipCache: opts?.skipCache }),
        chat.fetchMembers(conv.id, { skipCache: opts?.skipCache }),
      ])
      messages.value = ms
      members.value = mems
      lastMessageId.value = ms.length > 0 ? ms[ms.length - 1].id : null
      await reloadExtras(ms.map((m) => m.id), { skipCache: opts?.skipCache })
      if (lastMessageId.value) {
        chat.markRead(conv.id, lastMessageId.value).catch(() => { /* ignore */ })
      }
      const sub = chat.subscribeConversation(
        conv.id,
        (msg) => {
          if (msg.sender_id === appUser.value?.id) {
            const idx = pending.value.findIndex((p) => p.client_message_id === msg.client_message_id)
            if (idx !== -1) pending.value.splice(idx, 1)
            const uidx = pendingUploads.value.findIndex((u) => u.clientMessageId === msg.client_message_id)
            if (uidx !== -1) {
              const u = pendingUploads.value[uidx]
              pendingUploads.value.splice(uidx, 1)
              attachmentsByMessage.value[u.clientMessageId] = undefined as any
            }
            // 注意：不要为自己发的消息调 markRead
            // 避免自己发出去的消息立即显示为"已读"
            if (messages.value.some((mm) => mm.id === msg.id)) return
            messages.value.push(msg)
            lastMessageId.value = msg.id
            reloadExtras([msg.id])
            scrollToBottom()
            return
          }
          // 对方发的消息：推入列表 + 标记已读
          if (messages.value.some((mm) => mm.id === msg.id)) return
          messages.value.push(msg)
          lastMessageId.value = msg.id
          reloadExtras([msg.id])
          chat.markRead(conv.id, msg.id).catch(() => { /* ignore */ })
          scrollToBottom()
        },
        (member) => {
          const idx = members.value.findIndex((m) => m.id === member.id)
          if (idx === -1) members.value.push(member)
          else members.value[idx] = member
        },
        (updated) => {
          // M3.5: UPDATE 事件 (撤回 / 编辑). 替换本地消息
          const idx = messages.value.findIndex((mm) => mm.id === updated.id)
          if (idx !== -1) {
            messages.value[idx] = updated
          } else {
            messages.value.push(updated)
          }
          // 编辑中被撤回 → 清掉编辑态
          if (editingMessage.value?.id === updated.id && updated.deleted_at) {
            editingMessage.value = null
            editDraft.value = ''
          }
        },
      )
      unsub = sub.unsubscribe
      // Phase 3: 订阅 chat_typing (在主 channel 之后, 不会冲突)
      await subscribeTyping(conv.id)
      scrollToBottom()
    } catch (e: any) {
      loadError.value = e?.message ?? String(e)
    } finally {
      loading.value = false
      openingConversationId = null
      openInFlight = null
    }
  })()
  openInFlight = p
  openingConversationId = targetId
  return p
}

const subscribeTyping = async (conversationId: string) => {
  const tc = typingChannel
  typingChannel = null
  if (tc) {
    try {
      const removed = await supabase.removeChannel(tc)
      await removed
    } catch { /* ignore */ }
  }
  const channel = supabase
    .channel(`chat:typing:${conversationId}`)
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'chat_typing', filter: `conversation_id=eq.${conversationId}` },
      () => {
        refreshTyping(conversationId)
      },
    )
    .subscribe()
  typingChannel = channel
  await refreshTyping(conversationId)
}

const refreshTyping = async (conversationId: string) => {
  typingUsers.value = await chat.fetchTyping(conversationId)
  staffTyping.value = typingUsers.value.length > 0
}

const reloadExtras = async (messageIds: string[], opts?: { skipCache?: boolean }) => {
  if (messageIds.length === 0) return
  const atts = await chat.fetchAttachments(messageIds, { skipCache: opts?.skipCache })
  const metas = await chat.fetchMetadata(messageIds, { skipCache: opts?.skipCache })
  // 合并 (保留已有)
  attachmentsByMessage.value = { ...attachmentsByMessage.value, ...atts }
  metadataByMessage.value = { ...metadataByMessage.value, ...metas }
  // Phase 7: 批量 hydrate 订单卡片涉及的 order_id 状态, 让 ChatOrderCard 首屏就有 status
  const orderIds = Object.values(metas)
    .map((m) => (m as any)?.payload?.order_id)
    .filter((id): id is string => typeof id === 'string')
  statusCache.hydrate(orderIds)
  // 预签
  const paths = Object.values(atts).flat().map((a) => a.storage_path)
  if (paths.length) {
    await Promise.all(paths.map((p) => uploader.getSignedUrl(p).catch(() => null)))
    const m: Record<string, string> = { ...signedUrls.value }
    for (const p of paths) m[p] = '' // 占位重置
    // 复制最新 signedUrls
    const next = { ...signedUrls.value }
    for (const p of paths) {
      // 调用 getSignedUrl 已经把 url 写入 cache (uploader 内部); 我们还得取出
    }
    // 直接调用 uploader.getSignedUrl 拿 url
    for (const p of paths) {
      const u = await uploader.getSignedUrl(p).catch(() => null)
      if (u) next[p] = u
    }
    signedUrls.value = next
  }
}

onMounted(() => {
  openConversation()
  loadTeam()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('click', onDocClick)
})

onBeforeUnmount(async () => {
  await safeUnsub()
  if (typingFetchTimer) window.clearInterval(typingFetchTimer)
  if (typingBroadcastTimer) window.clearInterval(typingBroadcastTimer)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  document.removeEventListener('click', onDocClick)
  for (const u of pendingUploads.value) {
    try { URL.revokeObjectURL(u.localUrl) } catch { /* ignore */ }
  }
})

function onOnline() { connection.value = 'online' }
function onOffline() { connection.value = 'offline' }

// 点击外部关闭 action menu
function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.chat-action-menu')) {
    showActionMenu.value = false
    showTransferMenu.value = false
  }
}

watch(
  () => [props.accountId, props.subjectOrderId],
  async () => {
    conversation.value = null
    messages.value = []
    pending.value = []
    pendingUploads.value = []
    attachmentsByMessage.value = {}
    metadataByMessage.value = {}
    signedUrls.value = {}
    await safeUnsub()
    // 切换会话时强制跳过缓存（避免拿到旧会话的附件/元数据）
    openConversation({ skipCache: true })
  },
)

// ---- 上传/发送 --------------------------------------------------------------

// Phase 9: 引用回复 — 引用消息预览条, 发送后清掉
const replyTo = ref<ChatMessage | null>(null)
const onReply = (m: ChatMessage) => {
  replyTo.value = m
  // 让 composer 拿到焦点
  nextTick(() => {
    document.querySelector<HTMLTextAreaElement>('textarea[data-chat-composer]')?.focus()
  })
}
const onCancelReply = () => { replyTo.value = null }

const onSend = async (body: string) => {
  if (!conversation.value) return
  const clientMessageId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const replyToId = replyTo.value?.id ?? null
  pending.value.push({
    client_message_id: clientMessageId,
    body,
    created_at: new Date().toISOString(),
    status: 'pending',
    reply_to_id: replyToId,
  } as any)
  scrollToBottom()
  try {
    await chat.sendMessage(conversation.value.id, body, clientMessageId, replyToId)
    replyTo.value = null
  } catch (e: any) {
    const idx = pending.value.findIndex((p) => p.client_message_id === clientMessageId)
    if (idx !== -1) {
      pending.value[idx] = {
        ...pending.value[idx],
        status: 'failed',
        failure: e?.message ?? String(e),
      }
    }
  }
}

/**
 * Phase 3.5: 撤回消息
 */
const onRemove = async (msg: ChatMessage) => {
  if (!msg || msg.deleted_at) return
  if (!window.confirm(t('chat.confirmDelete'))) return
  try {
    await chat.deleteMessage(msg.id)
    // realtime UPDATE 推回, 本地会被替换
  } catch (e: any) {
    window.alert(t('chat.deleteFailed', { error: e?.message ?? String(e) }))
  }
}

/**
 * 切换消息表情反应
 * - 元数据写入 chat_message_metadata.payload.reactions
 * - 写入后 invalidate metadata 缓存，让 reloadExtras 拉新数据
 */
const onToggleReaction = async (msg: ChatMessage, emoji: string) => {
  if (!msg?.id) return
  const current = metadataByMessage.value[msg.id]?.payload?.reactions ?? []
  try {
    const updated = await reactionsComposable.toggleReaction(msg.id, emoji, current)
    // 乐观更新本地 metadata，realtime 推回时再合并
    metadataByMessage.value = {
      ...metadataByMessage.value,
      [msg.id]: {
        ...metadataByMessage.value[msg.id],
        message_id: msg.id,
        payload: {
          ...metadataByMessage.value[msg.id]?.payload,
          reactions: updated,
        },
        updated_at: new Date().toISOString(),
      },
    }
  } catch (e: any) {
    window.alert(e?.message ?? String(e))
  }
}

/**
 * Phase 3.5: 开始编辑
 */
const onEdit = (msg: ChatMessage) => {
  if (msg.message_kind !== 'text') return
  editingMessage.value = msg
  editDraft.value = msg.body
  nextTick(() => {
    const el = document.getElementById('chat-edit-textarea') as HTMLTextAreaElement | null
    el?.focus()
  })
}

const cancelEdit = () => {
  editingMessage.value = null
  editDraft.value = ''
}

const submitEdit = async () => {
  if (!editingMessage.value) return
  const trimmed = editDraft.value.trim()
  if (!trimmed) return
  editSubmitting.value = true
  try {
    await chat.editMessage(editingMessage.value.id, trimmed)
    editingMessage.value = null
    editDraft.value = ''
  } catch (e: any) {
    window.alert(t('chat.editFailed', { error: e?.message ?? String(e) }))
  } finally {
    editSubmitting.value = false
  }
}

/**
 * Phase 3.5: 客服接管 / 转接
 */
const onTakeOver = async () => {
  if (!conversation.value) return
  try {
    await chat.joinConversation(conversation.value.id)
    conversation.value = {
      ...conversation.value,
      assigned_to: appUser.value?.id ?? conversation.value.assigned_to,
    }
  } catch (e: any) {
    window.alert(t('chat.takeOverFailed', { error: e?.message ?? String(e) }))
  }
}

const onTransfer = async (toStaffId: string | null) => {
  if (!conversation.value) return
  const label = staffOptions.value.find((s) => s.id === toStaffId)?.full_name ?? '—'
  if (!window.confirm(t('chat.confirmTransfer', { name: label }))) return
  try {
    await chat.transferConversation(conversation.value.id, toStaffId)
    conversation.value = {
      ...conversation.value,
      assigned_to: toStaffId,
    }
    showTransferMenu.value = false
  } catch (e: any) {
    window.alert(t('chat.transferFailed', { error: e?.message ?? String(e) }))
  }
}

/**
 * Phase 4: staff 手动补一条系统消息 (例: 物流单号)
 */
const onPostSystem = async () => {
  if (!conversation.value) return
  const body = window.prompt(t('chat.postSystemPlaceholder'))
  if (!body || !body.trim()) return
  try {
    await chat.postSystemMessage(conversation.value.id, body.trim())
  } catch (e: any) {
    window.alert(e?.message ?? String(e))
  }
}

const onRetry = async (clientMessageId: string) => {
  const idx = pending.value.findIndex((p) => p.client_message_id === clientMessageId)
  if (idx !== -1 && conversation.value) {
    const item = pending.value[idx]
    pending.value[idx] = { ...item, status: 'pending', failure: undefined }
    try {
      await chat.sendMessage(conversation.value.id, item.body, clientMessageId, (item as any).reply_to_id ?? null)
    } catch (e: any) {
      pending.value[idx] = { ...pending.value[idx], status: 'failed', failure: e?.message ?? String(e) }
    }
    return
  }
  // pending image retry
  const uidx = pendingUploads.value.findIndex((u) => u.clientMessageId === clientMessageId)
  if (uidx !== -1 && conversation.value) {
    const u = pendingUploads.value[uidx]
    pendingUploads.value[uidx] = { ...u, status: 'uploading', failure: undefined }
    try {
      await uploadOne(u)
    } catch { /* marked by uploadOne */ }
  }
}

const onPickImage = async (file: File, clientMessageId: string) => {
  const localUrl = URL.createObjectURL(file)
  const pending: PendingUpload = {
    clientMessageId,
    localUrl,
    file,
    status: 'uploading',
  }
  pendingUploads.value.push(pending)
  // 给 attachmentsByMessage 一个 placeholder 让 bubble 显示本地预览
  attachmentsByMessage.value = {
    ...attachmentsByMessage.value,
    [clientMessageId]: [{
      id: clientMessageId,
      message_id: clientMessageId,
      storage_path: clientMessageId, // 任意, 但 pending 时走 localUrl 分支
      mime: file.type,
      size_bytes: file.size,
      width: null,
      height: null,
    }],
  }
  // 让 ChatBubble 能拿到本地 URL (通过 signedUrls[path=clientMessageId] = localUrl)
  signedUrls.value = { ...signedUrls.value, [clientMessageId]: localUrl }
  scrollToBottom()
  try {
    await uploadOne(pending)
  } catch { /* marked by uploadOne */ }
}

const onRemoveImage = async (clientMessageId: string) => {
  const idx = pendingUploads.value.findIndex((u) => u.clientMessageId === clientMessageId)
  if (idx === -1) return
  const u = pendingUploads.value[idx]
  try { URL.revokeObjectURL(u.localUrl) } catch { /* ignore */ }
  pendingUploads.value.splice(idx, 1)
}

const uploadOne = async (pending: PendingUpload) => {
  if (!conversation.value) return
  try {
    const r = await uploader.uploadImage({
      conversationId: conversation.value.id,
      accountId: props.accountId,
      file: pending.file,
      clientMessageId: pending.clientMessageId,
    })
    pending.messageId = r.messageId
    pending.status = 'sent'
    // 移除占位行, 让 realtime 推回真实 message
    setTimeout(() => {
      const idx = pendingUploads.value.findIndex((u) => u.clientMessageId === pending.clientMessageId)
      if (idx !== -1) pendingUploads.value.splice(idx, 1)
    }, 200)
  } catch (e: any) {
    pending.status = 'failed'
    pending.failure = e?.message ?? String(e)
  }
}

const onSendOrderCard = async () => {
  if (!conversation.value || !props.sendOrderCardHandler) return
  const mid = await props.sendOrderCardHandler()
  if (mid) {
    // realtime 会回推, 不需要本地插入
  }
}

// ---- 显示辅助 --------------------------------------------------------------

const counterpart = computed<ChatMember | null>(() => {
  if (!appUser.value) return null
  const counterpartMember = members.value.find((m) => m.user_id !== appUser.value!.id)
  if (counterpartMember) return counterpartMember
  if (conversation.value?.assigned) {
    return {
      id: '',
      conversation_id: conversation.value.id,
      user_id: conversation.value.assigned.id,
      member_type: 'staff',
      last_read_message_id: null,
      last_read_at: null,
      joined_at: conversation.value.created_at,
      left_at: null,
      user: {
        id: conversation.value.assigned.id,
        full_name: conversation.value.assigned.full_name,
        role: conversation.value.assigned.role,
        account_id: '',
      },
    } as ChatMember
  }
  return null
})

const counterpartStatus = computed(() => {
  if (!counterpart.value) return 'offline' as const
  const lastSeen = counterpart.value.last_read_at
  return presenceState(lastSeen ?? undefined)
})

const counterpartName = computed(() => {
  if (counterpart.value?.user?.full_name) return counterpart.value.user.full_name
  if (appUser.value?.role === 'customer') return t('chat.notAssigned')
  return t('chat.staff')
})

// Phase 9: 引用解析 - 用本地缓存找到被引用消息
const messageMap = computed(() => {
  const map = new Map<string, ChatMessage>()
  for (const m of messages.value) map.set(m.id, m)
  // pending 也算 (本地乐观, 发送失败时也要能渲染占位)
  for (const p of pending.value as any[]) {
    if (p.client_message_id) map.set(p.client_message_id, {
      id: p.client_message_id,
      conversation_id: '',
      sender_id: appUser.value?.id ?? '',
      message_type: 'text',
      message_kind: 'text',
      body: p.body,
      client_message_id: p.client_message_id,
      reply_to_id: null,
      created_at: p.created_at,
      edited_at: null,
      deleted_at: null,
      sender: { id: appUser.value?.id ?? '', full_name: appUser.value?.full_name ?? null, role: appUser.value?.role ?? 'customer' },
    } as ChatMessage)
  }
  return map
})

const replyFor = (m: ChatMessage): ChatMessage | null => {
  if (!m.reply_to_id) return null
  return messageMap.value.get(m.reply_to_id) ?? null
}

const replySummary = (m: ChatMessage | null | undefined): string => {
  if (!m) return ''
  if (m.deleted_at) return t('chat.replyDeleted')
  if (m.message_kind === 'image') return t('chat.replyImage')
  if (m.message_kind === 'order_card') return t('chat.replyOrderCard')
  return m.body
}

// Phase 10B: 消息搜索高亮
const searchQ = ref('')
const highlighted = (body: string): string => {
  if (!searchQ.value || !body) return body
  const escaped = searchQ.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return body.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">$1</mark>')
}
const isHighlighted = (m: ChatMessage): boolean => {
  if (!searchQ.value) return false
  if (m.deleted_at) return false
  return m.body.toLowerCase().includes(searchQ.value.toLowerCase())
}

const isMyMessage = (m: ChatMessage) => m.sender_id === appUser.value?.id

const orderCardInfoFor = (m: ChatMessage) => {
  if (m.message_kind !== 'order_card') return null
  const meta = metadataByMessage.value[m.id]
  if (!meta || !meta.payload?.order_id) return null
  const orderId = meta.payload.order_id

  // 优先用 statusCache 实时状态
  const cached = (statusCache as any)._cache?.get?.(orderId)
  if (cached) {
    if (props.orderCardInfo && props.subjectOrderId === orderId) {
      return {
        order_id: orderId,
        order_no: props.orderCardInfo.order_no,
        status: cached.status,
        total_amount: cached.total_amount,
        item_count: props.orderCardInfo.item_count,
        total_boxes: props.orderCardInfo.total_boxes,
        updated_at: cached.updated_at,
      }
    }
    return {
      order_id: orderId,
      order_no: cached.order_no,
      status: cached.status,
      total_amount: cached.total_amount,
    }
  }
  // 兜底: 静态 props 信息
  if (props.orderCardInfo && props.subjectOrderId === orderId) {
    return { order_id: orderId, ...props.orderCardInfo }
  }
  return {
    order_id: orderId,
    order_no: meta.payload.order_no ?? '—',
    status: meta.payload.status ?? '',
    total_amount: meta.payload.total_amount,
  }
}

const isStaff = computed(() => {
  const r = appUser.value?.role
  return r === 'admin' || r === 'checker' || r === 'finance' || r === 'warehouse'
})

/**
 * 表情反应（reactions）汇总
 * 把 metadataByMessage 中的 payload.reactions 转换为 UI 友好的结构
 */
const reactionsByMessage = computed(() => {
  return reactionsComposable.groupReactionsByMessage(metadataByMessage.value)
})

/**
 * 复制消息文本到剪贴板
 */
const onCopyMessage = async (m: ChatMessage) => {
  if (!m.body) return
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(m.body)
    }
  } catch { /* ignore */ }
}
</script>

<template>
  <div class="flex flex-col h-full bg-background">
    <!-- 顶部 -->
    <ChatPanelHeader
      v-if="!embedded"
      :conversation="conversation"
      :counterpart="counterpart"
      :counterpart-name="counterpartName"
      :counterpart-status="counterpartStatus"
      :connection="connection"
      :context-label="contextLabel"
      :send-order-card-handler="sendOrderCardHandler"
      :staff-options="staffOptions"
      :is-staff="isStaff"
      @close="emit('close')"
      @send-order-card="onSendOrderCard"
      @post-system="onPostSystem"
      @take-over="onTakeOver"
      @toggle-action-menu="showActionMenu = !showActionMenu; showTransferMenu = false"
    >
      <template #status-dot>
        <ChatStatusDot :status="counterpartStatus" />
      </template>
      <template #action-menu>
        <div
          v-if="showActionMenu"
          class="absolute right-0 top-full mt-1 z-30 min-w-[220px] rounded-md border bg-background shadow-lg p-1"
        >
          <button
            class="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-1.5"
            @click="onTakeOver(); showActionMenu = false"
          >
            <UserPlus class="h-3.5 w-3.5" />
            {{ t('chat.takeOverSelf') }}
          </button>
          <button
            class="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-1.5"
            @click="showTransferMenu = !showTransferMenu; showActionMenu = false"
          >
            <ArrowRightLeft class="h-3.5 w-3.5" />
            {{ t('chat.transferToOther') }}
          </button>
          <div v-if="showTransferMenu" class="mt-1 border-t pt-1 max-h-60 overflow-y-auto">
            <button
              class="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted"
              @click="onTransfer(null); showTransferMenu = false; showActionMenu = false"
            >
              {{ t('chat.unassign') }}
            </button>
            <button
              v-for="s in staffOptions"
              :key="s.id"
              class="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted"
              :class="s.id === conversation?.assigned_to ? 'bg-primary/10' : ''"
              @click="onTransfer(s.id); showTransferMenu = false; showActionMenu = false"
            >
              {{ s.full_name ?? s.id.slice(0, 8) }}
              <span class="text-muted-foreground ml-1">· {{ s.role }}</span>
            </button>
          </div>
        </div>
      </template>
    </ChatPanelHeader>

    <div
      v-else
      class="px-3 py-2 border-b flex items-center gap-2 bg-muted/30"
    >
      <ChatAvatar
        :name="counterpartName"
        :role="counterpart?.member_type ?? 'staff'"
        size="sm"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate flex items-center gap-1.5">
          {{ counterpartName }}
          <ChatStatusDot :status="counterpartStatus" />
        </p>
        <p class="text-[10px] text-muted-foreground truncate">
          {{
            conversation?.subject_order
              ? `${t('chat.orderRef')}: ${conversation.subject_order.order_no}`
              : (contextLabel ?? t('chat.subtitle'))
          }}
        </p>
      </div>
      <Button
        v-if="sendOrderCardHandler"
        size="icon"
        variant="ghost"
        :title="t('chat.sendOrderCard')"
        @click="onSendOrderCard"
      >
        <Package class="h-3.5 w-3.5" />
      </Button>
      <Button
        v-if="isStaff"
        size="icon"
        variant="ghost"
        :title="t('chat.takeOver')"
        @click="onTakeOver"
      >
        <UserPlus class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- Phase 10B: 消息搜索高亮 -->
    <div class="px-2 sm:px-3 py-1.5 border-b bg-muted/20 flex items-center gap-2">
      <input
        v-model="searchQ"
        type="search"
        :placeholder="t('chat.searchMessages')"
        class="flex-1 h-7 rounded-md border border-input bg-background px-3 pr-8 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <button
        v-if="searchQ"
        type="button"
        class="h-6 w-6 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
        :title="t('chat.clearSearch')"
        @click="searchQ = ''"
      >
        <X class="h-3 w-3" />
      </button>
    </div>

    <ChatMessageList
      ref="messageList"
      :rows="rows"
      :loading="loading"
      :load-error="loadError"
      :messages="messages"
      :attachments-by-message="attachmentsByMessage"
      :signed-urls="signedUrls"
      :search-q="searchQ"
      :typing-users="typingUsers"
      :is-my-message="isMyMessage"
      :order-card-info-for="orderCardInfoFor"
      :reply-for="replyFor"
      :reply-summary="replySummary"
      :reactions-by-message="reactionsByMessage"
      @reply="onReply"
      @retry="onRetry"
      @edit="onEdit"
      @remove="onRemove"
      @copy="onCopyMessage"
      @toggle-reaction="onToggleReaction"
    />

    <!-- M3.5: 编辑消息 inline 条 -->
    <ChatEditBar
      v-if="editingMessage"
      :editing-message="editingMessage"
      :edit-draft="editDraft"
      :edit-submitting="editSubmitting"
      @update:edit-draft="editDraft = $event"
      @submit-edit="submitEdit"
      @cancel-edit="cancelEdit"
    />

    <slot name="footer" />

    <!-- Phase 9: 引用回复预览条 -->
    <div
      v-if="replyTo"
      class="flex items-center gap-2 px-3 sm:px-4 py-1.5 bg-muted/40 border-t border-b text-xs"
    >
      <div class="flex-1 min-w-0 pl-2 border-l-2 border-primary/60">
        <p class="text-[10px] font-semibold text-primary truncate">
          {{ replyTo.sender?.full_name ?? t('chat.staff') }}
        </p>
        <p class="text-muted-foreground truncate">
          {{ replySummary(replyTo) }}
        </p>
      </div>
      <button
        type="button"
        class="h-6 w-6 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
        :title="t('chat.cancelReply')"
        @click="onCancelReply"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>

    <ChatComposer
      :uploading="pendingUploads.map((u) => ({ clientMessageId: u.clientMessageId, localUrl: u.localUrl, file: u.file }))"
      :draft-key="conversation?.id ?? props.accountId ?? undefined"
      @send="onSend"
      @pick-image="onPickImage"
      @remove-image="onRemoveImage"
      @typing="onTyping"
    />
  </div>
</template>
