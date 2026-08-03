<!--
  StaffChatWorkspacePage —— 后台客服工作台
  --------------------------------------------------------------
  布局 (desktop ≥ md):
    ┌────────┬───────────────┬──────────────────────┐
    │ 客户   │ 会话列表       │ ChatPanel             │
    │ 分组   │ (current grp)  │ (按 account 过滤)       │
    └────────┴───────────────┴──────────────────────┘
  布局 (mobile < md):
    三步导航: 客户分组 → 会话列表 → ChatPanel
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Headphones, Search, ChevronRight, Loader2, MessageSquarePlus, ArrowLeft, Inbox, Archive, X, CheckCircle2, UserCheck, UserX, ListChecks, CheckSquare, Square, ArchiveRestore, SearchX } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/composables/useAuth'
import { useChat, type ChatConversation, type ChatConversationStatus, type ChatSearchHit, relativeTime } from '@/composables/useChat'
import { useTeamMembers } from '@/composables/useTeamMembers'
import { supabase } from '@/lib/supabase'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ChatAvatar from '@/components/chat/ChatAvatar.vue'
import ChatStatusDot from '@/components/chat/ChatStatusDot.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
const { appUser } = useAuth()
const chat = useChat()

type FilterValue = ChatConversationStatus | 'all'
const filter = ref<FilterValue>('open')
// 对话列表搜索
const searchConv = ref('')

// 消息搜索浮层（独立触发）
const searchOpen = ref(false)
const searchMsgKw = ref('')
const searchHits = ref<ChatSearchHit[]>([])
const searchLoading = ref(false)
let searchTimer: number | undefined

const openSearch = () => {
  searchOpen.value = true
  searchMsgKw.value = ''
  searchHits.value = []
}

const closeSearch = () => {
  searchOpen.value = false
  searchMsgKw.value = ''
}

watch(searchMsgKw, (kw) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  if (!kw.trim()) {
    searchHits.value = []
    return
  }
  searchTimer = window.setTimeout(async () => {
    searchLoading.value = true
    try {
      searchHits.value = await chat.searchMessages(kw, null, 50)
    } catch {
      searchHits.value = []
    } finally {
      searchLoading.value = false
    }
  }, 350)
})
const expandedGroupId = ref<string | null>(null)
const selected = ref<ChatConversation | null>(null)

// M1 batch
const selectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const batchAssignTo = ref<string>('')

const { members: staffOptions, load: loadStaffOptions } = useTeamMembers()

const onPickSearchHit = async (hit: ChatSearchHit) => {
  closeSearch()
  let conv = chat.conversations.value.find((c) => c.id === hit.conversation_id)
  if (!conv) {
    await fetchList()
    conv = chat.conversations.value.find((c) => c.id === hit.conversation_id) ?? null
  }
  if (conv) {
    selected.value = conv
    expandedGroupId.value = conv.account_id
  }
}

const groups = computed(() => {
  const list = chat.groupByAccount()
  if (!searchConv.value.trim()) return list
  const q = searchConv.value.trim().toLowerCase()
  return list
    .map((g) => {
      const convs = g.conversations.filter((c) =>
        (c.account?.account_name ?? '').toLowerCase().includes(q) ||
        (c.account?.company_name ?? '').toLowerCase().includes(q) ||
        (c.subject_order?.order_no ?? '').toLowerCase().includes(q) ||
        (c.last_message?.body ?? '').toLowerCase().includes(q),
      )
      if (convs.length === 0) return null
      return { ...g, conversations: convs, total_unread: convs.reduce((s, c) => s + (c.unread_count ?? 0), 0) }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
})

const fetchList = async () => {
  await chat.listAdminConversations(filter.value)
}

const onToggleGroup = (accountId: string) => {
  expandedGroupId.value = expandedGroupId.value === accountId ? null : accountId
}

const onPickConversation = (c: ChatConversation) => {
  if (selectMode.value) {
    if (selectedIds.value.has(c.id)) selectedIds.value.delete(c.id)
    else selectedIds.value.add(c.id)
    selectedIds.value = new Set(selectedIds.value) // trigger reactivity
    return
  }
  selected.value = c
}

const toggleSelectMode = () => {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = new Set()
}

const clearSelection = () => selectedIds.value = new Set()

const onBatchClose = async () => {
  if (selectedIds.value.size === 0) return
  if (!window.confirm(t('chat.confirmBatchClose', { n: selectedIds.value.size }))) return
  await chat.batchSetStatus(Array.from(selectedIds.value), 'closed')
  selectedIds.value = new Set()
  selectMode.value = false
  await fetchList()
}

const onBatchReopen = async () => {
  if (selectedIds.value.size === 0) return
  await chat.batchSetStatus(Array.from(selectedIds.value), 'open')
  selectedIds.value = new Set()
  selectMode.value = false
  await fetchList()
}

const onBatchReassign = async () => {
  if (selectedIds.value.size === 0) return
  const target = batchAssignTo.value || null
  const label = staffOptions.value.find((s) => s.id === target)?.full_name ?? '?'
  if (!window.confirm(t('chat.confirmBatchAssign', { n: selectedIds.value.size, name: label }))) return
  await chat.batchReassign(Array.from(selectedIds.value), target)
  selectedIds.value = new Set()
  selectMode.value = false
  await fetchList()
}

const onBack = () => {
  selected.value = null
}

const onClose = async () => {
  if (!selected.value) return
  if (!window.confirm(t('chat.confirmCloseConv'))) return
  await chat.setConversationStatus(selected.value.id, 'closed')
  selected.value = null
  await fetchList()
}

const onReopen = async () => {
  if (!selected.value) return
  await chat.setConversationStatus(selected.value.id, 'open')
  await fetchList()
}

const onAssignSelf = async () => {
  if (!selected.value || !appUser.value) return
  await chat.assignConversation(selected.value.id, appUser.value.id)
  await fetchList()
}

const onUnassign = async () => {
  if (!selected.value) return
  await chat.assignConversation(selected.value.id, null)
  await fetchList()
}

let heartbeatTimer: number | undefined
let chatChannel: any = null

onMounted(async () => {
  await fetchList()
  await loadStaffOptions()
  chat.heartbeat('web', 'online').catch(() => { /* ignore */ })
  heartbeatTimer = window.setInterval(() => {
    chat.heartbeat('web', 'online').catch(() => { /* ignore */ })
  }, 25_000)
  // Realtime: messages / conversations / members 变化都刷一次列表
  const { supabase } = await import('@/lib/supabase')
  chatChannel = supabase
    .channel('staff-chat-list')
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'chat_messages' }, () => {
      chat.invalidateList()
      fetchList().catch(() => { /* ignore */ })
    })
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'chat_conversations' }, () => {
      chat.invalidateList()
      fetchList().catch(() => { /* ignore */ })
    })
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'chat_conversation_members' }, () => {
      chat.invalidateList()
      fetchList().catch(() => { /* ignore */ })
    })
    .subscribe()
})

onBeforeUnmount(() => {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  chat.heartbeat('web', 'offline').catch(() => { /* ignore */ })
  // channel 可能是异步订阅还没完成, 通过 supabase API 全局清这一条
  if (chatChannel) {
    import('@/lib/supabase').then(({ supabase }) => {
      try { supabase.removeChannel(chatChannel) } catch { /* ignore */ }
    })
  }
})

const totalUnread = computed(() =>
  chat.conversations.value.reduce((s, c) => s + (c.unread_count ?? 0), 0),
)

const titleOf = (c: ChatConversation) => {
  if (c.subject_order?.order_no) return `# ${c.subject_order.order_no}`
  return t('chat.generalConsult')
}
</script>

<template>
  <div class="space-y-3">
    <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4">
      <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      <div class="relative flex items-start gap-3">
        <div class="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Headphones class="h-5 w-5 text-primary" />
        </div>
        <div class="flex-1 min-w-0">
          <h1 class="text-base sm:text-lg font-bold leading-tight">
            {{ t('chat.workspace') }}
          </h1>
          <p class="text-xs text-muted-foreground mt-0.5 max-w-xl">
            {{ t('chat.workspaceHint') }}
          </p>
        </div>
        <Badge v-if="totalUnread > 0" variant="default" class="text-[10px]">
          {{ totalUnread }} {{ t('chat.unread') }}
        </Badge>
      </div>
    </header>

    <!-- 工具栏: 会话搜索 + 筛选 -->
    <div class="rounded-2xl border bg-card px-3 py-2 flex items-center gap-2 flex-wrap">
      <div class="relative flex-1 min-w-[160px]">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          v-model="searchConv"
          type="text"
          :placeholder="t('chat.searchAccount')"
          class="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/40 border border-transparent focus:border-primary/40 focus:bg-background outline-none"
        />
      </div>
      <div class="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          :class="searchOpen ? 'border-primary text-primary' : ''"
          :title="t('chat.searchMessages')"
          @click="openSearch"
        >
          <Search class="h-3.5 w-3.5" />
          <span class="hidden sm:inline ml-1">{{ t('chat.searchMessages') }}</span>
        </Button>
      </div>
      <div class="flex items-center gap-1">
        <Button
          size="sm"
          :variant="filter === 'all' ? 'default' : 'ghost'"
          @click="filter = 'all'; fetchList()"
        >
          {{ t('chat.filterAll') }}
        </Button>
        <Button
          size="sm"
          :variant="filter === 'open' ? 'default' : 'ghost'"
          @click="filter = 'open'; fetchList()"
        >
          {{ t('chat.filterOpen') }}
        </Button>
        <Button
          size="sm"
          :variant="filter === 'closed' ? 'default' : 'ghost'"
          @click="filter = 'closed'; fetchList()"
        >
          {{ t('chat.filterClosed') }}
        </Button>
        <span class="mx-1 h-5 w-px bg-border" />
        <Button
          size="sm"
          :variant="selectMode ? 'default' : 'outline'"
          @click="toggleSelectMode"
        >
          <ListChecks class="h-3.5 w-3.5" />
          {{ t('chat.batchMode') }}
        </Button>
      </div>
    </div>

    <!-- 消息搜索浮层（独立全屏 overlay） -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="searchOpen"
          class="fixed inset-0 z-50 flex flex-col"
          style="background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);"
          @click.self="closeSearch"
        >
          <div class="m-auto w-full max-w-xl mx-4 bg-card rounded-2xl border shadow-2xl flex flex-col max-h-[80dvh]">
            <!-- 浮层头部 -->
            <div class="px-4 py-3 border-b flex items-center gap-3 shrink-0">
              <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0" @click="closeSearch">
                <X class="h-4 w-4" />
              </Button>
              <div class="relative flex-1">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  ref="searchInputRef"
                  v-model="searchMsgKw"
                  type="text"
                  :placeholder="t('chat.searchMessages')"
                  autofocus
                  class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md bg-muted/40 border border-transparent focus:border-primary/40 focus:bg-background outline-none"
                />
              </div>
              <span v-if="searchLoading" class="shrink-0">
                <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
              </span>
            </div>
            <!-- 结果列表 -->
            <div class="overflow-y-auto flex-1">
              <div v-if="!searchLoading && searchMsgKw && searchHits.length === 0" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <SearchX class="h-8 w-8 mb-2 opacity-40" />
                <p class="text-sm">{{ t('chat.noSearchResults') }}</p>
              </div>
              <ul v-else-if="searchHits.length > 0" class="divide-y">
                <li
                  v-for="hit in searchHits"
                  :key="hit.message_id"
                  class="px-4 py-3 hover:bg-muted/60 cursor-pointer transition"
                  @click="onPickSearchHit(hit)"
                >
                  <div class="flex items-start gap-3">
                    <div class="h-8 w-8 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
                      <MessageSquarePlus v-if="hit.message_kind === 'text'" class="h-4 w-4 text-primary" />
                      <span v-else-if="hit.message_kind === 'image'" class="text-base">🖼️</span>
                      <span v-else-if="hit.message_kind === 'order_card'" class="text-base">📦</span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-sm font-medium truncate flex-1">
                          {{ hit.account_name ?? '—' }}
                          <span v-if="hit.order_no" class="text-muted-foreground text-xs">· #{{ hit.order_no }}</span>
                        </span>
                        <span class="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {{ relativeTime(hit.created_at) }}
                        </span>
                      </div>
                      <p class="text-xs text-muted-foreground truncate mt-0.5">
                        <span class="text-foreground/80">{{ hit.sender_name ?? '—' }}:</span>
                        {{ hit.body }}
                      </p>
                    </div>
                  </div>
                </li>
              </ul>
              <div v-else class="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Search class="h-8 w-8 mb-2 opacity-30" />
                <p class="text-sm">{{ t('chat.searchMessages') }}</p>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 批量操作浮动条 (selectMode 开启时显示) -->
    <div
      v-if="selectMode"
      class="fixed left-1/2 -translate-x-1/2 bottom-20 z-30 rounded-2xl border bg-background shadow-xl px-3 py-2 flex items-center gap-2"
    >
      <span class="text-xs">
        {{ t('chat.selectedN', { n: selectedIds.size }) }}
      </span>
      <span class="mx-1 h-5 w-px bg-border" />
      <Button size="sm" variant="outline" @click="onBatchClose">
        <Archive class="h-3.5 w-3.5" />
        {{ t('chat.closeConversation') }}
      </Button>
      <Button size="sm" variant="outline" @click="onBatchReopen">
        <ArchiveRestore class="h-3.5 w-3.5" />
        {{ t('chat.reopenConversation') }}
      </Button>
      <div class="flex items-center gap-1">
        <select
          v-model="batchAssignTo"
          class="text-xs rounded-md border border-input bg-background px-2 py-1.5"
        >
          <option value="">{{ t('chat.assignTo') }}</option>
          <option v-for="s in staffOptions" :key="s.id" :value="s.id">
            {{ s.full_name ?? s.id.slice(0, 8) }} · {{ s.role }}
          </option>
        </select>
        <Button size="sm" :disabled="!batchAssignTo" @click="onBatchReassign">
          {{ t('chat.assignSelf') }}
        </Button>
      </div>
      <Button size="sm" variant="ghost" @click="clearSelection">
        {{ t('chat.deselectAll') }}
      </Button>
    </div>

    <!-- 三栏布局 -->
    <div
      class="rounded-2xl border bg-card overflow-hidden h-[calc(100dvh-260px)] min-h-[520px] grid grid-cols-1 md:grid-cols-[260px_280px_1fr]"
    >
      <!-- 左: 客户分组 -->
      <aside
        class="h-full overflow-y-auto border-r bg-muted/20"
        :class="[
          selected ? 'hidden md:block' : '',
          expandedGroupId ? 'hidden md:block' : '',
        ]"
      >
        <div class="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 py-2 border-b flex items-center gap-2">
          <Inbox class="h-4 w-4 text-primary" />
          <span class="text-sm font-semibold flex-1">
            {{ t('chat.staffGroups') }}
            <span class="text-[10px] text-muted-foreground ml-1">
              ({{ groups.length }})
            </span>
          </span>
        </div>
        <div v-if="chat.loadingList.value && groups.length === 0"
             class="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          {{ t('chat.loadingAccounts') }}
        </div>
        <div v-else-if="groups.length === 0"
             class="text-center px-4 py-10 text-xs text-muted-foreground">
          <p class="font-semibold text-foreground">{{ t('chat.noConversation') }}</p>
        </div>
        <ul v-else class="divide-y">
          <li
            v-for="g in groups"
            :key="g.account_id"
            class="px-3 py-2.5 cursor-pointer hover:bg-muted/60 transition"
            :class="expandedGroupId === g.account_id ? 'bg-primary/10' : ''"
            @click="onToggleGroup(g.account_id)"
          >
            <div class="flex items-center gap-2">
              <ChatAvatar
                :name="g.account_name"
                :role="'customer'"
                size="sm"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1">
                  <span class="text-sm font-medium truncate flex-1">
                    {{ g.account_name }}
                  </span>
                  <span class="text-[10px] text-muted-foreground tabular-nums">
                    {{ relativeTime(g.latest_message_at) }}
                  </span>
                </div>
                <p class="text-[11px] text-muted-foreground truncate">
                  {{ g.company_name || `${g.conversations.length} 会话` }}
                </p>
              </div>
              <Badge
                v-if="g.total_unread > 0"
                variant="default"
                class="text-[10px] tabular-nums"
              >
                {{ g.total_unread }}
              </Badge>
              <!-- selectMode 时显示"全选客户" -->
              <button
                v-if="selectMode"
                class="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted"
                :title="t('chat.selectAllInGroup')"
                @click.stop="
                  for (const c of g.conversations) selectedIds.add(c.id);
                  selectedIds = new Set(selectedIds)
                "
              >
                <CheckSquare class="h-4 w-4 text-primary" />
              </button>
              <ChevronRight
                v-if="!selectMode"
                class="h-3.5 w-3.5 text-muted-foreground"
                :class="expandedGroupId === g.account_id ? 'rotate-90 transition' : 'transition'"
              />
            </div>
          </li>
        </ul>
      </aside>

      <!-- 中: 当前分组的会话列表 -->
      <section
        class="h-full overflow-y-auto border-r"
        :class="selected ? 'hidden md:block' : (expandedGroupId ? 'block md:block' : 'hidden md:block')"
      >
        <div v-if="!expandedGroupId" class="h-full flex items-center justify-center px-6 text-center">
          <p class="text-xs text-muted-foreground">{{ t('chat.toggleGroup') }}</p>
        </div>
        <template v-else>
          <div class="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 py-2 border-b flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              class="md:hidden"
              @click="expandedGroupId = null"
            >
              <ArrowLeft class="h-4 w-4" />
            </Button>
            <span class="text-sm font-semibold flex-1 truncate">
              {{ groups.find(g => g.account_id === expandedGroupId)?.account_name ?? '' }}
            </span>
          </div>
          <ul class="divide-y">
            <li
              v-for="c in (groups.find(g => g.account_id === expandedGroupId)?.conversations ?? [])"
              :key="c.id"
              class="px-3 py-2.5 cursor-pointer hover:bg-muted/60 transition"
              :class="[
                selected?.id === c.id ? 'bg-primary/10' : '',
                selectMode && selectedIds.has(c.id) ? 'ring-1 ring-primary/60 bg-primary/5' : '',
              ]"
              @click="onPickConversation(c)"
            >
              <div class="flex items-start gap-2">
                <div class="h-7 w-7 shrink-0 rounded-md bg-primary/10 flex items-center justify-center">
                  <MessageSquarePlus class="h-3.5 w-3.5 text-primary" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1">
                    <span class="text-xs font-medium truncate flex-1">
                      {{ titleOf(c) }}
                    </span>
                    <span class="text-[10px] text-muted-foreground tabular-nums">
                      {{ relativeTime(c.last_message_at) }}
                    </span>
                  </div>
                  <p class="text-[11px] text-muted-foreground truncate">
                    {{
                      c.last_message
                        ? c.last_message.body
                        : t('chat.emptyMessages')
                    }}
                  </p>
                  <div class="flex items-center gap-1 mt-0.5">
                    <Badge v-if="c.assigned_to" variant="secondary" class="text-[9px]">
                      {{ c.assigned?.full_name ?? '—' }}
                    </Badge>
                    <Badge v-else variant="outline" class="text-[9px]">
                      {{ t('chat.unassigned') }}
                    </Badge>
                    <Badge v-if="c.status !== 'open'" variant="outline" class="text-[9px]">
                      {{ c.status }}
                    </Badge>
                  </div>
                </div>
                <component
                  v-if="selectMode"
                  :is="selectedIds.has(c.id) ? CheckSquare : Square"
                  class="h-4 w-4 shrink-0"
                  :class="selectedIds.has(c.id) ? 'text-primary' : 'text-muted-foreground'"
                />
                <Badge
                  v-else-if="(c.unread_count ?? 0) > 0"
                  variant="default"
                  class="text-[10px] tabular-nums"
                >
                  {{ c.unread_count }}
                </Badge>
              </div>
            </li>
          </ul>
        </template>
      </section>

      <!-- 右: ChatPanel -->
      <section class="h-full">
        <div v-if="!selected" class="h-full flex items-center justify-center px-6 text-center">
          <div class="space-y-2">
            <p class="text-sm font-semibold">{{ t('chat.selectConv') }}</p>
            <p class="text-xs text-muted-foreground max-w-xs mx-auto">
              {{ t('chat.staffBannerHint') }}
            </p>
          </div>
        </div>
        <div v-else class="h-full flex flex-col">
          <!-- 顶部工具条: 接单/关闭/返回 -->
          <div class="px-3 py-2 border-b flex items-center gap-1 bg-muted/30">
            <Button
              size="icon"
              variant="ghost"
              class="md:hidden"
              @click="onBack"
            >
              <ArrowLeft class="h-4 w-4" />
            </Button>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold truncate">
                {{ selected.account?.account_name ?? '—' }}
                <span class="text-muted-foreground">·</span>
                {{ titleOf(selected) }}
              </p>
            </div>
            <Button
              v-if="selected.status === 'open'"
              size="sm"
              variant="outline"
              :title="t('chat.assignSelf')"
              @click="onAssignSelf"
            >
              <UserCheck class="h-3.5 w-3.5" />
              <span class="hidden lg:inline">{{ t('chat.assignSelf') }}</span>
            </Button>
            <Button
              v-else-if="selected.assigned_to"
              size="sm"
              variant="ghost"
              :title="t('chat.unassign')"
              @click="onUnassign"
            >
              <UserX class="h-3.5 w-3.5" />
            </Button>
            <Button
              v-if="selected.status === 'open'"
              size="sm"
              variant="outline"
              :title="t('chat.closeConversation')"
              @click="onClose"
            >
              <Archive class="h-3.5 w-3.5" />
              <span class="hidden lg:inline">{{ t('chat.closeConversation') }}</span>
            </Button>
            <Button
              v-else
              size="sm"
              variant="outline"
              :title="t('chat.reopenConversation')"
              @click="onReopen"
            >
              <CheckCircle2 class="h-3.5 w-3.5" />
              <span class="hidden lg:inline">{{ t('chat.reopenConversation') }}</span>
            </Button>
          </div>
          <div class="flex-1 min-h-0">
            <ChatPanel
              :account-id="selected.account_id"
              :subject-order-id="selected.subject_order_id"
              embedded
              @close="onBack"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
