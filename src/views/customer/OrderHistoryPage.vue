<!--
  src/views/customer/OrderHistoryPage.vue
  客户订单历史
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { Eye, Loader2, ListOrdered, History, ArrowLeft } from 'lucide-vue-next'

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

const { t } = useI18n()
const router = useRouter()
const ordersApi = useOrders()
const statusFilter = ref<'all' | 'pending' | 'audited' | 'accounted' | 'shipped' | 'cancelled'>('all')

const refresh = async () => {
  // 列表页全量拉 — 不带 status 参数（RLS 自己决定可见范围）
  await ordersApi.fetchByStatus(undefined)
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

// 各状态计数（用于 chips 显示绝对数）
const STATUSES = ['all', 'pending', 'audited', 'accounted', 'shipped', 'cancelled'] as const

const statusCount = (s: typeof STATUSES[number]) => {
  if (s === 'all') return ordersApi.items.value.length
  return ordersApi.items.value.filter((o) => o.status === s).length
}
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
        <!-- 顶部 mini header -->
        <div class="px-5 sm:px-6 py-4 border-b bg-muted/20 flex items-center gap-3">
          <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <ListOrdered class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">订单列表</p>
            <p class="text-[11px] text-muted-foreground leading-snug">
              按状态过滤查看订单；空状态会有占位提示
            </p>
          </div>
        </div>

        <!-- 状态过滤 chips：放 section header 下方 -->
        <div class="px-5 sm:px-6 py-3 border-b bg-background flex gap-2 overflow-x-auto -mx-0">
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
              v-if="statusCount(s) > 0"
              variant="secondary"
              class="ml-1.5 text-[10px] tabular-nums px-1.5"
            >
              {{ statusCount(s) }}
            </Badge>
          </Button>
        </div>

        <!-- 表格 -->
        <Table>
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
            <TableRow v-for="o in ordersApi.items.value" :key="o.id">
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
            <TableEmpty v-if="!ordersApi.fetched.value && ordersApi.items.value.length === 0">
              <div class="space-y-2 py-2">
                <div v-for="i in 5" :key="i" class="flex items-center gap-3">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-28" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-3 w-16" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-6 w-16 rounded-full" />
                </div>
              </div>
            </TableEmpty>
            <TableEmpty v-else-if="ordersApi.items.value.length === 0">
              <div class="space-y-2 py-3 text-center">
                <p class="text-sm">{{ t('orders.empty') }}</p>
                <!--
                  error 暴露：之前只 set error.value 但 UI 没渲染，
                  admin 用户看到空列表时不知道为什么 RLS 拒绝
                -->
                <p
                  v-if="ordersApi.error.value"
                  class="text-[11px] text-destructive max-w-md mx-auto leading-relaxed"
                >
                  {{ ordersApi.error.value }}
                </p>
              </div>
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
