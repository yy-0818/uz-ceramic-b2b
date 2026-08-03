<!--
  src/views/NotificationsPage.vue
  Phase 6: 全部通知独立页
  - 全部 / 未读 切换
  - 类型筛选 (chip)
  - 无限加载 (cursor: created_at)
  - 单条点击 → 标记已读 + 跳转 link
  - 全部已读
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Check, Filter, ArrowLeft } from 'lucide-vue-next'
import { useNotifications } from '@/composables/useNotifications'
import { useI18n } from '@/lib/i18n'
import Button from '@/components/ui/Button.vue'

const router = useRouter()
const { t } = useI18n()
const notif = useNotifications()

const filter = ref<'all' | 'unread'>('all')
const kindFilter = ref<string | null>(null)
const loadingMore = ref(false)

const filtered = computed(() => {
  let arr = notif.list.value
  if (filter.value === 'unread') arr = arr.filter((n) => !n.read_at)
  if (kindFilter.value) arr = arr.filter((n) => n.kind === kindFilter.value)
  return arr
})

const kindOptions = computed(() => [
  { id: null, label: t('notif.filterAll') },
  { id: 'chat_message', label: t('notif.kind.chat_message') },
  { id: 'order_status', label: t('notif.kind.order_status') },
  { id: 'staff_assigned', label: t('notif.kind.staff_assigned') },
  { id: 'staff_transferred', label: t('notif.kind.staff_transferred') },
  { id: 'system', label: t('notif.kind.system') },
])

const titleOf = (n: any) => notif.renderText(n).title || n.title || ''
const bodyOf = (n: any) => notif.renderText(n).body || n.body || ''

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch { return iso }
}

const kindIcon = (k: string) => {
  switch (k) {
    case 'order_status': return '📦'
    case 'chat_message': return '💬'
    case 'staff_assigned': return '🙋'
    case 'staff_transferred': return '🔁'
    default: return '🔔'
  }
}

const onItemClick = async (n: any) => {
  if (!n.read_at) {
    try { await notif.markRead(n.id) } catch { /* ignore */ }
  }
  if (n.link) {
    try { router.push(n.link) } catch { window.location.href = n.link }
  }
}

const onMarkAll = async () => {
  try { await notif.markAllRead() } catch { /* ignore */ }
}

const onLoadMore = async () => {
  if (loadingMore.value) return
  if (notif.list.value.length < 50) return
  loadingMore.value = true
  try {
    await notif.fetchList(Math.min(notif.list.value.length + 50, 200))
  } finally {
    loadingMore.value = false
  }
}

onMounted(async () => {
  notif.setI18nRenderer((kindKey, payload) => {
    const tt = (k: string, v?: Record<string, any>) => t(k, v)
    if (kindKey === 'chat_message') {
      return {
        title: tt('notif.chat_message.title', { sender_name: payload?.sender_name ?? '' }),
        body: tt('notif.chat_message.body', { preview: payload?.preview ?? '' }),
      }
    }
    if (kindKey === 'order_status') {
      return {
        title: tt('notif.order_status.title', { order_no: payload?.order_no ?? '' }),
        body: tt('notif.order_status.body', payload ?? {}),
      }
    }
    return { title: '', body: '' }
  })
  await notif.ensureSubscribed()
  await notif.fetchList(100, false)
  await notif.fetchUnreadCount()
})
</script>

<template>
  <div class="max-w-3xl mx-auto w-full p-3 md:p-4">
    <header class="flex items-center gap-2 mb-4">
      <Button variant="ghost" size="icon" @click="router.back()">
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <Bell class="h-5 w-5" />
      <h1 class="text-lg font-semibold flex-1">{{ t('notif.pageTitle') }}</h1>
      <span
        v-if="notif.unread.value > 0"
        class="inline-flex items-center gap-1 px-2 h-7 rounded-full bg-destructive/10 text-destructive text-xs font-medium"
      >
        {{ t('notif.unread') }}: {{ notif.unread.value }}
      </span>
      <Button
        v-if="notif.unread.value > 0"
        size="sm"
        variant="outline"
        @click="onMarkAll"
      >
        <Check class="h-4 w-4 mr-1" />
        {{ t('notif.markAllRead') }}
      </Button>
    </header>

    <!-- 筛选 -->
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <div class="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
        <button
          class="h-7 px-3 rounded"
          :class="filter === 'all' ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          @click="filter = 'all'"
        >
          {{ t('notif.allTab') }}
        </button>
        <button
          class="h-7 px-3 rounded"
          :class="filter === 'unread' ? 'bg-background shadow-sm' : 'text-muted-foreground'"
          @click="filter = 'unread'"
        >
          {{ t('notif.unreadTab') }}
        </button>
      </div>
      <div class="flex items-center gap-1 flex-wrap">
        <Filter class="h-3.5 w-3.5 text-muted-foreground" />
        <button
          v-for="k in kindOptions"
          :key="k.id ?? 'all'"
          class="h-7 px-2.5 rounded-full text-xs border transition"
          :class="kindFilter === k.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'"
          @click="kindFilter = k.id"
        >
          {{ k.label }}
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="notif.loading.value && notif.list.value.length === 0" class="text-center text-sm text-muted-foreground py-12">
      {{ t('notif.loading') }}
    </div>
    <div v-else-if="filtered.length === 0" class="text-center text-sm text-muted-foreground py-12">
      {{ t('notif.empty') }}
    </div>
    <ul v-else class="rounded-lg border bg-card overflow-hidden divide-y">
      <li
        v-for="n in filtered"
        :key="n.id"
        class="px-3 md:px-4 py-3 cursor-pointer hover:bg-muted/60 flex gap-3"
        :class="!n.read_at ? 'bg-primary/5' : ''"
        @click="onItemClick(n)"
      >
        <div class="text-2xl shrink-0 leading-none mt-0.5">{{ kindIcon(n.kind) }}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium truncate">{{ titleOf(n) }}</span>
            <span class="ml-auto text-xs text-muted-foreground shrink-0">{{ formatTime(n.created_at) }}</span>
          </div>
          <p class="text-sm text-muted-foreground mt-0.5 break-words">{{ bodyOf(n) }}</p>
          <p class="text-[10px] text-muted-foreground/70 mt-1 uppercase tracking-wider">{{ t(`notif.kind.${n.kind}`) }}</p>
        </div>
        <span
          v-if="!n.read_at"
          class="h-2 w-2 rounded-full bg-primary shrink-0 mt-2"
          :title="t('notif.unread')"
        />
      </li>
    </ul>

    <!-- 加载更多 -->
    <div v-if="notif.list.value.length >= 50" class="text-center mt-4">
      <Button variant="ghost" size="sm" :disabled="loadingMore" @click="onLoadMore">
        {{ loadingMore ? '…' : '加载更多' }}
      </Button>
    </div>
  </div>
</template>
