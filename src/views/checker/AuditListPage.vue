<!--
  src/views/checker/AuditListPage.vue
  开单员：审核待处理订单（改价 / 改量 / 通过）
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Loader2, Check, Pencil } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableEmpty from '@/components/ui/TableEmpty.vue'

import { useOrders, type OrderRow, type OrderItemRow } from '@/composables/useOrders'

const { t } = useI18n()
const router = useRouter()
const ordersApi = useOrders()

const refresh = async () => {
  await ordersApi.fetchByStatus('pending')
}

onMounted(refresh)

const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' UZS'

const fmtDate = (s: string) => new Date(s).toLocaleString()

/** 展开行的状态 */
const expanded = ref<Set<string>>(new Set())
const toggle = (id: string) => {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

const editingPrice = ref<Record<string, number>>({})
const editingBoxes = ref<Record<string, number>>({})

const onSavePrice = async (item: OrderItemRow) => {
  const v = editingPrice.value[item.id]
  if (v === undefined || Number.isNaN(v)) return
  await ordersApi.updateItemPrice(item.id, Number(v))
  await refresh()
}

const onSaveBoxes = async (item: OrderItemRow) => {
  const v = editingBoxes.value[item.id]
  if (v === undefined || v <= 0) return
  await ordersApi.updateItemBoxes(item.id, Number(v))
  await refresh()
}

const onAudit = async (o: OrderRow) => {
  // 简化：所有明细必须都有单价才能审核
  if ((o.items ?? []).some((i) => i.unit_price === null || Number(i.unit_price) <= 0)) {
    alert(t('audit.priceRequired'))
    return
  }
  await ordersApi.transition(o.id, 'audited')
  await refresh()
}

const totalAmount = (o: OrderRow) =>
  (o.items ?? []).reduce((s, i) => s + Number(i.line_total ?? 0), 0)
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center justify-between">
      <h1 class="text-lg font-semibold">{{ t('audit.title') }}</h1>
      <Button size="sm" variant="ghost" @click="refresh">
        <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
      </Button>
    </header>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('orders.colNo') }}</TableHead>
              <TableHead>{{ t('orders.colAccount') }}</TableHead>
              <TableHead>{{ t('orders.colDate') }}</TableHead>
              <TableHead>{{ t('orders.colItems') }}</TableHead>
              <TableHead>{{ t('orders.colTotal') }}</TableHead>
              <TableHead class="text-right">{{ t('orders.colAction') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-for="o in ordersApi.items.value" :key="o.id">
              <TableRow>
                <TableCell class="font-mono text-sm">{{ o.order_no }}</TableCell>
                <TableCell>{{ o.account?.account_name }}</TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ fmtDate(o.created_at) }}</TableCell>
                <TableCell>{{ o.items?.length ?? 0 }}</TableCell>
                <TableCell class="font-medium">{{ fmt(totalAmount(o)) }}</TableCell>
                <TableCell class="text-right space-x-1">
                  <Button size="sm" variant="ghost" @click="toggle(o.id)">
                    <Pencil class="h-4 w-4" />
                  </Button>
                  <Button size="sm" @click="onAudit(o)">
                    <Check class="h-4 w-4 mr-1" />
                    {{ t('audit.pass') }}
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="expanded.has(o.id)">
                <TableCell colspan="6" class="bg-muted/30 p-0">
                  <div class="p-4">
                    <p class="text-xs font-medium mb-2">{{ t('audit.editItems') }}</p>
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
                        <TableRow v-for="i in o.items" :key="i.id">
                          <TableCell class="font-mono text-sm">{{ i.product?.model }}</TableCell>
                          <TableCell>
                            <div class="flex items-center gap-1">
                              <Input
                                type="number"
                                :model-value="editingBoxes[i.id] ?? i.boxes"
                                @update:modelValue="(v) => editingBoxes[i.id] = Number(v)"
                                class="h-8 w-20"
                              />
                              <Button size="sm" variant="ghost" @click="onSaveBoxes(i)">
                                <Pencil class="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>{{ Number(i.m2_total).toFixed(2) }}</TableCell>
                          <TableCell>
                            <div class="flex items-center gap-1">
                              <Input
                                type="number"
                                :model-value="editingPrice[i.id] ?? i.unit_price ?? ''"
                                @update:modelValue="(v) => editingPrice[i.id] = Number(v)"
                                class="h-8 w-28"
                              />
                              <Button size="sm" variant="ghost" @click="onSavePrice(i)">
                                <Pencil class="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell class="font-medium">{{ fmt(Number(i.line_total || 0)) }}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </TableCell>
              </TableRow>
            </template>
            <TableEmpty v-if="ordersApi.items.value.length === 0">
              {{ t('audit.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
