<!--
  src/views/warehouse/WarehousePage.vue
  仓库：对 accounted 订单进行发货（点击后状态机转移至 shipped，触发器自动扣减库存）
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Truck, Package } from 'lucide-vue-next'

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

import { useOrders, type OrderRow } from '@/composables/useOrders'

const { t } = useI18n()
const ordersApi = useOrders()

const refresh = async () => {
  await ordersApi.fetchByStatus('accounted')
}
onMounted(refresh)

const acting = ref<Set<string>>(new Set())
const onShip = async (o: OrderRow) => {
  const s = new Set(acting.value)
  s.add(o.id); acting.value = s
  try {
    await ordersApi.transition(o.id, 'shipped')
    await refresh()
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : '发货失败')
  } finally {
    const s2 = new Set(acting.value)
    s2.delete(o.id); acting.value = s2
  }
}

const totalM2 = (o: OrderRow) =>
  (o.items ?? []).reduce((s, i) => s + Number(i.m2_total ?? 0), 0)
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <h1 class="text-lg font-semibold flex items-center gap-2">
        <Truck class="h-5 w-5" />
        {{ t('warehouse.title') }}
      </h1>
      <Button size="sm" variant="ghost" @click="refresh">
        <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
      </Button>
    </header>

    <p class="text-xs text-muted-foreground">{{ t('warehouse.hint') }}</p>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('orders.colNo') }}</TableHead>
              <TableHead>{{ t('orders.colAccount') }}</TableHead>
              <TableHead>{{ t('orders.colItems') }}</TableHead>
              <TableHead>{{ t('orders.colM2') }}</TableHead>
              <TableHead class="text-right">{{ t('orders.colAction') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="o in ordersApi.items.value" :key="o.id">
              <TableCell class="font-mono text-sm">{{ o.order_no }}</TableCell>
              <TableCell>{{ o.account?.account_name }}</TableCell>
              <TableCell>{{ o.items?.length ?? 0 }}</TableCell>
              <TableCell>{{ totalM2(o).toFixed(2) }} м²</TableCell>
              <TableCell class="text-right">
                <Button
                  size="sm"
                  :disabled="acting.has(o.id)"
                  @click="onShip(o)"
                >
                  <Loader2 v-if="acting.has(o.id)" class="h-4 w-4 mr-1 animate-spin" />
                  <Package v-else class="h-4 w-4 mr-1" />
                  {{ t('warehouse.shipBtn') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="ordersApi.items.value.length === 0">
              {{ t('warehouse.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
