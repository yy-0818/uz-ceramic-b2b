<!--
  src/views/finance/FinancePage.vue
  财务：对 audited 订单进行登记（伪资金流），并查看流水
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from '@/lib/i18n'
import { Plus, Loader2, Eye } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
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

import { useOrders, type OrderRow } from '@/composables/useOrders'
import { useFinance } from '@/composables/useFinance'

const { t } = useI18n()
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
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <h1 class="text-lg font-semibold">{{ t('finance.title') }}</h1>
      <Button size="sm" variant="ghost" @click="refresh">
        <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
      </Button>
    </header>

    <p class="text-xs text-muted-foreground">{{ t('finance.hint') }}</p>

    <Card>
      <CardContent class="p-0">
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
              <TableCell>{{ o.account?.account_name }}</TableCell>
              <TableCell class="font-medium">{{ fmt(totalAmount(o)) }}</TableCell>
              <TableCell class="text-right space-x-1">
                <Button size="sm" variant="outline" @click="openDialog(o, 'debit')">
                  <Plus class="h-4 w-4 mr-1" />
                  {{ t('finance.debit') }}
                </Button>
                <Button size="sm" variant="outline" @click="openDialog(o, 'credit')">
                  <Plus class="h-4 w-4 mr-1" />
                  {{ t('finance.credit') }}
                </Button>
                <Button size="sm" @click="onAccountConfirmed(o)">
                  {{ t('finance.confirmAccounted') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="ordersApi.items.value.length === 0">
              {{ t('finance.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen" :title="t('finance.recordTitle')">
      <div v-if="dialogOrder" class="space-y-3">
        <div class="text-sm">
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

        <Button class="w-full" :disabled="dialogAmount <= 0" @click="onRecord">
          {{ t('finance.saveBtn') }}
        </Button>
      </div>
    </Dialog>
  </div>
</template>
