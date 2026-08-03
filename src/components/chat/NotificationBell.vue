<!--
  NotificationBell —— 顶栏铃铛 + 红点 + dropdown
  - 显示 unread 数 (badge)
  - 点击打开 dropdown 列表
  - 点击单条 → 标记已读 + 跳到 link
  - "全部已读" / 浏览器通知开关
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Check, BellOff } from 'lucide-vue-next'
import { useNotifications } from '@/composables/useNotifications'
import { useI18n } from '@/lib/i18n'

const router = useRouter()
const { t } = useI18n()
const notif = useNotifications()

const open = ref(false)
const bellRef = ref<HTMLDivElement | null>(null)
const bellBtnRef = ref<HTMLButtonElement | null>(null)
const baseTitle = ref<string>(typeof document !== 'undefined' ? document.title : '')

const badgeText = computed(() => {
  if (notif.unread.value <= 0) return ''
  if (notif.unread.value > 9) return '9+'
  return String(notif.unread.value)
})

const load = async () => {
  await Promise.all([notif.fetchList(50, false), notif.fetchUnreadCount()])
}

const onToggle = async () => {
  open.value = !open.value
  if (open.value) await load()
}

const onItemClick = async (n: any) => {
  if (!n.read_at) {
    try { await notif.markRead(n.id) } catch { /* ignore */ }
  }
  open.value = false
  if (n.link) {
    if (router) {
      try { router.push(n.link) } catch { window.location.href = n.link }
    } else {
      window.location.href = n.link
    }
  }
}

const onMarkAll = async () => {
  try { await notif.markAllRead() } catch { /* ignore */ }
}

const onToggleBrowser = async () => {
  if (notif.browserEnabled.value) {
    notif.browserEnabled.value = false
    try { window.localStorage?.setItem('chat.notifications.browser_enabled', '0') } catch { /* ignore */ }
  } else {
    await notif.requestBrowserPermission()
  }
}

const onDocClick = (e: MouseEvent) => {
  if (!open.value) return
  const target = e.target as HTMLElement
  if (bellRef.value?.contains(target) || bellBtnRef.value?.contains(target)) return
  open.value = false
}

const onVisibility = async () => {
  // 回到前台时刷新未读
  if (document.visibilityState === 'visible') {
    await notif.fetchUnreadCount()
  }
}

watch(notif.unread, (n) => {
  const base = baseTitle.value
  if (n > 0) {
    document.title = `(${n > 9 ? '9+' : n}) ${base}`
  } else if (document.title !== base) {
    document.title = base
  }
})

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
    return d.toLocaleDateString()
  } catch { return '' }
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

const titleOf = (n: any) => notif.renderText(n).title || n.title || ''
const bodyOf = (n: any) => notif.renderText(n).body || n.body || ''

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('visibilitychange', onVisibility)
  // 注入 i18n 渲染器 (useNotifications 在 singleton 中)
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
  await load()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div ref="bellRef" class="relative">
    <button
      ref="bellBtnRef"
      type="button"
      class="relative h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-muted transition"
      :title="t('notif.title')"
      @click.stop="onToggle"
    >
      <Bell class="h-5 w-5" />
      <span
        v-if="badgeText"
        class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium inline-flex items-center justify-center"
      >
        {{ badgeText }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full mt-1 z-50 w-[360px] sm:w-[400px] max-h-[70vh] overflow-hidden rounded-lg border bg-background shadow-lg flex flex-col"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between px-3 py-2 border-b">
        <h3 class="text-sm font-semibold">{{ t('notif.title') }}</h3>
        <div class="flex items-center gap-1">
          <button
            v-if="notif.browserSupported.value"
            class="h-7 w-7 rounded-full inline-flex items-center justify-center hover:bg-muted text-muted-foreground"
            :title="notif.browserEnabled.value ? t('notif.browserOn') : t('notif.browserOff')"
            @click.stop="onToggleBrowser"
          >
            <Bell v-if="notif.browserEnabled.value" class="h-3.5 w-3.5" />
            <BellOff v-else class="h-3.5 w-3.5" />
          </button>
          <button
            v-if="notif.unread.value > 0"
            class="h-7 px-2 text-xs rounded inline-flex items-center gap-1 hover:bg-muted text-muted-foreground"
            @click.stop="onMarkAll"
          >
            <Check class="h-3 w-3" />
            {{ t('notif.markAllRead') }}
          </button>
        </div>
      </div>

      <!-- 列表 -->
      <div class="flex-1 overflow-y-auto">
        <div v-if="notif.loading.value && notif.list.value.length === 0" class="p-6 text-center text-xs text-muted-foreground">
          {{ t('notif.loading') }}
        </div>
        <div
          v-else-if="notif.list.value.length === 0"
          class="p-6 text-center text-xs text-muted-foreground"
        >
          {{ t('notif.empty') }}
        </div>
        <ul v-else class="divide-y">
          <li
            v-for="n in notif.list.value.slice(0, 20)"
            :key="n.id"
            class="px-3 py-2 cursor-pointer hover:bg-muted/60 flex gap-2"
            :class="!n.read_at ? 'bg-primary/5' : ''"
            @click="onItemClick(n)"
          >
            <div class="text-xl shrink-0 leading-none mt-0.5">{{ kindIcon(n.kind) }}</div>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="text-sm font-medium truncate">{{ titleOf(n) }}</span>
                <span class="ml-auto text-[10px] text-muted-foreground shrink-0">{{ formatTime(n.created_at) }}</span>
              </div>
              <p class="text-xs text-muted-foreground truncate">{{ bodyOf(n) }}</p>
            </div>
            <span
              v-if="!n.read_at"
              class="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5"
              :title="t('notif.unread')"
            />
          </li>
        </ul>
      </div>

      <!-- 底部 -->
      <div v-if="notif.list.value.length > 0" class="border-t px-3 py-1.5 text-center">
        <RouterLink
          to="/notifications"
          class="text-xs text-primary hover:underline"
          @click="open = false"
        >
          {{ t('notif.pageTitle') }} →
        </RouterLink>
      </div>
    </div>
  </div>
</template>
