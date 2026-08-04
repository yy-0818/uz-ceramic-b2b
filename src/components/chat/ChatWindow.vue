<!--
  ChatWindow —— 全局浮窗式聊天
  --------------------------------------------------------------
  用法: 在 AppLayout 装一份:
    <ChatWindow />
  行为:
    - 默认收起: 1 个圆形按钮, 右下角悬浮
    - 当前 route 是 /orders/:id 时, 点击展开自动打开该订单的会话
    - 任意页面手动传入 :account-id :subject-order-id 锁定 context
    - 监听 route 变化, context 跟随变化时自动重新打开
-->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { MessageCircle, X, Minus, Send, Loader2 } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useChat, type ChatConversation } from '@/composables/useChat'
import { useAuth } from '@/composables/useAuth'
import { isCartPanelOpen } from '@/composables/useFabState'
import ChatPanel from './ChatPanel.vue'

const props = defineProps<{
  /** 强制 context. 不传则由 route 推断 */
  accountId?: string | null
  subjectOrderId?: string | null
  /** 起始位置 offset */
  position?: { bottom?: string; right?: string }
  /** FAB 尺寸: sm=44px, md=56px */
  fabSize?: 'sm' | 'md'
}>()

const fabBottom = computed(() => {
  if (props.position?.bottom) return props.position.bottom
  return props.fabSize === 'md' ? '112px' : '108px'
})

const { t } = useI18n()
const chat = useChat()
const { account, appUser } = useAuth()

const open = ref(false)
const minimized = ref(false)
const conversation = ref<ChatConversation | null>(null)
const subjectOrderId = ref<string | null>(props.subjectOrderId ?? null)
const accountId = ref<string | null>(props.accountId ?? null)
const currentPath = ref(typeof window !== 'undefined' ? window.location.pathname : '/')
let poll: number | undefined
let routeObserver: any = null

const hideFloat = computed(() => {
  const p = currentPath.value
  // 整页聊天中心 / 订单详情页 / 购物车面板打开时, 全局浮窗不出现
  return p === '/chat' || p.startsWith('/chat?') || p.startsWith('/admin/chat')
    || /^\/orders\/[0-9a-f-]{36}/i.test(p)
    || isCartPanelOpen.value
})

const unreadForThis = computed(() => {
  if (!conversation.value) return 0
  const row = chat.conversations.value.find((c) => c.id === conversation.value!.id)
  return row?.unread_count ?? 0
})

const onToggle = () => {
  if (!open.value) {
    open.value = true
    minimized.value = false
    void ensureConversation()
  } else {
    open.value = false
  }
}

const onMinimize = () => {
  open.value = true
  minimized.value = !minimized.value
}

const ensureConversation = async () => {
  // 1. 强制 context
  if (props.accountId) {
    accountId.value = props.accountId
  }
  if (props.subjectOrderId !== undefined) {
    subjectOrderId.value = props.subjectOrderId ?? null
  }
  if (!accountId.value) return
  const conv = await chat.ensureConversation({
    account_id: accountId.value,
    subject_order_id: subjectOrderId.value,
  })
  conversation.value = conv
  chat.fetchConversations().catch(() => { /* ignore */ })
}

// 监听 props 变化, 已 open 也跟着切换
watch(
  () => [props.accountId, props.subjectOrderId],
  async () => {
    if (!open.value) return
    await ensureConversation()
  },
)

let lastRoutePath = ''

const onPopState = () => {
  // 不监听 popstate, 用 timer 轮询 path 变化
}

onMounted(async () => {
  await chat.fetchConversations().catch(() => { /* ignore */ })
  // 启动心跳：30s 一次（统一节流，避免多个组件重复打心跳）
  chat.heartbeat('web', 'online').catch(() => { /* ignore */ })
  if (poll) window.clearInterval(poll)
  poll = window.setInterval(async () => {
    // 仅在前台时心跳（document.hidden=true 时跳过）
    if (document.hidden) return
    try {
      await chat.heartbeat('web', 'online')
    } catch { /* ignore */ }
    // 监听当前 route（route 变化需要重新推断 context）
    const path = window.location.pathname
    if (path !== lastRoutePath) {
      lastRoutePath = path
      tryInferContextFromPath(path)
    }
  }, 30_000)
  lastRoutePath = window.location.pathname
  tryInferContextFromPath(lastRoutePath)

  // 监听 popstate 也算
  window.addEventListener('popstate', tryInferContextFromRoute)
  window.addEventListener('pushstate' as any, tryInferContextFromRoute)
})

onBeforeUnmount(() => {
  if (poll) window.clearInterval(poll)
  chat.heartbeat('web', 'offline').catch(() => { /* ignore */ })
  window.removeEventListener('popstate', tryInferContextFromRoute)
  window.removeEventListener('pushstate' as any, tryInferContextFromRoute)
})

const tryInferContextFromRoute = () => tryInferContextFromPath(window.location.pathname)

const tryInferContextFromPath = async (path: string) => {
  currentPath.value = path
  // /orders/:id → 取该订单的 account_id + subject_order_id
  const m = path.match(/^\/orders\/([0-9a-f-]{36})/i)
  if (m) {
    const orderId = m[1]
    subjectOrderId.value = orderId
    if (!accountId.value && account.value) {
      accountId.value = account.value.parent_id ?? account.value.id ?? null
    }
    if (accountId.value) {
      try {
        const { supabase } = await import('@/lib/supabase')
        await (supabase.from('orders') as any)
          .select('account_id')
          .eq('id', orderId)
          .maybeSingle()
        if (account.value) {
          accountId.value = account.value.parent_id ?? account.value.id ?? null
        }
      } catch { /* ignore */ }
    }
    return
  }
  if (path === '/chat' || path.startsWith('/chat?')) {
    open.value = false
    return
  }
  if (path.startsWith('/admin/chat')) {
    open.value = false
    return
  }
  // 非订单页: 客户模式 — fallback general (subject_order_id = null, account = parent)
  if (account.value) {
    accountId.value = account.value.parent_id ?? account.value.id ?? null
    subjectOrderId.value = null
  }
}

const roleLabel = computed(() => {
  if (appUser.value?.role === 'customer' || appUser.value?.role === 'fin_customer') return t('chat.subtitle')
  return t('chat.staffBanner')
})

const sharing = ref(false)
const onShare = async () => {
  if (!conversation.value || !subjectOrderId.value || sharing.value) return
  sharing.value = true
  try {
    await chat.sendOrderCard(conversation.value.id, subjectOrderId.value)
  } catch { /* ignore */ }
  finally { sharing.value = false }
}
</script>

<template>
  <!-- 工作台 / 客户 chat 整页时浮窗不显示 -->
  <template v-if="false" />
  <div
    v-if="open"
    class="fixed z-40 shadow-xl rounded-2xl overflow-hidden bg-background border flex flex-col"
    :style="{
      bottom: fabBottom,
      right: (position?.right ?? '16px'),
      width: 'min(360px, calc(100vw - 32px))',
      height: minimized ? '48px' : 'min(540px, calc(100dvh - 120px))',
      transition: 'height 200ms ease',
    }"
  >
    <div class="h-12 px-3 border-b flex items-center gap-2 bg-muted/40 shrink-0">
      <MessageCircle class="h-4 w-4 text-primary shrink-0" />
      <span class="text-sm font-semibold truncate flex-1">
        {{ roleLabel }}
      </span>
      <button
        v-if="subjectOrderId && conversation"
        class="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
        :title="t('chat.shareOrderCard')"
        :disabled="sharing"
        @click="onShare"
      >
        <Loader2 v-if="sharing" class="h-3.5 w-3.5 animate-spin" />
        <Send v-else class="h-3.5 w-3.5" />
      </button>
      <button
        class="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted"
        :title="minimized ? t('common.expandAll') : t('common.collapseAll')"
        @click="onMinimize"
      >
        <Minus class="h-3.5 w-3.5" />
      </button>
      <button
        class="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted"
        :title="t('common.close')"
        @click="onToggle"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
    <div v-if="!minimized" class="flex-1 min-h-0">
      <ChatPanel
        v-if="conversation && accountId"
        :account-id="accountId"
        :subject-order-id="subjectOrderId"
        embedded
      />
    </div>
  </div>
  <button
    v-else-if="!hideFloat"
    :class="['fixed z-50 rounded-full bg-primary text-primary-foreground shadow-xl inline-flex items-center justify-center hover:bg-primary/90 transition',
      fabSize === 'md' ? 'h-14 w-14' : 'h-11 w-11']"
    :style="{
      bottom: fabBottom,
      right: (position?.right ?? '16px'),
    }"
    @click="onToggle"
  >
    <MessageCircle :class="fabSize === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]'" />
    <span
      v-if="unreadForThis > 0"
      class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold tabular-nums inline-flex items-center justify-center"
    >
      {{ unreadForThis }}
    </span>
  </button>
</template>
