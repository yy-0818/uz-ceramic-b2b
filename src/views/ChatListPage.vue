<!--
  src/views/ChatListPage.vue
  Phase 7: 统一聊天中心
  - 客户模式 (role === customer / fin_customer): 一对一 MVP 列表
  - 后台模式 (admin / checker / finance / warehouse): 一对多 telegram 风格
  - 共用路由 /chat, 按角色自动切
  - 支持 ?conversation=uuid 深链接自动选中
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/composables/useAuth'
import { useChat, type ChatConversation } from '@/composables/useChat'
import { useOrderStatusCache } from '@/composables/useOrderStatusCache'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ChatConversationList from '@/components/chat/ChatConversationList.vue'
import StaffChatWorkspacePage from '@/views/admin/StaffChatWorkspacePage.vue'

const { t } = useI18n()
const route = useRoute()
const { account, appUser } = useAuth()
const chat = useChat()
const statusCache = useOrderStatusCache()

const isStaff = computed(() => {
  const r = appUser.value?.role
  return r === 'admin' || r === 'checker' || r === 'finance' || r === 'warehouse'
})

const selectedConversation = ref<ChatConversation | null>(null)
const showMobileDetail = ref(false)

let heartbeatTimer: number | undefined
let listPollTimer: number | undefined
let convListLoaded = false
// 同一会话列表的 fetch 去重: 多个调用并发只发一次请求
let convListInFlight: Promise<void> | null = null

/**
 * 切会话前, 先在后台把目标会话的消息预热到 messagesCache,
 * 这样 ChatPanel onMounted 时 peekMessagesCache 可命中, 直接渲染无 loading
 */
const prefetchTargetConversation = async (conv: ChatConversation) => {
  try {
    await Promise.all([
      chat.fetchMessages(conv.id, { limit: 50 }, { skipCache: false }),
      chat.fetchMembers(conv.id, { skipCache: false }),
    ])
  } catch {
    /* ignore */
  }
}

const onSelect = async (c: ChatConversation) => {
  // 预热优先 (后台, 不阻塞 UI): 切到 c 之前把消息拉好
  void prefetchTargetConversation(c)
  selectedConversation.value = c
  showMobileDetail.value = true
}

const onBack = () => {
  showMobileDetail.value = false
  selectedConversation.value = null
  // 触发一次列表刷新 (走 dedup, 不会和轮询冲突)
  fetchConversationsDedup().catch(() => {
    /* ignore */
  })
}

const onNewConversation = () => {
  if (!account.value) return
  chat
    .ensureConversation({
      account_id: account.value.id,
      subject_order_id: null,
    })
    .then(async (c) => {
      void prefetchTargetConversation(c)
      selectedConversation.value = c
      showMobileDetail.value = true
      // 触发一次列表刷新 (走 dedup, 新会话会出现在列表里)
      fetchConversationsDedup().catch(() => {
        /* ignore */
      })
    })
    .catch(() => {
      /* ignore */
    })
}

// 深链接 ?conversation=uuid
watch(
  () => route.query.conversation,
  async (id) => {
    if (!id || typeof id !== 'string') return
    // 等待 fetchConversations 完成 (onMounted 会触发), 避免重复请求
    if (!convListLoaded) {
      if (convListInFlight) await convListInFlight
      else await fetchConversationsDedup()
    }
    const conv: ChatConversation | null = chat.conversations.value.find((c) => c.id === id) ?? null
    if (conv) {
      // 预热目标会话消息, 让 ChatPanel 立刻能命中缓存
      void prefetchTargetConversation(conv)
      selectedConversation.value = conv
      showMobileDetail.value = true
    }
  },
  { immediate: true },
)

const fetchConversationsDedup = async () => {
  if (convListInFlight) return convListInFlight
  if (convListLoaded) {
    // 已加载过: 不阻塞, 后台静默刷新
    chat.fetchConversations().catch(() => {
      /* ignore */
    })
    return
  }
  convListInFlight = (async () => {
    const list = await chat.fetchConversations().catch(() => [])
    convListLoaded = true
    void prefetchMessagesInBackground(list ?? [])
    void prefetchTargetConversationByRoute()
  })()
  try {
    await convListInFlight
  } finally {
    convListInFlight = null
  }
}

onMounted(async () => {
  await fetchConversationsDedup()
  chat.heartbeat('web', 'online').catch(() => {
    /* ignore */
  })
  heartbeatTimer = window.setInterval(() => {
    if (document.hidden) return
    chat.heartbeat('web', 'online').catch(() => {
      /* ignore */
    })
  }, 30_000)
  // 6 秒轮询会话列表 (替代 supabase realtime postgres_changes,
  // 避免 "cannot add postgres_changes callbacks after subscribe()")
  // 走 cache dedup, 不会引起侧边栏抖动 (mergeConversationsDiff 复用旧引用)
  startListPolling()
})

function startListPolling() {
  stopListPolling()
  listPollTimer = window.setInterval(() => {
    if (!document.hidden) {
      // 仅在初次加载后才触发后台刷新 (不影响初次渲染)
      fetchConversationsDedup().catch(() => {
        /* ignore */
      })
    }
  }, 6_000)
}

function stopListPolling() {
  if (listPollTimer) {
    window.clearInterval(listPollTimer)
    listPollTimer = undefined
  }
}

/**
 * 根据路由 ?conversation=uuid 预热目标会话
 */
async function prefetchTargetConversationByRoute() {
  const id = route.query.conversation
  if (!id || typeof id !== 'string') return
  const conv = chat.conversations.value.find((c) => c.id === id)
  if (conv) void prefetchTargetConversation(conv)
}

/**
 * 后台预热: 把会话列表里最近的 N 个会话的消息拉进 messagesCache
 * 这样 ChatPanel onMounted 时 peekMessagesCache 可命中, 直接渲染无 loading
 * - 策略: 先 fire-and-forget prefetch 目标会话（如果有）, 让 ChatPanel 快路径命中
 * - 然后再预热最近 7 个其他会话（避免阻塞 ChatPanel 切换）
 */
async function prefetchMessagesInBackground(convs: ChatConversation[]) {
  // 1. 优先预热路由 query 指定的目标会话
  const targetId = typeof route.query.conversation === 'string' ? route.query.conversation : null
  if (targetId) {
    const target = convs.find((c) => c.id === targetId)
    if (target) {
      await Promise.allSettled([
        chat.fetchMessages(target.id, { limit: 50 }, { skipCache: false }).catch(() => undefined),
        chat.fetchMembers(target.id, { skipCache: false }).catch(() => undefined),
      ])
    }
  }
  // 2. 后台 fire-and-forget 预热最近 7 个其他会话 (不 await, 异步)
  const targets = convs.filter((c) => c.id !== targetId).slice(0, 7)
  void Promise.allSettled(
    targets.map(async (c) => {
      try {
        await Promise.all([
          chat.fetchMessages(c.id, { limit: 50 }, { skipCache: false }),
          chat.fetchMembers(c.id, { skipCache: false }),
        ])
      } catch {
        /* ignore */
      }
    }),
  )
}

onBeforeUnmount(() => {
  stopListPolling()
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  chat.heartbeat('web', 'offline').catch(() => {
    /* ignore */
  })
})
</script>

<template>
  <!-- 后台一对多: 复用现有 StaffChatWorkspacePage -->
  <StaffChatWorkspacePage v-if="isStaff" />

  <!-- 客户一对一 -->
  <div v-else class="space-y-3">
    <header
      class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4"
    >
      <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      <div class="relative">
        <h1 class="text-base sm:text-lg font-bold leading-tight">
          {{ t('chat.title') }}
        </h1>
        <p class="text-xs text-muted-foreground mt-0.5 max-w-xl">
          {{ t('chat.subtitle') }}
        </p>
      </div>
    </header>

    <div
      class="rounded-2xl border bg-card overflow-hidden h-[calc(100dvh-200px)] min-h-[480px] grid grid-cols-1 md:grid-cols-[280px_1fr]"
    >
      <div class="h-full overflow-hidden border-r" :class="showMobileDetail ? 'hidden md:block' : ''">
        <ChatConversationList
          :selected-conversation-id="selectedConversation?.id"
          @select="onSelect"
          @new-conversation="onNewConversation"
        />
      </div>
      <div class="h-full" :class="showMobileDetail ? 'block' : 'hidden md:block'">
        <ChatPanel
          v-if="selectedConversation"
          :key="selectedConversation.id"
          :account-id="selectedConversation.account_id"
          :subject-order-id="selectedConversation.subject_order_id"
          embedded
          @close="onBack"
        />
        <div v-else class="h-full flex items-center justify-center px-6 text-center">
          <div class="space-y-2">
            <p class="text-sm font-semibold">{{ t('chat.selectConv') }}</p>
            <p class="text-xs text-muted-foreground max-w-xs mx-auto">
              {{ t('chat.selectConvHint') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
