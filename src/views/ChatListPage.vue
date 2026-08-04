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

const onSelect = (c: ChatConversation) => {
  selectedConversation.value = c
  showMobileDetail.value = true
}

const onBack = () => {
  showMobileDetail.value = false
  selectedConversation.value = null
  chat.invalidateList()
  chat.fetchConversations().catch(() => { /* ignore */ })
}

const onNewConversation = () => {
  if (!account.value) return
  chat.ensureConversation({
    account_id: account.value.id,
    subject_order_id: null,
  }).then((c) => {
    selectedConversation.value = c
    showMobileDetail.value = true
    chat.invalidateList()
  }).catch(() => { /* ignore */ })
}

// 深链接 ?conversation=uuid
watch(
  () => route.query.conversation,
  async (id) => {
    if (!id || typeof id !== 'string') return
  let conv: ChatConversation | null = chat.conversations.value.find((c) => c.id === id) ?? null
  if (!conv) {
    try { await chat.fetchConversations() } catch { /* ignore */ }
    conv = chat.conversations.value.find((c) => c.id === id) ?? null
  }
  if (conv) {
    selectedConversation.value = conv
    showMobileDetail.value = true
  }
  },
  { immediate: true },
)

let heartbeatTimer: number | undefined

onMounted(() => {
  chat.fetchConversations().catch(() => { /* ignore */ })
  chat.heartbeat('web', 'online').catch(() => { /* ignore */ })
  heartbeatTimer = window.setInterval(() => {
    if (document.hidden) return
    chat.heartbeat('web', 'online').catch(() => { /* ignore */ })
  }, 30_000)
})

onBeforeUnmount(() => {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  chat.heartbeat('web', 'offline').catch(() => { /* ignore */ })
})
</script>

<template>
  <!-- 后台一对多: 复用现有 StaffChatWorkspacePage -->
  <StaffChatWorkspacePage v-if="isStaff" />

  <!-- 客户一对一 -->
  <div v-else class="space-y-3">
    <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4">
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

    <div class="rounded-2xl border bg-card overflow-hidden h-[calc(100dvh-200px)] min-h-[480px] grid grid-cols-1 md:grid-cols-[280px_1fr]">
      <div
        class="h-full overflow-hidden border-r"
        :class="showMobileDetail ? 'hidden md:block' : ''"
      >
        <ChatConversationList
          :selected-conversation-id="selectedConversation?.id"
          @select="onSelect"
          @new-conversation="onNewConversation"
        />
      </div>
      <div
        class="h-full"
        :class="showMobileDetail ? 'block' : 'hidden md:block'"
      >
        <ChatPanel
          v-if="selectedConversation"
          :account-id="selectedConversation.account_id"
          :subject-order-id="selectedConversation.subject_order_id"
          embedded
          @close="onBack"
        />
        <div
          v-else
          class="h-full flex items-center justify-center px-6 text-center"
        >
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