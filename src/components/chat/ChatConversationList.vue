<!--
  ChatConversationList —— 左侧会话列表
  - 拉当前用户作为成员的会话
  - 未读 / 最后消息 / 状态点
  - 点击触发 update:selectedConversationId
-->
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { Loader2, MessageSquare, Plus, Search } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useChat, type ChatConversation, relativeTime } from '@/composables/useChat'
import ChatAvatar from './ChatAvatar.vue'
import ChatStatusDot from './ChatStatusDot.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import { useRouter, useRoute } from 'vue-router'

const { t } = useI18n()
const chat = useChat()
const router = useRouter()
const route = useRoute()

const props = defineProps<{
  selectedConversationId?: string | null
  /** 显示 staff 工作台标签 */
  staffMode?: boolean
}>()

const emit = defineEmits<{
  'select': [conversation: ChatConversation]
  'new-conversation': []
}>()

const channelSub = ref<{ unsubscribe: () => void } | null>(null)

onMounted(async () => {
  await chat.fetchConversations()
  // 订阅 realtime 让列表自动刷新
  channelSub.value = (await import('@/lib/supabase')).supabase
    .channel('chat-list')
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'chat_messages' },
      () => {
        chat.invalidateList()
        chat.fetchConversations().catch(() => { /* ignore */ })
      },
    )
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'chat_conversation_members' },
      () => {
        chat.invalidateList()
        chat.fetchConversations().catch(() => { /* ignore */ })
      },
    )
    .subscribe()
})

onBeforeUnmount(() => {
  channelSub.value?.unsubscribe()
})

const totalUnread = computed(() =>
  chat.conversations.value.reduce((s, c) => s + (c.unread_count ?? 0), 0),
)

const searchQ = ref('')
let searchTimer: number | undefined
const searchInput = ref<HTMLInputElement | null>(null)
const onSearch = (e: Event) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    searchQ.value = (e.target as HTMLInputElement).value.trim()
  }, 200)
}

const filtered = computed(() => {
  const q = searchQ.value.toLowerCase()
  if (!q) return chat.conversations.value
  return chat.conversations.value.filter((c) => {
    if ((c.account?.account_name ?? '').toLowerCase().includes(q)) return true
    if ((c.subject_order?.order_no ?? '').toLowerCase().includes(q)) return true
    if ((c.last_message?.body ?? '').toLowerCase().includes(q)) return true
    return false
  })
})

const onPick = (c: ChatConversation) => {
  emit('select', c)
}

const onGotoOrder = (e: MouseEvent, c: ChatConversation) => {
  e.stopPropagation()
  if (c.subject_order_id) router.push(`/orders/${c.subject_order_id}`)
}

const title = (c: ChatConversation) =>
  c.subject_order?.order_no
    ? `${c.account?.account_name ?? '—'} · ${c.subject_order.order_no}`
    : (c.account?.account_name ?? '—')
</script>

<template>
  <div class="flex flex-col h-full bg-muted/20">
    <div class="px-3 py-2.5 border-b flex flex-col gap-2 bg-background sticky top-0 z-10">
      <div class="flex items-center gap-2">
        <MessageSquare class="h-4 w-4 text-primary" />
        <span class="text-sm font-semibold flex-1">
          {{ staffMode ? t('chat.staffBanner') : t('chat.title') }}
        </span>
        <Badge v-if="totalUnread > 0" variant="default" class="text-[10px]">
          {{ totalUnread }}
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          :title="t('chat.newConversation')"
          @click="emit('new-conversation')"
        >
          <Plus class="h-4 w-4" />
        </Button>
      </div>
      <div class="relative">
        <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <input
          ref="searchInput"
          type="search"
          :placeholder="t('chat.searchConversations')"
          class="w-full h-7 rounded-md border border-input bg-background pl-7 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @input="onSearch"
        />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div
        v-if="chat.loadingList.value && chat.conversations.value.length === 0"
        class="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground"
      >
        <Loader2 class="h-4 w-4 animate-spin" />
        {{ t('chat.loading') }}
      </div>
      <div
        v-else-if="chat.conversations.value.length === 0"
        class="text-center px-4 py-10 text-xs text-muted-foreground space-y-2"
      >
        <p class="font-semibold text-foreground">{{ t('chat.empty') }}</p>
        <p>{{ t('chat.emptyHint') }}</p>
        <Button
          size="sm"
          variant="outline"
          class="mt-2"
          @click="emit('new-conversation')"
        >
          {{ t('chat.newConversation') }}
        </Button>
      </div>
      <ul v-else-if="filtered.length > 0" class="divide-y">
        <li
          v-for="c in filtered"
          :key="c.id"
          class="px-3 py-2.5 hover:bg-muted/60 cursor-pointer transition"
          :class="c.id === selectedConversationId ? 'bg-primary/10' : ''"
          @click="onPick(c)"
        >
          <div class="flex items-start gap-2">
            <ChatAvatar
              :name="c.account?.account_name ?? '?'"
              :role="c.subject_order ? 'customer' : 'staff'"
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <span class="text-sm font-medium truncate flex-1">
                  {{ title(c) }}
                </span>
                <span class="text-[10px] text-muted-foreground tabular-nums">
                  {{ relativeTime(c.last_message_at) }}
                </span>
              </div>
              <p class="text-[11px] text-muted-foreground truncate">
                {{
                  c.last_message
                    ? (c.last_message.message_type === 'text'
                        ? c.last_message.body
                        : t('chat.systemOnline'))
                    : t('chat.emptyMessages')
                }}
              </p>
            </div>
            <Badge
              v-if="(c.unread_count ?? 0) > 0"
              variant="default"
              class="text-[10px] tabular-nums ml-1"
            >
              {{ c.unread_count }}
            </Badge>
          </div>
        </li>
      </ul>
      <div
        v-if="searchQ && filtered.length === 0"
        class="text-center px-4 py-10 text-xs text-muted-foreground space-y-1"
      >
        <p class="font-semibold text-foreground">{{ t('chat.noResults') }}</p>
        <p>{{ t('chat.noResultsHint') }}</p>
      </div>
    </div>
  </div>
</template>
