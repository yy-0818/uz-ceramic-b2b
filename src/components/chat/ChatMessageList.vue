<!--
  ChatMessageList — 消息列表区域
  - 加载状态、空状态、错误状态
  - 日期分隔线
  - 消息气泡（ChatBubble）
  - 正在输入提示（ChatTyping）
  - 消息搜索高亮
-->
<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { Loader2 } from 'lucide-vue-next'
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
}>()

const emit = defineEmits<{
  reply: [m: ChatMessage]
  retry: [clientMessageId: string]
  edit: [m: ChatMessage]
  remove: [m: ChatMessage]
  copy: [m: ChatMessage]
  toggleReaction: [m: ChatMessage, emoji: string]
}>()

const { t } = useI18n()
const messagesContainer = ref<HTMLElement | null>(null)

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

defineExpose({ messagesContainer, scrollToBottom })
</script>

<template>
  <div
    ref="messagesContainer"
    class="flex-1 overflow-y-auto px-2 sm:px-3 py-3 space-y-1"
  >
    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
      <Loader2 class="h-4 w-4 animate-spin" />
      {{ t('chat.loading') }}
    </div>
    <div v-else-if="loadError" class="text-xs text-destructive text-center py-10">
      {{ loadError }}
    </div>
    <template v-else>
      <div
        v-if="messages.length === 0"
        class="text-center text-xs text-muted-foreground py-10"
      >
        {{ t('chat.emptyMessages') }}
      </div>
      <template v-for="(row, i) in rows" :key="i">
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
        <ChatTyping
          v-else-if="row.kind === 'typing'"
          :who="typingUsers[0]?.full_name"
          role="staff"
        />
      </template>
    </template>
  </div>
</template>
