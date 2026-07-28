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
import { ArrowLeft, Loader2 } from 'lucide-vue-next'

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
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center gap-2">
      <Button size="icon" variant="ghost" @click="router.back()">
        <ArrowLeft class="h-5 w-5" />
      </Button>
      <h1 class="text-lg font-semibold">
        {{ t('orders.detail.title') }}
        <span class="font-mono text-sm text-muted-foreground">{{ order?.order_no }}</span>
      </h1>
      <Badge v-if="order" class="ml-2">{{ t(`orders.status.${order.status}`) }}</Badge>
    </header>

    <Card v-if="!order">
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        {{ t('orders.detail.notFound') }}
      </CardContent>
    </Card>

    <template v-else>
      <Card>
        <CardHeader>
          <CardTitle>{{ t('orders.detail.account') }}</CardTitle>
        </CardHeader>
        <CardContent class="text-sm space-y-1">
          <p class="font-medium">{{ order.account?.account_name }}</p>
          <p class="text-muted-foreground">{{ order.account?.company_name }}</p>
          <div v-if="order.sub_account" class="mt-2 pt-2 border-t">
            <p class="text-xs text-muted-foreground">{{ t('customer.order.orderSubAccount') }}</p>
            <p class="font-mono">{{ order.sub_account.account_name }}</p>
            <p v-if="order.sub_account.inn && order.sub_account.inn !== '-'" class="text-xs text-muted-foreground">
              INN: {{ order.sub_account.inn }}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ t('orders.detail.items') }}</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
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
                <TableCell>{{ i.boxes }}</TableCell>
                <TableCell>{{ Number(i.m2_total).toFixed(2) }}</TableCell>
                <TableCell>
                  <span v-if="i.unit_price !== null">{{ fmt(Number(i.unit_price)) }}</span>
                  <span v-else class="text-muted-foreground text-xs">—</span>
                </TableCell>
                <TableCell class="font-medium">{{ fmt(Number(i.line_total)) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div class="border-t p-4 text-sm space-y-1">
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalBoxes') }}</span>
              <span>{{ totalBoxes }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('orders.detail.totalM2') }}</span>
              <span>{{ totalM2.toFixed(2) }} м²</span>
            </div>
            <div class="flex justify-between text-base font-semibold pt-1 border-t">
              <span>{{ t('orders.detail.totalAmount') }}</span>
              <span>{{ fmt(total) }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- 财务流水（仅员工可见） -->
      <Card v-if="appUser?.role !== 'customer' && ledger.length > 0">
        <CardHeader>
          <CardTitle>{{ t('orders.detail.ledger') }}</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
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
                  <Badge :variant="l.direction === 'credit' ? 'default' : 'secondary'">
                    {{ l.direction === 'credit' ? t('orders.detail.credit') : t('orders.detail.debit') }}
                  </Badge>
                </TableCell>
                <TableCell class="font-medium">{{ fmt(l.amount) }}</TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ l.memo || '—' }}</TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ fmtDate(l.recorded_at) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- 操作按钮 -->
      <div class="flex flex-wrap gap-2">
        <Button v-if="canAudit" variant="default" :disabled="acting" @click="doTransition('audited')">
          <Loader2 v-if="acting" class="mr-2 h-4 w-4 animate-spin" />
          {{ t('orders.action.audit') }}
        </Button>
        <Button v-if="canAccount" variant="default" :disabled="acting" @click="doTransition('accounted')">
          {{ t('orders.action.account') }}
        </Button>
        <Button v-if="canShip" variant="default" :disabled="acting" @click="doTransition('shipped')">
          {{ t('orders.action.ship') }}
        </Button>
        <Button v-if="canCancel" variant="outline" :disabled="acting" @click="doTransition('cancelled')">
          {{ t('orders.action.cancel') }}
        </Button>
      </div>
    </template>
  </div>
</template>
