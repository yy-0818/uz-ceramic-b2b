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
import { ArrowLeft, Loader2, FileText, Receipt, ArrowRight } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Badge from '@/components/ui/Badge.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'

import { useI18n } from '@/lib/i18n'
import { useOrders } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ordersApi = useOrders()
const { isAdmin, appUser } = useAuth()

const loading = ref(true)

const orderId = computed(() => route.params.id as string)
const order = computed(() => ordersApi.items.value.find((o) => o.id === orderId.value))

const refresh = async () => {
  loading.value = true
  try {
    // 客户拉自己的；员工角色可看全部。这里复用 fetchByStatus 不带过滤参数。
    if (appUser.value?.role === 'customer' && !isAdmin.value) {
      await ordersApi.fetchMine()
    } else {
      await ordersApi.fetchByStatus(undefined)
    }
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
// unit_price 任一行为 null 即视为待报价
const isPricePending = computed(() =>
  (order.value?.items ?? []).some((i) => i.unit_price === null),
)

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' UZS'

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')
</script>

<template>
  <div class="space-y-4 pb-20">
    <header class="flex items-center gap-2">
      <Button size="icon" variant="ghost" @click="router.back()">
        <ArrowLeft class="h-5 w-5" />
      </Button>
      <h1 class="text-lg font-semibold">
        {{ t('customer.pay.title') }}
      </h1>
    </header>

    <!-- 加载态 -->
    <Card v-if="loading">
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        <Loader2 class="inline h-4 w-4 mr-2 animate-spin" />
        {{ t('customer.pay.loading') }}
      </CardContent>
    </Card>

    <Card v-else-if="!order">
      <CardContent class="py-10 text-center text-sm text-muted-foreground space-y-3">
        <p>{{ t('orders.detail.notFound') }}</p>
        <p class="text-xs text-muted-foreground/70">
          订单可能尚未同步、或你无权限查看。
          订单 id: <code class="font-mono text-[11px]">{{ orderId }}</code>
        </p>
        <Button size="sm" variant="outline" class="mt-2" @click="router.push('/customer/orders')">
          ← 返回订单列表
        </Button>
      </CardContent>
    </Card>

    <template v-else>
      <!-- 顶部：单号 + 状态 -->
      <Card>
        <CardContent class="py-4 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ t('orders.detail.title') }}</p>
            <p class="font-mono text-base font-semibold truncate">{{ order.order_no }}</p>
          </div>
          <Badge variant="secondary">{{ t(`orders.status.${order.status}`) }}</Badge>
        </CardContent>
      </Card>

      <!--
        ★ 核心卡片：下单子账户
        醒目位置 + 大字号 + 主联系人星标 + INN。
        客户看一眼就知道"这单挂在哪个子账号名下"——是后续改价/记账/发货流程的归属方。
      -->
      <Card class="border-primary/30 bg-primary/5">
        <CardHeader class="pb-2">
          <CardTitle class="flex items-center gap-2 text-base">
            <Receipt class="h-4 w-4 text-primary" />
            {{ t('customer.pay.subAccount') }}
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-1.5">
          <div class="flex items-center gap-2">
            <p class="font-mono text-lg font-semibold truncate">
              {{ order.sub_account?.account_name ?? order.account?.account_name ?? '—' }}
            </p>
          </div>
          <p v-if="order.sub_account?.inn && order.sub_account.inn !== '-'" class="text-sm text-muted-foreground font-mono">
            INN {{ order.sub_account.inn }}
          </p>
          <p v-else-if="order.account?.company_name" class="text-sm text-muted-foreground">
            {{ order.account.company_name }}
          </p>
          <p class="text-xs text-muted-foreground pt-1.5 border-t">
            {{ t('customer.pay.subAccountHint') }}
          </p>
        </CardContent>
      </Card>

      <!-- 商品明细 -->
      <Card>
        <CardHeader>
          <CardTitle>{{ t('orders.detail.items') }}</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
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
                <TableCell class="text-right font-mono">{{ i.boxes }}</TableCell>
                <TableCell class="text-right font-mono">{{ Number(i.m2_total).toFixed(2) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div class="border-t p-4 text-sm space-y-1">
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalBoxes') }}</span>
              <span class="font-mono">{{ totalBoxes }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalM2') }}</span>
              <span class="font-mono">{{ totalM2.toFixed(2) }} м²</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- 金额区：待报价时显示提示，已报价则显示总金额 -->
      <Card>
        <CardContent class="py-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">{{ t('orders.detail.totalAmount') }}</span>
            <span v-if="isPricePending" class="text-sm text-amber-700 font-medium">
              {{ t('customer.pay.amountPending') }}
            </span>
            <span v-else class="font-mono text-lg font-semibold">{{ fmtMoney(totalAmount) }}</span>
          </div>
          <p v-if="isPricePending" class="text-xs text-muted-foreground border-t pt-2">
            {{ t('customer.pay.amountPendingHint') }}
          </p>
        </CardContent>
      </Card>

      <!-- 备注 -->
      <Card v-if="order.remark">
        <CardHeader class="pb-2">
          <CardTitle class="text-base">{{ t('orders.detail.remark') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-sm whitespace-pre-wrap">{{ order.remark }}</p>
        </CardContent>
      </Card>

      <!--
        结算指引卡：B2B 陶瓷无在线支付，这里清楚说明流程，
        避免客户找"支付按钮"。后续若接入支付集成，把这块替换成真二维码 + 支付方式即可。
      -->
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="flex items-center gap-2 text-base">
            <FileText class="h-4 w-4" />
            {{ t('customer.pay.stepsTitle') }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol class="space-y-2 text-sm text-muted-foreground list-decimal pl-4">
            <li>{{ t('customer.pay.step1') }}</li>
            <li>{{ t('customer.pay.step2') }}</li>
            <li>{{ t('customer.pay.step3') }}</li>
          </ol>
        </CardContent>
      </Card>

      <p class="text-xs text-muted-foreground">
        {{ t('customer.pay.createdAt') }}: {{ fmtDate(order.created_at) }}
      </p>

      <!-- 底部动作 -->
      <div class="flex flex-col gap-2 pt-2">
        <Button class="w-full h-11" @click="router.push(`/customer/orders/${order.id}`)">
          <ArrowRight class="mr-2 h-4 w-4" />
          {{ t('customer.pay.btnDetail') }}
        </Button>
        <Button variant="outline" class="w-full h-11" @click="router.push('/customer/orders')">
          {{ t('customer.pay.btnBackList') }}
        </Button>
      </div>
    </template>
  </div>
</template>