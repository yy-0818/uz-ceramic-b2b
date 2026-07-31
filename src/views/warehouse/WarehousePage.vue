<!--
  src/views/warehouse/WarehousePage.vue
  仓库：对 accounted 订单进行发货（点击后状态机转移至 shipped，触发器自动扣减库存）
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { Loader2, Truck, Package, ArrowLeft } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableEmpty from '@/components/ui/TableEmpty.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

import { useOrders, type OrderRow } from '@/composables/useOrders'

const { t } = useI18n()
const router = useRouter()
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
    alert(e instanceof Error ? e.message : t('warehouse.shipFail'))
  } finally {
    const s2 = new Set(acting.value)
    s2.delete(o.id); acting.value = s2
  }
}

const totalM2 = (o: OrderRow) =>
  (o.items ?? []).reduce((s, i) => s + Number(i.m2_total ?? 0), 0)

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
              {{ t('warehouse.title') }}
            </h1>
            <span class="text-[10px] font-semibold tracking-wider text-primary uppercase">
              Warehouse
            </span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            {{ t('warehouse.hint') }}
          </p>
        </div>
        <Button size="sm" variant="outline" class="shrink-0" :disabled="ordersApi.loading.value" @click="refresh">
          <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
          <Truck v-else class="h-4 w-4" />
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
            <Truck class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">待发货订单</p>
            <p class="text-[11px] text-muted-foreground leading-snug">
              点击"发货"后状态机转移至 shipped，触发器自动扣减库存
            </p>
          </div>
        </div>

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
              <TableCell class="tabular-nums">{{ o.items?.length ?? 0 }}</TableCell>
              <TableCell class="tabular-nums">{{ totalM2(o).toFixed(2) }} м²</TableCell>
              <TableCell class="text-right">
                <Button
                  size="sm"
                  :disabled="acting.has(o.id)"
                  class="shadow-md shadow-primary/20"
                  @click="onShip(o)"
                >
                  <Loader2 v-if="acting.has(o.id)" class="h-4 w-4 mr-1 animate-spin" />
                  <Package v-else class="h-4 w-4 mr-1" />
                  {{ t('warehouse.shipBtn') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="ordersApi.loading.value && ordersApi.items.value.length === 0">
              <div class="space-y-2 py-2">
                <div v-for="i in 5" :key="i" class="flex items-center gap-3">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-28" />
                  <Skeleton class="h-3 w-16" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-8 w-20 rounded-md" />
                </div>
              </div>
            </TableEmpty>
            <TableEmpty v-else-if="ordersApi.items.value.length === 0">
              {{ t('warehouse.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
