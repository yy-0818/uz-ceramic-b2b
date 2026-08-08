<!--
  ChatBubble —— 单条消息气泡（参考 shadcn-vue Message 设计）
  - align: 'end' 自家消息 / 'start' 对方
  - delivery: 'pending' | 'sent' | 'failed' | 'read'
  - 添加 emoji 表情反应功能（多用户可加多个表情）
  - 优化气泡样式：圆角自然、阴影柔和
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  Pencil,
  Trash2,
  CornerUpLeft,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Copy,
  Reply,
  SmilePlus,
  X,
} from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import type { ChatMessage, ChatMessageAttachment } from '@/composables/useChat'
import { useAuth } from '@/composables/useAuth'
import { useI18n } from '@/lib/i18n'
import ChatOrderCard from './ChatOrderCard.vue'

export interface MessageReaction {
  emoji: string
  count: number
  /** 当前用户是否已加 */
  mine?: boolean
  /** 加这个反应的用户ID列表 */
  user_ids?: string[]
}

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
  /** 表情反应 */
  reactions?: MessageReaction[]
}>()

const emit = defineEmits<{
  /** 在 delivery === 'failed' 时点击重试 */
  retry: [clientMessageId: string]
  /** 发起编辑 */
  edit: [message: ChatMessage]
  /** 发起撤回 */
  remove: [message: ChatMessage]
  /** 引用回复 */
  reply: [message: ChatMessage]
  /** 复制消息内容 */
  copy: [message: ChatMessage]
  /** 添加表情反应 */
  react: [message: ChatMessage, emoji: string]
  /** 切换表情（已加就移除，没加就加） */
  toggleReaction: [message: ChatMessage, emoji: string]
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
const isRead = computed(() => props.delivery === 'read')
const isSent = computed(() => props.delivery === 'sent')
const isPending = computed(() => props.delivery === 'pending')
const isFailed = computed(() => props.delivery === 'failed')

const showActions = ref(false)
const showEmojiPicker = ref(false)
const emojiBtnRef = ref<HTMLElement | null>(null)
const emojiPopoverStyle = ref<Record<string, string>>({})

// 常用 emoji 集合（快速反应栏）
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉']

const canEdit = computed(() => {
  if (!isMine.value || isDeleted.value || !isText.value) return false
  const created = new Date(props.message.created_at).getTime()
  return Date.now() - created <= 5 * 60_000
})
const canDelete = computed(() => {
  if (!isMine.value || isDeleted.value) return false
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

// Phase 10B: 高亮搜索关键词
const highlightBody = (body: string): string => {
  if (!props.searchQ || !body) return body
  const escaped = props.searchQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return body.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">$1</mark>',
  )
}

const onCopy = () => {
  if (typeof navigator !== 'undefined' && navigator.clipboard && props.message.body) {
    navigator.clipboard.writeText(props.message.body).catch(() => {
      /* ignore */
    })
  }
  emit('copy', props.message)
}

const onPickEmoji = (emoji: string) => {
  showEmojiPicker.value = false
  emit('toggleReaction', props.message, emoji)
}

// 切换 emoji 选择面板时, 计算按钮位置并用 fixed 定位浮层
// (Teleport 到 body 后不会被 ChatMessageList 的 overflow-y-auto 裁切)
async function toggleEmojiPicker() {
  showEmojiPicker.value = !showEmojiPicker.value
  if (showEmojiPicker.value) {
    await nextTick()
    const btn = emojiBtnRef.value
    if (btn) {
      const r = btn.getBoundingClientRect()
      // 浮层宽度约 280px, 高度约 40px; 居中于按钮上方
      const popW = 280
      const left = Math.max(8, Math.min(window.innerWidth - popW - 8, r.left + r.width / 2 - popW / 2))
      const top = r.top - 48 // 浮层上方 48px (含 mb)
      emojiPopoverStyle.value = {
        position: 'fixed',
        left: `${left}px`,
        top: `${Math.max(8, top)}px`,
        zIndex: '60',
      }
    }
  }
}

// 点击外部关闭 emoji 面板 (Teleport 后无法靠父级 onDocClick 关闭)
function onWindowClick(e: MouseEvent) {
  if (!showEmojiPicker.value) return
  const target = e.target as HTMLElement
  if (target.closest('[data-emoji-popover]')) return
  if (target.closest('[data-emoji-trigger]')) return
  showEmojiPicker.value = false
}
watch(showEmojiPicker, (open) => {
  if (typeof window === 'undefined') return
  if (open) {
    setTimeout(() => document.addEventListener('mousedown', onWindowClick), 0)
  } else {
    document.removeEventListener('mousedown', onWindowClick)
  }
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') document.removeEventListener('mousedown', onWindowClick)
})
</script>

<template>
  <!-- 系统消息：居中 -->
  <div v-if="isSystem" class="flex justify-center my-2">
    <span class="text-[10px] px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
      {{ message.body }}
    </span>
  </div>

  <div v-else class="flex w-full group/row gap-2" :class="align === 'end' ? 'justify-end' : 'justify-start'">
    <!-- 在 'start' 时显示头像（参考 shadcn-vue MessageAvatar） -->
    <div v-if="align === 'start' && !isSystem" class="shrink-0 self-end mb-5">
      <slot name="avatar" />
    </div>

    <!-- hover 显示的左侧/右侧操作按钮（参考 MessageActions） -->
    <div
      v-if="!isSystem && !isDeleted"
      class="self-center flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition shrink-0"
      :class="align === 'end' ? 'order-first' : 'order-last'"
    >
      <button
        class="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
        :title="t('chat.reply')"
        @click.stop="emit('reply', message)"
      >
        <Reply class="h-3.5 w-3.5" />
      </button>
      <div class="relative">
        <button
          ref="emojiBtnRef"
          data-emoji-trigger
          class="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
          :title="t('chat.react')"
          @click.stop="toggleEmojiPicker"
        >
          <SmilePlus class="h-3.5 w-3.5" />
        </button>
        <!-- 快速反应 emoji 面板: Teleport 到 body, 不会被 scroll container 裁切 -->
        <Teleport to="body">
          <div
            v-if="showEmojiPicker"
            data-emoji-popover
            :style="emojiPopoverStyle"
            class="flex items-center gap-1 rounded-full bg-popover border shadow-lg px-2 py-1.5"
            @click.stop
          >
            <button
              v-for="emoji in QUICK_EMOJIS"
              :key="emoji"
              class="text-xl hover:scale-125 transition-transform px-1"
              :title="emoji"
              @click="onPickEmoji(emoji)"
            >
              {{ emoji }}
            </button>
            <button
              class="h-5 w-5 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 inline-flex items-center justify-center ml-1"
              :title="t('common.close')"
              @click="showEmojiPicker = false"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        </Teleport>
      </div>
      <button
        v-if="isText && message.body"
        class="h-7 w-7 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center"
        :title="t('common.copy')"
        @click.stop="onCopy"
      >
        <Copy class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- 主内容区 -->
    <div class="flex flex-col gap-1 max-w-[78%] sm:max-w-[68%]" :class="align === 'end' ? 'items-end' : 'items-start'">
      <!-- sender header（对方消息且连续消息需要显示发送者姓名） -->
      <div v-if="align === 'start' && !isSystem" class="text-[11px] text-muted-foreground px-1">
        {{ message.sender?.full_name ?? t('chat.staff') }}
      </div>

      <!-- 已撤回 -->
      <div
        v-if="isDeleted"
        class="rounded-2xl px-3 py-1.5 text-xs text-muted-foreground border border-dashed bg-muted/30"
        :class="align === 'end' ? 'rounded-br-md' : 'rounded-bl-md'"
      >
        🗑 {{ t('chat.deletedMessage') }}
      </div>

      <!-- TEXT -->
      <div v-else-if="isText" class="relative">
        <!-- 引用预览 -->
        <div
          v-if="replyTo"
          class="mb-1 px-2.5 py-1.5 rounded-lg border-l-2 border-primary/60 bg-muted/50 text-[11px] flex items-start gap-1.5 min-w-[160px] max-w-[320px]"
          :class="align === 'end' ? 'rounded-br-md self-end' : 'rounded-bl-md'"
        >
          <div class="flex-1 min-w-0">
            <p class="text-[10px] font-semibold text-primary truncate">
              {{ replyTo.sender?.full_name ?? t('chat.staff') }}
            </p>
            <p class="text-muted-foreground truncate">{{ replySummary }}</p>
          </div>
        </div>

        <!-- 主体气泡 -->
        <div
          class="relative px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm transition-colors"
          :class="
            cn(
              'rounded-2xl',
              align === 'end'
                ? 'bg-primary text-primary-foreground rounded-br-md hover:bg-primary/90'
                : 'bg-muted text-foreground rounded-bl-md hover:bg-muted/80',
              isFailed && 'ring-2 ring-destructive/60',
            )
          "
          v-html="highlightBody(message.body)"
        ></div>

        <!-- hover 显示编辑/撤回（自己的消息） -->
        <div
          v-if="isMine && (canEdit || canDelete) && !isSystem"
          class="absolute -top-3 right-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition"
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
        :class="cn(align === 'end' ? 'rounded-br-md' : 'rounded-bl-md', isFailed && 'ring-2 ring-destructive/60')"
      >
        <template v-for="att in attachments ?? []" :key="att.id">
          <a
            v-if="imageUrl(att.storage_path) && !isPending"
            :href="imageUrl(att.storage_path)"
            target="_blank"
            rel="noopener noreferrer"
            class="block"
          >
            <img :src="imageUrl(att.storage_path)" :alt="att.storage_path" class="w-full h-auto block" loading="lazy" />
          </a>
          <div v-else class="flex items-center justify-center h-32 bg-muted text-[10px] text-muted-foreground gap-1.5">
            <Clock v-if="isPending" class="h-3 w-3" />
            <AlertCircle v-else-if="isFailed" class="h-3 w-3 text-destructive" />
            <span v-if="isPending">{{ t('chat.pendingLabel') }}</span>
            <span v-else-if="isFailed">{{ t('chat.sendFailed') }}</span>
            <span v-else>{{ att.mime }}</span>
          </div>
        </template>
        <div
          v-if="isMine && canDelete"
          class="absolute -top-3 right-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition"
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
          class="absolute -top-3 right-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition"
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

      <!-- 表情反应 emoji reactions -->
      <div
        v-if="reactions && reactions.length > 0 && !isSystem"
        class="flex flex-wrap items-center gap-1 -mt-0.5"
        :class="align === 'end' ? 'justify-end' : 'justify-start'"
      >
        <button
          v-for="r in reactions"
          :key="r.emoji"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors"
          :class="
            r.mine
              ? 'bg-primary/10 border-primary text-primary hover:bg-primary/20'
              : 'bg-muted/60 border-border hover:bg-muted'
          "
          :title="r.mine ? t('chat.unreact') : t('chat.react')"
          @click="emit('toggleReaction', message, r.emoji)"
        >
          <span class="text-base leading-none">{{ r.emoji }}</span>
          <span class="tabular-nums font-medium">{{ r.count }}</span>
        </button>
      </div>

      <!-- timestamp + delivery status -->
      <div
        class="flex items-center gap-1 text-[10px] text-muted-foreground"
        :class="align === 'end' ? 'flex-row-reverse' : ''"
      >
        <span v-if="isEdited" class="text-muted-foreground/70">{{ t('chat.editedMessage') }}</span>
        <span class="tabular-nums">
          {{ new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
        </span>
        <!-- 自己消息：勾选状态（重叠双勾） -->
        <span v-if="align === 'end' && !isSystem" class="inline-flex items-center">
          <!-- sent: 灰色单勾 -->
          <Check v-if="isSent" class="h-3 w-3 text-muted-foreground/70" aria-label="sent" />
          <!-- read: 重叠双勾（蓝色） -->
          <span v-else-if="isRead" class="inline-flex items-center -space-x-1.5" :title="t('chat.read')">
            <Check class="h-3 w-3 text-primary" />
            <Check class="h-3 w-3 text-primary" />
          </span>
          <!-- pending: 灰色时钟 -->
          <Clock v-else-if="isPending" class="h-3 w-3 text-muted-foreground/60" aria-label="pending" />
          <!-- failed: 红色感叹号 -->
          <AlertCircle v-else-if="isFailed" class="h-3 w-3 text-destructive" :title="failureText" aria-label="failed" />
        </span>
      </div>
    </div>

    <!-- 'end' 时显示头像 -->
    <div v-if="align === 'end' && !isSystem" class="shrink-0 self-end mb-5">
      <slot name="avatar" />
    </div>
  </div>
</template>
