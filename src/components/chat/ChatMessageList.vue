<!--
  ChatMessageList — 消息列表区域
  - 加载状态、空状态、错误状态
  - 日期分隔线
  - 消息气泡（ChatBubble）
  - 正在输入提示（ChatTyping）
  - 消息搜索高亮
  - 向上滚动加载更久远的消息（向上 infinite scroll）
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Loader2, ArrowUp } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import type { ChatMessage, ChatMessageAttachment } from '@/composables/useChat'
import type { ReactionSummary } from '@/composables/useMessageReactions'
import ChatBubble from './ChatBubble.vue'
import ChatDateDivider from './ChatDateDivider.vue'
import ChatTyping from './ChatTyping.vue'

type Row =
  | { kind: 'msg'; message: ChatMessage; delivery: 'pending' | 'sent' | 'failed' | 'read'; failure?: string }
  | { kind: 'date'; iso: string }
  | { kind: 'typing' }

type OrderCardInfo = {
  order_id: string
  order_no: string
  status?: string
  total_amount?: number
  item_count?: number
  total_boxes?: number
  updated_at?: string
} | null

const props = defineProps<{
  rows: Row[]
  loading: boolean
  loadError: string | null
  messages: ChatMessage[]
  attachmentsByMessage: Record<string, ChatMessageAttachment[]>
  signedUrls: Record<string, string>
  searchQ: string
  typingUsers: { user_id: string; full_name: string | null }[]
  isMyMessage: (m: ChatMessage) => boolean
  orderCardInfoFor: (m: ChatMessage) => OrderCardInfo
  replyFor: (m: ChatMessage) => ChatMessage | null
  replySummary: (m: ChatMessage | null | undefined) => string
  /** 表情反应映射 */
  reactionsByMessage?: Record<string, ReactionSummary[]>
  /** 向上滚动加载更多 */
  loadingMore?: boolean
  hasMore?: boolean
}>()

const emit = defineEmits<{
  reply: [m: ChatMessage]
  retry: [clientMessageId: string]
  edit: [m: ChatMessage]
  remove: [m: ChatMessage]
  copy: [m: ChatMessage]
  toggleReaction: [m: ChatMessage, emoji: string]
  /** 向上滚动到顶部附近时触发 */
  loadMore: []
}>()

const { t } = useI18n()
const messagesContainer = ref<HTMLElement | null>(null)
const SCROLL_THRESHOLD = 80 // 距顶部 80px 内触发加载

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

/**
 * 监听滚动：距顶部 <= SCROLL_THRESHOLD 时触发 loadMore
 * - 用 rAF 节流，避免快速滚动时频繁触发
 * - loadMore 由父组件去重（loadingMore 状态）
 */
let rafId: number | null = null
const onScroll = () => {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    const el = messagesContainer.value
    if (!el) return
    if (el.scrollTop <= SCROLL_THRESHOLD && props.hasMore && !props.loadingMore) {
      emit('loadMore')
    }
  })
}

onMounted(async () => {
  await nextTick()
  const el = messagesContainer.value
  if (!el) return
  // 初始挂载时，如果内容比容器小（消息数太少），自动滚到底部
  if (el.scrollHeight <= el.clientHeight) {
    scrollToBottom()
  }
  el.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId)
  const el = messagesContainer.value
  if (el) el.removeEventListener('scroll', onScroll)
})

defineExpose({ messagesContainer, scrollToBottom })
</script>

<template>
  <div class="relative flex-1 min-h-0 flex flex-col">
    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-2 sm:px-3 py-3 space-y-1">
      <!-- 顶部加载更多指示器 -->
      <div v-if="loadingMore" class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        {{ t('chat.loadingMore') }}
      </div>
      <div
        v-else-if="hasMore && messages.length > 0"
        class="flex items-center justify-center py-2 text-[10px] text-muted-foreground/60"
      >
        <ArrowUp class="h-3 w-3 mr-1" />
        {{ t('chat.scrollForMore') }}
      </div>
      <div
        v-else-if="!hasMore && messages.length > 0"
        class="flex items-center justify-center py-2 text-[10px] text-muted-foreground/60"
      >
        {{ t('chat.noMoreMessages') }}
      </div>

      <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
        <Loader2 class="h-4 w-4 animate-spin" />
        {{ t('chat.loading') }}
      </div>
      <div v-else-if="loadError" class="text-xs text-destructive text-center py-10">
        {{ loadError }}
      </div>
      <template v-else>
        <template
          v-for="(row, i) in rows"
          :key="row.kind === 'msg' ? row.message.id : row.kind === 'date' ? `date-${row.iso}` : `typing-${i}`"
        >
          <ChatDateDivider v-if="row.kind === 'date'" :iso="row.iso" />
          <ChatBubble
            v-else-if="row.kind === 'msg'"
            :message="row.message"
            :align="isMyMessage(row.message) ? 'end' : 'start'"
            :delivery="row.delivery"
            :failure-text="row.failure"
            :attachments="attachmentsByMessage[row.message.id]"
            :signed-urls="signedUrls"
            :order-card="orderCardInfoFor(row.message)"
            :reply-to="replyFor(row.message)"
            :search-q="searchQ"
            :reactions="reactionsByMessage?.[row.message.id]"
            @reply="emit('reply', $event)"
            @retry="row.delivery === 'failed' && emit('retry', row.message.client_message_id)"
            @edit="emit('edit', row.message)"
            @remove="emit('remove', row.message)"
            @copy="emit('copy', $event)"
            @toggle-reaction="(m, e) => emit('toggleReaction', m, e)"
          />
          <ChatTyping v-else-if="row.kind === 'typing'" :who="typingUsers[0]?.full_name" role="staff" />
        </template>
      </template>
    </div>
  </div>
</template>
