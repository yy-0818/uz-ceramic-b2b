<!--
  src/views/layout/AppLayout.vue
  按角色显示导航；移动端底部精简为 4 个主项 + "更多" 抽屉
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { LogOut, Factory, ShoppingCart, Package, Upload, Filter, Globe, FileText, ClipboardCheck, Landmark, Truck, Link2, Database, Users, MoreHorizontal, X } from 'lucide-vue-next'

import { useAuth } from '@/composables/useAuth'
import { setLocale } from '@/lib/i18n'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const { account, appUser, isAdmin, signOut } = useAuth()

type NavItem = { name: string; to: string; icon: any }

const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = []
  if (appUser.value?.role === 'customer' || isAdmin.value) {
    items.push({ name: t('nav.catalog'), to: '/catalog', icon: Package })
    items.push({ name: t('nav.orders'), to: '/orders', icon: FileText })
  }
  if (isAdmin.value) {
    items.push({ name: t('nav.import'), to: '/admin/import', icon: Upload })
    items.push({ name: t('nav.allProducts'), to: '/admin/products', icon: Database })
    items.push({ name: t('nav.customerGroups'), to: '/admin/customer-groups', icon: Link2 })
    items.push({ name: t('nav.assign'), to: '/admin/assign', icon: Filter })
    items.push({ name: t('nav.accounts'), to: '/admin/accounts', icon: Users })
  }
  if (appUser.value?.role === 'checker' || isAdmin.value) {
    items.push({ name: t('nav.audit'), to: '/audit', icon: ClipboardCheck })
  }
  if (appUser.value?.role === 'finance' || isAdmin.value) {
    items.push({ name: t('nav.finance'), to: '/finance', icon: Landmark })
  }
  if (appUser.value?.role === 'warehouse' || isAdmin.value) {
    items.push({ name: t('nav.fulfillment'), to: '/warehouse', icon: Truck })
  }
  return items
})

// 移动端：底部固定 4 项 = catalog/orders + 当前角色最高频入口 + "更多"
// 这样在 admin 视角下也能露出核心 + 抽屉。
const MOBILE_PRIMARY: Record<string, string[]> = {
  admin:     ['/admin/import', '/admin/products', '/admin/assign', '/admin/customer-groups'],
  customer:  ['/catalog', '/orders'],
  checker:   ['/audit'],
  finance:   ['/finance'],
  warehouse: ['/warehouse'],
}

const primaryItems = computed<NavItem[]>(() => {
  const priorities = MOBILE_PRIMARY[appUser.value?.role ?? 'customer'] ?? ['/catalog', '/orders']
  const picked: NavItem[] = []
  for (const to of priorities) {
    const found = navItems.value.find((n) => n.to === to)
    if (found) picked.push(found)
  }
  // 不够 4 个的，用 navItems 剩余的补到 4
  for (const n of navItems.value) {
    if (picked.length >= 4) break
    if (!picked.find((p) => p.to === n.to)) picked.push(n)
  }
  // 永远多塞一个"更多"
  return picked.slice(0, 4)
})

const overflowItems = computed<NavItem[]>(() => {
  const used = new Set(primaryItems.value.map((n) => n.to))
  return navItems.value.filter((n) => !used.has(n.to))
})

const moreOpen = ref(false)

const isActive = (to: string) =>
  route.path === to || route.path.startsWith(to + '/')

const onLogout = async () => {
  await signOut()
  router.push('/login')
}

const cycleLocale = () => {
  const next = locale.value === 'ru' ? 'uz' : locale.value === 'uz' ? 'zh' : 'ru'
  setLocale(next as any)
}

const goAndClose = (to: string) => {
  moreOpen.value = false
  router.push(to)
}

// 按角色自动落到对应首页（避免管理员登录后落在客户式浏览页）
const homeByRole = (role: string | undefined) => {
  switch (role) {
    case 'admin':     return '/admin/import'
    case 'checker':   return '/audit'
    case 'finance':   return '/finance'
    case 'warehouse': return '/warehouse'
    case 'customer':  return '/catalog'
    default:          return '/orders'
  }
}
import { onMounted } from 'vue'
onMounted(() => {
  if (route.path === '/' || route.path === '/catalog') {
    const target = homeByRole(appUser.value?.role)
    if (target !== route.path) router.replace(target)
  }
})
</script>

<template>
  <div class="min-h-dvh flex flex-col md:flex-row">
    <!-- 桌面端侧栏 -->
    <aside class="hidden md:flex w-60 shrink-0 border-r bg-muted/30 flex-col">
      <div class="h-14 flex items-center gap-2 px-4 border-b">
        <div class="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Factory class="h-4 w-4" />
        </div>
        <span class="font-semibold text-sm">Ceramic B2B</span>
      </div>
      <nav class="flex-1 p-3 space-y-1">
        <RouterLink
          v-for="it in navItems"
          :key="it.to"
          :to="it.to"
          class="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition"
          :class="isActive(it.to) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
        >
          <component :is="it.icon" class="h-4 w-4" />
          {{ it.name }}
        </RouterLink>
      </nav>
      <div class="border-t p-3 text-xs text-muted-foreground">
        <p class="font-medium text-foreground truncate">{{ account?.account_name }}</p>
        <p class="truncate">{{ account?.company_name }}</p>
      </div>
    </aside>

    <div class="flex-1 flex flex-col min-w-0">
      <header class="h-14 border-b flex items-center justify-between px-4">
        <div class="flex items-center gap-2">
          <div class="md:hidden h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <Factory class="h-4 w-4" />
          </div>
          <span class="text-sm font-medium truncate">{{ account?.account_name }}</span>
          <Badge variant="secondary">{{ appUser?.role }}</Badge>
        </div>
        <div class="flex items-center gap-1">
          <Button size="sm" variant="ghost" @click="cycleLocale">
            <Globe class="h-4 w-4 mr-1" />
            {{ locale.toUpperCase() }}
          </Button>
          <Button size="sm" variant="ghost" @click="onLogout">
            <LogOut class="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main class="flex-1 p-4 md:p-6 max-w-screen-2xl mx-auto w-full pb-20 md:pb-6">
        <RouterView />
      </main>

      <!-- 移动端底部 nav：精简 4 个 + "更多" -->
      <nav class="md:hidden fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur z-20">
        <div class="grid items-center h-14" :style="{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }">
          <RouterLink
            v-for="it in primaryItems"
            :key="it.to"
            :to="it.to"
            class="flex flex-col items-center justify-center gap-0.5 h-full text-[11px]"
            :class="isActive(it.to) ? 'text-primary' : 'text-muted-foreground'"
          >
            <component :is="it.icon" class="h-5 w-5" />
            <span class="truncate max-w-[5rem]">{{ it.name }}</span>
          </RouterLink>
          <!-- "更多" 按钮 -->
          <button
            class="flex flex-col items-center justify-center gap-0.5 h-full text-[11px]"
            :class="overflowItems.some((n) => isActive(n.to)) ? 'text-primary' : 'text-muted-foreground'"
            @click="moreOpen = true"
          >
            <MoreHorizontal class="h-5 w-5" />
            <span>更多</span>
          </button>
        </div>
      </nav>
    </div>

    <!-- "更多" 抽屉 -->
    <Dialog v-model:open="moreOpen" title="所有页面" description="点击进入任一页面">
      <div v-if="overflowItems.length === 0" class="text-sm text-muted-foreground text-center py-4">
        已在底部栏显示全部页面
      </div>
      <ul v-else class="space-y-1 max-h-[60vh] overflow-y-auto">
        <li v-for="it in overflowItems" :key="it.to">
          <button
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition text-left"
            :class="isActive(it.to) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            @click="goAndClose(it.to)"
          >
            <component :is="it.icon" class="h-4 w-4 shrink-0" />
            <span class="flex-1">{{ it.name }}</span>
          </button>
        </li>
      </ul>
      <div class="mt-4 pt-3 border-t">
        <p class="text-xs text-muted-foreground">
          当前身份：<strong>{{ appUser?.role }}</strong>
          · {{ account?.account_name }}
        </p>
      </div>
    </Dialog>
  </div>
</template>