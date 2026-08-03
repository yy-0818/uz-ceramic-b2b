<!--
  src/views/customer/OrderHistoryPage.vue
  客户订单历史
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { Eye, Loader2, ListOrdered, History, ArrowLeft, Search } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableEmpty from '@/components/ui/TableEmpty.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

import { useOrders } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'

const { t } = useI18n()
const router = useRouter()
const ordersApi = useOrders()
const { appUser } = useAuth()
const statusFilter = ref<'all' | 'pending' | 'audited' | 'accounted' | 'shipped' | 'cancelled'>('all')
const STATUSES = ['all', 'pending', 'audited', 'accounted', 'shipped', 'cancelled'] as const
const keyword = ref('')

/**
 * 兜底超时：fetch 出错 / promise 挂起时，fetched.value 不会变 true，
 * skeleton 会一直显示。让 refresh 启动一个 8s 定时器，
 * 超时后强制 fetched=true（只在组件内部维护的视图 flag），
 * 让 UI 退出 skeleton 显示空状态 / 错误。
 */
const forceShowEmpty = ref(false)
const refresh = async () => {
  forceShowEmpty.value = false
  const timer = setTimeout(() => {
    // 8s 内 fetch 没完成，强制退出 skeleton
    if (ordersApi.loading.value) {
      forceShowEmpty.value = true
    }
  }, 8000)
  try {
    // 按 statusFilter 拉：'all' → undefined，其他 → 对应状态
    const target = statusFilter.value === 'all' ? undefined : statusFilter.value
    await ordersApi.fetchByStatus(target)
  } finally {
    clearTimeout(timer)
    // fetch 完成后立刻关闭兜底（fetched 已 true）
    if (!ordersApi.loading.value) forceShowEmpty.value = false
  }
}

onMounted(refresh)

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

const statusVariant = (s: string) => {
  switch (s) {
    case 'pending':   return 'secondary'
    case 'audited':   return 'default'
    case 'accounted': return 'default'
    case 'shipped':   return 'default'
    case 'cancelled': return 'secondary'
    default: return 'secondary'
  }
}

const goBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/catalog')
}

// 各状态计数 — 仅展示"全部"总数；其他 chip 不再计数
// 因为 items 是按 statusFilter 过滤后的，过滤后统计"待审核有几条"等于 items.length，
// 没有信息量。要展示各状态真实数量需要再发一次全量查询，权衡后只保留「全部」总数。
const totalCount = computed(() => {
  return ordersApi.items.value.length
})

const filteredOrders = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return ordersApi.items.value
  return ordersApi.items.value.filter((o) =>
    (o.order_no ?? '').toLowerCase().includes(q) ||
    (o.account?.account_name ?? '').toLowerCase().includes(q) ||
    (o.account?.company_name ?? '').toLowerCase().includes(q) ||
    (o.sub_account?.account_name ?? '').toLowerCase().includes(q) ||
    (o.status ?? '').toLowerCase().includes(q),
  )
})
</script>

<template>
  <div class="space-y-4">
    <!-- ===================== 顶部 hero ===================== -->
    <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4 sm:py-5">
      <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      <div class="pointer-events-none absolute -right-4 top-1/2 h-24 w-24 rounded-full bg-primary/5" />

      <div class="relative flex items-start gap-2 flex-wrap">
        <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0 -ml-1" @click="goBack">
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 flex-wrap">
            <h1 class="text-base sm:text-lg font-bold leading-tight">
              {{ t('orders.title') }}
            </h1>
            <span class="text-[10px] font-semibold tracking-wider text-primary uppercase">
              History · {{ ordersApi.items.value.length }} 单
            </span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            查看历史订单与当前状态；点击行右侧图标查看详情。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          class="shrink-0"
          :disabled="ordersApi.loading.value"
          @click="refresh"
        >
          <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
          <History v-else class="h-4 w-4" />
          <span class="hidden sm:inline ml-1">刷新</span>
        </Button>
      </div>
    </header>

    <!-- ===================== 主区：单一卡片 ===================== -->
    <Card class="overflow-hidden">
      <CardContent class="p-0">
        <!-- 搜索 + 状态过滤 -->
        <div class="px-5 sm:px-6 py-3 border-b bg-background flex flex-col sm:flex-row gap-3">
          <!-- 搜索 -->
          <div class="relative flex-1 min-w-0">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              v-model="keyword"
              type="text"
              :placeholder="t('orders.searchPlaceholder')"
              class="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/40 border border-transparent focus:border-primary/40 focus:bg-background outline-none"
            />
          </div>
          <!-- chips -->
          <div class="flex gap-2 shrink-0">
            <Button
              v-for="s in STATUSES"
              :key="s"
              size="sm"
              :variant="statusFilter === s ? 'default' : 'outline'"
              class="shrink-0"
              @click="statusFilter = s; refresh()"
            >
              {{ t(`orders.status.${s}`) }}
              <Badge
                v-if="s === 'all' && totalCount > 0"
                variant="secondary"
                class="ml-1.5 text-[10px] tabular-nums px-1.5"
              >
                {{ totalCount }}
              </Badge>
            </Button>
          </div>
        </div>

        <!-- 表格 -->
        <Table>
          <colgroup>
            <col style="width: 130px" />
            <col style="width: 130px" />
            <col style="width: 120px" />
            <col style="width: 70px" />
            <col style="width: 90px" />
            <col style="width: 90px" />
            <col style="width: 60px" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('orders.colNo') }}</TableHead>
              <TableHead>{{ t('orders.colDate') }}</TableHead>
              <TableHead>子账户</TableHead>
              <TableHead>{{ t('orders.colItems') }}</TableHead>
              <TableHead>{{ t('orders.colM2') }}</TableHead>
              <TableHead>{{ t('orders.colStatus') }}</TableHead>
              <TableHead class="text-right">{{ t('orders.colAction') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="o in filteredOrders" :key="o.id">
              <TableCell class="font-mono text-sm">{{ o.order_no }}</TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ fmtDate(o.created_at) }}</TableCell>
              <TableCell>
                <span v-if="o.sub_account" class="font-mono text-xs">{{ o.sub_account.account_name }}</span>
                <span v-else class="text-xs text-muted-foreground italic">—</span>
              </TableCell>
              <TableCell>{{ o.items?.length ?? 0 }}</TableCell>
              <TableCell>
                {{ (o.items ?? []).reduce((s, i) => s + Number(i.m2_total ?? 0), 0).toFixed(2) }} м²
              </TableCell>
              <TableCell>
                <Badge :variant="statusVariant(o.status) as any">
                  {{ t(`orders.status.${o.status}`) }}
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="ghost" @click="router.push(`/orders/${o.id}`)">
                  <Eye class="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
            <!-- skeleton -->
            <TableEmpty v-if="!forceShowEmpty && !ordersApi.fetched.value && ordersApi.items.value.length === 0">
              <table class="w-full">
                <tr v-for="i in 5" :key="i" class="border-b">
                  <td class="p-4"><Skeleton class="h-4 w-24" /></td>
                  <td class="p-4"><Skeleton class="h-3 w-28" /></td>
                  <td class="p-4"><Skeleton class="h-3 w-20" /></td>
                  <td class="p-4"><Skeleton class="h-3 w-10" /></td>
                  <td class="p-4"><Skeleton class="h-3 w-16" /></td>
                  <td class="p-4"><Skeleton class="h-6 w-16 rounded-full" /></td>
                  <td class="p-4 text-right"><Skeleton class="h-8 w-8 rounded" /></td>
                </tr>
              </table>
            </TableEmpty>
            <TableEmpty v-else-if="filteredOrders.length === 0 && ordersApi.items.value.length > 0">
              <div class="py-8 text-center">
                <p class="text-sm text-muted-foreground">{{ t('orders.noResults') }}</p>
                <p class="text-[11px] text-muted-foreground mt-1">换个关键词试试</p>
              </div>
            </TableEmpty>
            <TableEmpty v-else-if="ordersApi.items.value.length === 0">
              <div class="space-y-2 py-3 text-center">
                <p class="text-sm">{{ t('orders.empty') }}</p>
                <p
                  v-if="ordersApi.error.value"
                  class="text-[11px] text-destructive max-w-md mx-auto leading-relaxed"
                >
                  {{ ordersApi.error.value }}
                </p>
                <p
                  v-if="!ordersApi.error.value && forceShowEmpty"
                  class="text-[11px] text-muted-foreground max-w-md mx-auto leading-relaxed"
                >
                  加载超时（>8s）。当前角色：<b>{{ appUser?.role ?? 'unknown' }}</b>。
                  如应为 admin 但看到空列表，请检查 public.users 里该用户的 role 是否为 'admin'。
                </p>
              </div>
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
