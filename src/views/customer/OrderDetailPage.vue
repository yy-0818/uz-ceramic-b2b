<!--
  src/views/customer/OrderDetailPage.vue
  客户/员工通用订单详情页
  - 客户：只读
  - 审核员/财务/仓库：根据角色显示操作按钮
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { ArrowLeft, Loader2, FileText, Receipt, User, Box, Wallet, History } from 'lucide-vue-next'

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

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/composables/useAuth'
import { useOrders } from '@/composables/useOrders'
import { useFinance } from '@/composables/useFinance'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { appUser, isAdmin } = useAuth()
const ordersApi = useOrders()
const finance = useFinance()

const orderId = computed(() => route.params.id as string)
const ledger = ref<{ direction: 'debit' | 'credit'; amount: number; memo: string | null; recorded_at: string }[]>([])

const order = computed(() => ordersApi.items.value.find((o) => o.id === orderId.value))

const refresh = async () => {
  if (isAdmin.value || appUser.value?.role !== 'customer') {
    await ordersApi.fetchByStatus(undefined)
  } else {
    await ordersApi.fetchMine()
  }
  await finance.fetchByOrder(orderId.value)
  ledger.value = finance.entries.value
}

onMounted(refresh)

const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' UZS'

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

const canAudit = computed(() =>
  (appUser.value?.role === 'checker' || isAdmin.value) && order.value?.status === 'pending',
)
const canAccount = computed(() =>
  (appUser.value?.role === 'finance' || isAdmin.value) && order.value?.status === 'audited',
)
const canShip = computed(() =>
  (appUser.value?.role === 'warehouse' || isAdmin.value) && order.value?.status === 'accounted',
)
const canCancel = computed(() =>
  (appUser.value?.role === 'customer' || isAdmin.value) && order.value?.status === 'pending',
)

const acting = ref(false)
const doTransition = async (to: 'audited' | 'accounted' | 'shipped' | 'cancelled') => {
  acting.value = true
  try {
    await ordersApi.transition(orderId.value, to)
    await refresh()
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : t('customer.order.statusChangeFail'))
  } finally {
    acting.value = false
  }
}

const total = computed(() =>
  (order.value?.items ?? []).reduce((s, i) => s + Number(i.line_total ?? 0), 0),
)
const totalBoxes = computed(() =>
  (order.value?.items ?? []).reduce((s, i) => s + Number(i.boxes ?? 0), 0),
)
const totalM2 = computed(() =>
  (order.value?.items ?? []).reduce((s, i) => s + Number(i.m2_total ?? 0), 0),
)

const goBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/orders')
}

const statusVariant = (s?: string) => {
  switch (s) {
    case 'pending':   return 'secondary'
    case 'audited':   return 'default'
    case 'accounted': return 'default'
    case 'shipped':   return 'default'
    case 'cancelled': return 'secondary'
    default: return 'secondary'
  }
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
              {{ t('orders.detail.title') }}
            </h1>
            <span v-if="order" class="font-mono text-xs text-muted-foreground">
              {{ order.order_no }}
            </span>
            <Badge v-if="order" :variant="statusVariant(order.status) as any" class="text-[10px]">
              {{ t(`orders.status.${order.status}`) }}
            </Badge>
          </div>
          <p v-if="order" class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            {{ fmtDate(order.created_at) }} · {{ order.items?.length ?? 0 }} 项 · {{ totalBoxes }} ящ.
          </p>
        </div>
      </div>
    </header>

    <!-- 加载/未找到态 -->
    <Card v-if="!ordersApi.fetched.value && !order" class="overflow-hidden">
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        <Loader2 class="inline h-4 w-4 mr-2 animate-spin" />
        加载中…
      </CardContent>
    </Card>
    <Card v-else-if="!order" class="overflow-hidden">
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        {{ t('orders.detail.notFound') }}
      </CardContent>
    </Card>

    <!-- ===================== 主区：单一卡片（多 section） ===================== -->
    <Card v-else class="overflow-hidden">
      <CardContent class="p-0">
        <!-- Section 1：账号信息 -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
              <User class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('orders.detail.account') }}</h2>
          </div>
          <div class="text-sm space-y-1.5">
            <p class="font-medium">{{ order.account?.account_name }}</p>
            <p class="text-muted-foreground text-xs">{{ order.account?.company_name }}</p>
            <div v-if="order.sub_account" class="mt-3 pt-3 border-t border-dashed">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                {{ t('customer.order.orderSubAccount') }}
              </p>
              <p class="font-mono font-semibold">{{ order.sub_account.account_name }}</p>
              <p v-if="order.sub_account.inn && order.sub_account.inn !== '-'" class="text-[11px] text-muted-foreground font-mono mt-0.5">
                INN {{ order.sub_account.inn }}
              </p>
            </div>
          </div>
        </section>

        <!-- Section 2：商品明细 -->
        <section class="px-0 sm:px-0 py-0 border-b">
          <div class="px-5 sm:px-6 py-4 flex items-center gap-2 border-b bg-muted/20">
            <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
              <Box class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('orders.detail.items') }}</h2>
            <Badge variant="secondary" class="ml-auto text-[10px] tabular-nums">
              {{ order.items?.length ?? 0 }}
            </Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ t('orders.colModel') }}</TableHead>
                <TableHead>{{ t('orders.colBoxes') }}</TableHead>
                <TableHead>{{ t('orders.colM2') }}</TableHead>
                <TableHead>{{ t('orders.colUnitPrice') }}</TableHead>
                <TableHead>{{ t('orders.colLineTotal') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="i in order.items" :key="i.id">
                <TableCell>
                  <p class="font-mono text-sm">{{ i.product?.model }}</p>
                  <p class="text-xs text-muted-foreground">{{ i.product?.category }}</p>
                </TableCell>
                <TableCell class="tabular-nums">{{ i.boxes }}</TableCell>
                <TableCell class="tabular-nums">{{ Number(i.m2_total).toFixed(2) }}</TableCell>
                <TableCell>
                  <span v-if="i.unit_price !== null" class="tabular-nums">{{ fmt(Number(i.unit_price)) }}</span>
                  <span v-else class="text-muted-foreground text-xs">—</span>
                </TableCell>
                <TableCell class="font-medium tabular-nums">{{ fmt(Number(i.line_total)) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <!-- 汇总 -->
          <div class="px-5 sm:px-6 py-3 text-sm space-y-1.5 border-t bg-muted/10">
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalBoxes') }}</span>
              <span class="tabular-nums font-medium">{{ totalBoxes }} ящ.</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalM2') }}</span>
              <span class="tabular-nums font-medium">{{ totalM2.toFixed(2) }} м²</span>
            </div>
            <div class="flex justify-between text-base font-semibold pt-2 border-t">
              <span>{{ t('orders.detail.totalAmount') }}</span>
              <span class="tabular-nums">{{ fmt(total) }}</span>
            </div>
          </div>
        </section>

        <!-- Section 3：财务流水（仅员工可见） -->
        <section v-if="appUser?.role !== 'customer' && ledger.length > 0" class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <History class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('orders.detail.ledger') }}</h2>
            <Badge variant="secondary" class="ml-auto text-[10px] tabular-nums">
              {{ ledger.length }}
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{{ t('orders.detail.colDir') }}</TableHead>
                <TableHead>{{ t('orders.detail.colAmount') }}</TableHead>
                <TableHead>{{ t('orders.detail.colMemo') }}</TableHead>
                <TableHead>{{ t('orders.detail.colRecordedAt') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="(l, idx) in ledger" :key="idx">
                <TableCell>
                  <Badge :variant="l.direction === 'credit' ? 'default' : 'secondary'" class="text-[10px]">
                    {{ l.direction === 'credit' ? t('orders.detail.credit') : t('orders.detail.debit') }}
                  </Badge>
                </TableCell>
                <TableCell class="font-medium tabular-nums">{{ fmt(l.amount) }}</TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ l.memo || '—' }}</TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ fmtDate(l.recorded_at) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>

        <!-- Section 4：操作按钮（角色驱动） -->
        <div v-if="canAudit || canAccount || canShip || canCancel" class="px-5 sm:px-6 py-4 flex flex-wrap gap-2 bg-muted/20">
          <Button v-if="canAudit" :disabled="acting" class="shadow-md shadow-primary/20" @click="doTransition('audited')">
            <Loader2 v-if="acting" class="mr-2 h-4 w-4 animate-spin" />
            {{ t('orders.action.audit') }}
          </Button>
          <Button v-if="canAccount" :disabled="acting" @click="doTransition('accounted')" class="shadow-md shadow-primary/20">
            {{ t('orders.action.account') }}
          </Button>
          <Button v-if="canShip" :disabled="acting" @click="doTransition('shipped')" class="shadow-md shadow-primary/20">
            {{ t('orders.action.ship') }}
          </Button>
          <Button v-if="canCancel" variant="outline" :disabled="acting" @click="doTransition('cancelled')">
            {{ t('orders.action.cancel') }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
