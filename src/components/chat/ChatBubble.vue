<!--
  ChatBubble —— 单条消息气泡 (M2.5: text + image + order_card + 已编辑/已撤回)
  align: 'end' 自家消息 / 'start' 对方
  delivery: 'pending' | 'sent' | 'failed' | 'read'
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Trash2, CornerUpLeft } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import type { ChatMessage, ChatMessageAttachment } from '@/composables/useChat'
import { useAuth } from '@/composables/useAuth'
import { useI18n } from '@/lib/i18n'
import ChatOrderCard from './ChatOrderCard.vue'

const props = defineProps<{
  message: ChatMessage
  align?: 'start' | 'end'
  delivery?: 'pending' | 'sent' | 'failed' | 'read'
  failureText?: string
  attachments?: ChatMessageAttachment[]
  signedUrls?: Record<string, string>
  orderCard?: {
    order_id: string
    order_no: string
    status?: string
    item_count?: number
    total_boxes?: number
    total_amount?: number
    updated_at?: string
  } | null
  replyTo?: ChatMessage | null
  /** Phase 10B: 搜索高亮关键词 */
  searchQ?: string
}>()

const emit = defineEmits<{
  /** 在 delivery === 'failed' 时点击重试 */
  retry: [clientMessageId: string]
  /** 发起编辑 */
  edit: [message: ChatMessage]
  /** 发起撤回 */
  remove: [message: ChatMessage]
  /** Phase 9: 引用回复 */
  reply: [message: ChatMessage]
}>()

const { t } = useI18n()
const { appUser } = useAuth()

const align = computed(() => props.align ?? 'end')
const isSystem = computed(() => props.message.message_type === 'system')
const isImage = computed(() => props.message.message_kind === 'image')
const isOrderCard = computed(() => props.message.message_kind === 'order_card')
const isText = computed(() => !isSystem.value && !isImage.value && !isOrderCard.value)
const isDeleted = computed(() => !!props.message.deleted_at)
const isEdited = computed(() => !!props.message.edited_at && !isDeleted.value)
const isMine = computed(() => props.message.sender_id === appUser.value?.id)
const senderName = computed(() => props.message.sender?.full_name ?? t('chat.staff'))
const isRead = computed(() => props.delivery === 'read')

const showActions = ref(false)

const canEdit = computed(() => {
  if (!isMine.value || isDeleted.value || !isText.value) return false
  const created = new Date(props.message.created_at).getTime()
  return Date.now() - created <= 5 * 60_000
})
const canDelete = computed(() => {
  if (!isMine.value || isDeleted.value) return false
  // 图片 / 订单卡片也可撤回 (只是 body 不被改写, deleted_at 仍标记)
  const created = new Date(props.message.created_at).getTime()
  return Date.now() - created <= 2 * 60_000
})

const imageUrl = (path: string) => props.signedUrls?.[path] ?? ''

// Phase 9: 引用预览摘要
const replySummary = computed(() => {
  const m = props.replyTo
  if (!m) return ''
  if (m.deleted_at) return t('chat.replyDeleted')
  if (m.message_kind === 'image') return t('chat.replyImage')
  if (m.message_kind === 'order_card') return t('chat.replyOrderCard')
  return m.body
})
const replySenderName = computed(() => {
  if (!props.replyTo) return ''
  return props.replyTo.sender?.full_name ?? t('chat.staff')
})

// Phase 10B: 高亮搜索关键词 (返回 HTML 字符串, 用于 v-html)
const highlightBody = (body: string): string => {
  if (!props.searchQ || !body) return body
  const escaped = props.searchQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return body.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">$1</mark>')
}
</script>

<template>
  <!-- 系统消息：居中 -->
  <div v-if="isSystem" class="flex justify-center my-2">
    <span class="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      {{ message.body }}
    </span>
  </div>

  <div
    v-else
    class="flex w-full group gap-1.5"
    :class="align === 'end' ? 'justify-end' : 'justify-start'"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
  >
    <!-- hover 时显示: 引用回复按钮 (在气泡外侧) -->
    <button
      v-if="!isSystem && !isDeleted"
      class="self-center h-6 w-6 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition shrink-0"
      :class="align === 'end' ? 'order-first' : 'order-last'"
      :title="t('chat.reply')"
      @click.stop="emit('reply', message)"
    >
      <CornerUpLeft class="h-3.5 w-3.5" />
    </button>

    <div
      class="max-w-[78%] sm:max-w-[68%] flex flex-col gap-1"
      :class="align === 'end' ? 'items-end' : 'items-start'"
    >
      <!-- 已撤回 -->
      <div
        v-if="isDeleted"
        class="rounded-2xl px-3 py-1.5 text-xs text-muted-foreground border border-dashed bg-muted/30"
        :class="align === 'end' ? 'rounded-br-md' : 'rounded-bl-md'"
      >
        🗑 {{ t('chat.deletedMessage') }}
      </div>

      <!-- TEXT -->
      <div
        v-else-if="isText"
        class="relative max-w-[78%] sm:max-w-[68%] group/msg"
      >
        <div
          v-if="replyTo"
          class="mb-1 px-2.5 py-1.5 rounded-lg border-l-2 border-primary/60 bg-muted/50 text-[11px] flex items-start gap-1.5 min-w-[160px] max-w-[320px]"
          :class="align === 'end' ? 'rounded-br-md self-end' : 'rounded-bl-md'"
        >
          <div class="flex-1 min-w-0">
            <p class="text-[10px] font-semibold text-primary truncate">{{ replySenderName }}</p>
            <p class="text-muted-foreground truncate">{{ replySummary }}</p>
          </div>
        </div>
        <div
          class="rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words shadow-sm"
          :class="cn(
            align === 'end'
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-muted text-foreground rounded-bl-md',
            delivery === 'failed' && 'ring-2 ring-destructive/60',
          )"
          v-html="highlightBody(message.body)"
        ></div>
        <div
          v-if="isMine && (canEdit || canDelete)"
          class="absolute -top-3 right-0 flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition"
        >
          <button
            v-if="canEdit"
            class="h-6 w-6 rounded-full bg-background border inline-flex items-center justify-center hover:bg-muted"
            :title="t('chat.editMessage')"
            @click.stop="emit('edit', message)"
          >
            <Pencil class="h-3 w-3" />
          </button>
          <button
            v-if="canDelete"
            class="h-6 w-6 rounded-full bg-background border inline-flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
            :title="t('chat.deleteMessage')"
            @click.stop="emit('remove', message)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- IMAGE -->
      <div
        v-else-if="isImage"
        class="relative rounded-2xl overflow-hidden shadow-sm max-w-[260px] sm:max-w-[320px]"
        :class="cn(
          align === 'end' ? 'rounded-br-md' : 'rounded-bl-md',
          delivery === 'failed' && 'ring-2 ring-destructive/60',
        )"
      >
        <template v-for="att in (attachments ?? [])" :key="att.id">
          <a
            v-if="imageUrl(att.storage_path) && delivery !== 'pending'"
            :href="imageUrl(att.storage_path)"
            target="_blank"
            rel="noopener noreferrer"
            class="block"
          >
            <img :src="imageUrl(att.storage_path)" :alt="att.storage_path" class="w-full h-auto block" loading="lazy" />
          </a>
          <div
            v-else
            class="flex items-center justify-center h-32 bg-muted text-[10px] text-muted-foreground"
          >
            <span v-if="delivery === 'pending'">⏳ {{ t('chat.pendingLabel') }}</span>
            <span v-else-if="delivery === 'failed'">⚠️ {{ t('chat.sendFailed') }}</span>
            <span v-else>{{ att.mime }}</span>
          </div>
        </template>
        <div
          v-if="isMine && canDelete"
          class="absolute -top-3 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition"
        >
          <button
            class="h-6 w-6 rounded-full bg-background border inline-flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
            :title="t('chat.deleteMessage')"
            @click.stop="emit('remove', message)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- ORDER CARD -->
      <div v-else-if="isOrderCard && orderCard" class="relative">
        <ChatOrderCard v-bind="orderCard" />
        <div
          v-if="isMine && canDelete"
          class="absolute -top-3 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition"
        >
          <button
            class="h-6 w-6 rounded-full bg-background border inline-flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
            :title="t('chat.deleteMessage')"
            @click.stop="emit('remove', message)"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- timestamp -->
      <div
        class="flex items-center gap-1 text-[10px] text-muted-foreground"
        :class="align === 'end' ? 'flex-row-reverse' : ''"
      >
        <span class="tabular-nums">{{ new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
        <span v-if="delivery === 'pending'" class="text-muted-foreground/70">· {{ t('chat.pendingLabel') }}</span>
        <span v-else-if="delivery === 'failed'" class="text-destructive font-medium" :title="failureText">· {{ t('chat.sendFailed') }}</span>
        <span v-else-if="isEdited" class="text-muted-foreground/70">· {{ t('chat.editedMessage') }}</span>
        <span v-else-if="align === 'end' && isRead" class="text-primary">· {{ t('chat.read') }}</span>
        <span v-else-if="align === 'end'" class="text-muted-foreground/70">· {{ t('chat.delivery') }}</span>
      </div>
    </div>
  </div>
</template>
