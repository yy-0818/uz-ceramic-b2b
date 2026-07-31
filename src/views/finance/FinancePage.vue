<!--
  src/views/finance/FinancePage.vue
  财务：对 audited 订单进行登记（伪资金流），并查看流水
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { Plus, Loader2, ArrowLeft, Receipt } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Badge from '@/components/ui/Badge.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableEmpty from '@/components/ui/TableEmpty.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

import { useOrders, type OrderRow } from '@/composables/useOrders'
import { useFinance } from '@/composables/useFinance'

const { t } = useI18n()
const router = useRouter()
const ordersApi = useOrders()
const finance = useFinance()

const initials = ref<Record<string, 'debit' | 'credit'>>({})
const dialogOpen = ref(false)
const dialogOrder = ref<OrderRow | null>(null)
const dialogAmount = ref(0)
const dialogDirection = ref<'debit' | 'credit'>('debit')
const dialogMemo = ref('')

const refresh = async () => {
  await ordersApi.fetchByStatus('audited')
}

onMounted(refresh)

const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' UZS'

const totalAmount = (o: OrderRow) =>
  (o.items ?? []).reduce((s, i) => s + Number(i.line_total ?? 0), 0)

const openDialog = (o: OrderRow, dir: 'debit' | 'credit') => {
  dialogOrder.value = o
  dialogDirection.value = dir
  dialogAmount.value = totalAmount(o)
  dialogMemo.value = dir === 'debit' ? t('finance.debitMemo') : t('finance.creditMemo')
  dialogOpen.value = true
}

const onRecord = async () => {
  if (!dialogOrder.value || dialogAmount.value <= 0) return
  await finance.record({
    order_id: dialogOrder.value.id,
    account_id: dialogOrder.value.account_id,
    direction: dialogDirection.value,
    amount: dialogAmount.value,
    memo: dialogMemo.value || null,
  })
  dialogOpen.value = false
}

const onAccountConfirmed = async (o: OrderRow) => {
  await ordersApi.transition(o.id, 'accounted')
  await refresh()
}

const goBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/')
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
              {{ t('finance.title') }}
            </h1>
            <Badge v-if="ordersApi.items.value.length > 0" variant="secondary" class="text-[10px] tabular-nums">
              {{ ordersApi.items.value.length }} 待记账
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            {{ t('finance.hint') }}
          </p>
        </div>
        <Button size="sm" variant="outline" class="shrink-0" :disabled="ordersApi.loading.value" @click="refresh">
          <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
          <Receipt v-else class="h-4 w-4" />
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
            <Receipt class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">待记账订单</p>
            <p class="text-[11px] text-muted-foreground leading-snug">
              登记收支明细，确认无误后点"确认记账"转移至仓库
            </p>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('orders.colNo') }}</TableHead>
              <TableHead>{{ t('orders.colAccount') }}</TableHead>
              <TableHead>{{ t('orders.colTotal') }}</TableHead>
              <TableHead class="text-right">{{ t('orders.colAction') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="o in ordersApi.items.value" :key="o.id">
              <TableCell class="font-mono text-sm">{{ o.order_no }}</TableCell>
              <TableCell class="text-sm">{{ o.account?.account_name }}</TableCell>
              <TableCell class="font-medium tabular-nums">{{ fmt(totalAmount(o)) }}</TableCell>
              <TableCell class="text-right space-x-1">
                <Button size="sm" variant="outline" @click="openDialog(o, 'debit')">
                  <Plus class="h-3.5 w-3.5 mr-1" />
                  {{ t('finance.debit') }}
                </Button>
                <Button size="sm" variant="outline" @click="openDialog(o, 'credit')">
                  <Plus class="h-3.5 w-3.5 mr-1" />
                  {{ t('finance.credit') }}
                </Button>
                <Button size="sm" class="shadow-md shadow-primary/20" @click="onAccountConfirmed(o)">
                  {{ t('finance.confirmAccounted') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="ordersApi.loading.value && ordersApi.items.value.length === 0">
              <div class="space-y-2 py-2">
                <div v-for="i in 5" :key="i" class="flex items-center gap-3">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-32" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-8 w-16 rounded-md" />
                  <Skeleton class="h-8 w-16 rounded-md" />
                  <Skeleton class="h-8 w-20 rounded-md" />
                </div>
              </div>
            </TableEmpty>
            <TableEmpty v-else-if="ordersApi.items.value.length === 0">
              {{ t('finance.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen" :title="t('finance.recordTitle')">
      <div v-if="dialogOrder" class="space-y-3">
        <div class="text-sm space-y-1">
          <p class="text-muted-foreground">{{ t('orders.colNo') }}: <span class="font-mono">{{ dialogOrder.order_no }}</span></p>
          <p class="text-muted-foreground">{{ t('orders.colAccount') }}: {{ dialogOrder.account?.account_name }}</p>
        </div>

        <div class="space-y-2">
          <Label>{{ t('finance.direction') }}</Label>
          <div class="flex gap-2">
            <Button
              size="sm"
              :variant="dialogDirection === 'debit' ? 'default' : 'outline'"
              @click="dialogDirection = 'debit'"
            >{{ t('finance.debit') }}</Button>
            <Button
              size="sm"
              :variant="dialogDirection === 'credit' ? 'default' : 'outline'"
              @click="dialogDirection = 'credit'"
            >{{ t('finance.credit') }}</Button>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="amount">{{ t('finance.amount') }}</Label>
          <Input
            id="amount"
            type="number"
            v-model="dialogAmount"
            class="h-10"
          />
        </div>

        <div class="space-y-2">
          <Label for="memo">{{ t('finance.memo') }}</Label>
          <Input id="memo" v-model="dialogMemo" />
        </div>

        <Button class="w-full shadow-md shadow-primary/20" :disabled="dialogAmount <= 0" @click="onRecord">
          {{ t('finance.saveBtn') }}
        </Button>
      </div>
    </Dialog>
  </div>
</template>
