<!--
  src/views/customer/OrderPayPage.vue
  下单后跳转的"去支付"页（收据 + 结算指引）

  核心要素：下单子账户（这是客户视角下"谁下的单"，是订单的归属方，
  也是后续结算时的抬头依据——审核员改价、财务记账、仓库发货都对着这个
  sub_account_id 走流程）。

  B2B 陶瓷场景下没有在线支付集成：审核员在后台改价 → 财务记账 →
  客户线下付款 → 仓库发货。所以这个页面不做假二维码 / 假"已支付"按钮
  （那会污染订单状态机）。这里只把订单收据 + 结算指引说清楚。
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Loader2, FileText, Receipt, ArrowRight, User, Box, Wallet, ListOrdered } from 'lucide-vue-next'

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

import { useI18n } from '@/lib/i18n'
import { useOrders, type OrderRow } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ordersApi = useOrders()
const { isAdmin, appUser } = useAuth()

const loading = ref(true)

const orderId = computed(() => route.params.id as string)
// 不依赖 items 单例 — 详情页有自己独立的订单 ref
const order = ref<OrderRow | null>(null)

const refresh = async () => {
  loading.value = true
  try {
    order.value = await ordersApi.fetchById(orderId.value)
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const totalBoxes = computed(() =>
  (order.value?.items ?? []).reduce((s, i) => s + Number(i.boxes ?? 0), 0),
)
const totalM2 = computed(() =>
  (order.value?.items ?? []).reduce((s, i) => s + Number(i.m2_total ?? 0), 0),
)
const totalAmount = computed(() =>
  (order.value?.items ?? []).reduce((s, i) => s + Number(i.line_total ?? 0), 0),
)
const isPricePending = computed(() =>
  (order.value?.items ?? []).some((i) => i.unit_price === null),
)

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' UZS'

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

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
  <div class="space-y-4 pb-4">
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
              {{ t('customer.pay.title') }}
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
    <Card v-if="loading" class="overflow-hidden">
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        <Loader2 class="inline h-4 w-4 mr-2 animate-spin" />
        {{ t('customer.pay.loading') }}
      </CardContent>
    </Card>
    <Card v-else-if="!order" class="overflow-hidden">
      <CardContent class="py-10 text-center text-sm text-muted-foreground space-y-3">
        <p>{{ t('orders.detail.notFound') }}</p>
        <p class="text-xs text-muted-foreground/70">
          订单可能尚未同步、或你无权限查看。
          订单 id: <code class="font-mono text-[11px]">{{ orderId }}</code>
        </p>
        <p
          v-if="ordersApi.error.value"
          class="text-[11px] text-destructive max-w-md mx-auto leading-relaxed"
        >
          {{ ordersApi.error.value }}
        </p>
        <Button size="sm" variant="outline" class="mt-2" @click="router.push('/orders')">
          <ArrowLeft class="mr-1 h-3.5 w-3.5" />
          返回订单列表
        </Button>
      </CardContent>
    </Card>

    <!-- ===================== 主区：单一卡片（多 section） ===================== -->
    <Card v-else class="overflow-hidden">
      <CardContent class="p-0">
        <!-- Section 1：下单子账户（核心卡，highlight） -->
        <section class="px-5 sm:px-6 py-5 border-b bg-gradient-to-br from-primary/[0.04] to-transparent">
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
              <User class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('customer.pay.subAccount') }}</h2>
            <Badge variant="secondary" class="ml-auto text-[10px]">
              <Receipt class="h-3 w-3 mr-0.5" />
              归属方
            </Badge>
          </div>
          <p class="font-mono text-lg font-semibold truncate">
            {{ order.sub_account?.account_name ?? order.account?.account_name ?? '—' }}
          </p>
          <p v-if="order.sub_account?.inn && order.sub_account.inn !== '-'" class="text-sm text-muted-foreground font-mono mt-1">
            INN {{ order.sub_account.inn }}
          </p>
          <p v-else-if="order.account?.company_name" class="text-sm text-muted-foreground mt-1">
            {{ order.account.company_name }}
          </p>
          <p class="text-xs text-muted-foreground pt-2 mt-2 border-t border-dashed">
            {{ t('customer.pay.subAccountHint') }}
          </p>
        </section>

        <!-- Section 2：商品明细 -->
        <section class="border-b">
          <div class="px-5 sm:px-6 py-4 border-b bg-muted/20 flex items-center gap-2">
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
                <TableHead class="text-right">{{ t('orders.colBoxes') }}</TableHead>
                <TableHead class="text-right">{{ t('orders.colM2') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="i in order.items" :key="i.id">
                <TableCell>
                  <p class="font-mono text-sm">{{ i.product?.model }}</p>
                  <p class="text-xs text-muted-foreground">{{ i.product?.category }}</p>
                </TableCell>
                <TableCell class="text-right font-mono tabular-nums">{{ i.boxes }}</TableCell>
                <TableCell class="text-right font-mono tabular-nums">{{ Number(i.m2_total).toFixed(2) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div class="px-5 sm:px-6 py-3 text-sm space-y-1.5 border-t bg-muted/10">
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalBoxes') }}</span>
              <span class="font-mono tabular-nums font-medium">{{ totalBoxes }} ящ.</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalM2') }}</span>
              <span class="font-mono tabular-nums font-medium">{{ totalM2.toFixed(2) }} м²</span>
            </div>
          </div>
        </section>

        <!-- Section 3：金额 / 报价状态 -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span
              class="h-5 w-5 rounded-full flex items-center justify-center"
              :class="isPricePending ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'"
            >
              <Wallet class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('orders.detail.totalAmount') }}</h2>
          </div>
          <div v-if="isPricePending" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <p class="text-amber-900 font-medium">{{ t('customer.pay.amountPending') }}</p>
            <p class="text-amber-800 text-xs mt-1 leading-relaxed">{{ t('customer.pay.amountPendingHint') }}</p>
          </div>
          <p v-else class="font-mono text-2xl font-bold tabular-nums">{{ fmtMoney(totalAmount) }}</p>
        </section>

        <!-- Section 4：备注 -->
        <section v-if="order.remark" class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-2">
            <span class="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <ListOrdered class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('orders.detail.remark') }}</h2>
          </div>
          <p class="text-sm whitespace-pre-wrap text-muted-foreground">{{ order.remark }}</p>
        </section>

        <!-- Section 5：结算指引（B2B 无在线支付） -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <FileText class="h-3 w-3" />
            </span>
            <h2 class="text-sm font-semibold text-foreground">{{ t('customer.pay.stepsTitle') }}</h2>
          </div>
          <ol class="space-y-2 text-sm text-muted-foreground list-decimal pl-4 leading-relaxed">
            <li>{{ t('customer.pay.step1') }}</li>
            <li>{{ t('customer.pay.step2') }}</li>
            <li>{{ t('customer.pay.step3') }}</li>
          </ol>
        </section>

        <!-- 底部动作 -->
        <div class="px-5 sm:px-6 py-4 flex flex-col gap-2 bg-muted/20">
          <Button class="w-full h-11 shadow-md shadow-primary/20" @click="router.push(`/orders/${order.id}`)">
            <ArrowRight class="mr-2 h-4 w-4" />
            {{ t('customer.pay.btnDetail') }}
          </Button>
          <Button variant="outline" class="w-full h-11" @click="router.push('/orders')">
            {{ t('customer.pay.btnBackList') }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>