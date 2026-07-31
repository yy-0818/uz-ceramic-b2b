<!--
  src/views/checker/AuditListPage.vue
  开单员：审核待处理订单（改价 / 改量 / 通过）
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { Loader2, Check, Pencil, ArrowLeft, ClipboardCheck } from 'lucide-vue-next'

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
import Skeleton from '@/components/ui/Skeleton.vue'

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
  if ((o.items ?? []).some((i) => i.unit_price === null || Number(i.unit_price) <= 0)) {
    alert(t('audit.priceRequired'))
    return
  }
  await ordersApi.transition(o.id, 'audited')
  await refresh()
}

const totalAmount = (o: OrderRow) =>
  (o.items ?? []).reduce((s, i) => s + Number(i.line_total ?? 0), 0)

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
              {{ t('audit.title') }}
            </h1>
            <Badge v-if="ordersApi.items.value.length > 0" variant="secondary" class="text-[10px] tabular-nums">
              {{ ordersApi.items.value.length }} 待审
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            审核待处理订单：展开行可改数量 / 单价，确认无误后点"通过"。
          </p>
        </div>
        <Button size="sm" variant="outline" class="shrink-0" :disabled="ordersApi.loading.value" @click="refresh">
          <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
          <ClipboardCheck v-else class="h-4 w-4" />
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
            <ClipboardCheck class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">待审核订单</p>
            <p class="text-[11px] text-muted-foreground leading-snug">
              展开行 → 改数量/单价 → 点"通过"提交审核
            </p>
          </div>
        </div>

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
                <TableCell class="text-sm">{{ o.account?.account_name }}</TableCell>
                <TableCell class="text-xs text-muted-foreground">{{ fmtDate(o.created_at) }}</TableCell>
                <TableCell class="tabular-nums">{{ o.items?.length ?? 0 }}</TableCell>
                <TableCell class="font-medium tabular-nums">{{ fmt(totalAmount(o)) }}</TableCell>
                <TableCell class="text-right space-x-1">
                  <Button size="sm" variant="outline" @click="toggle(o.id)">
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" class="shadow-md shadow-primary/20" @click="onAudit(o)">
                    <Check class="h-4 w-4 mr-1" />
                    {{ t('audit.pass') }}
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="expanded.has(o.id)">
                <TableCell colspan="6" class="bg-muted/20 p-0">
                  <div class="p-4">
                    <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      {{ t('audit.editItems') }}
                    </p>
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
                          <TableCell>
                            <p class="font-mono text-sm">{{ i.product?.model }}</p>
                            <p class="text-xs text-muted-foreground">{{ i.product?.category }}</p>
                          </TableCell>
                          <TableCell>
                            <div class="flex items-center gap-1.5">
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
                          <TableCell class="tabular-nums">{{ Number(i.m2_total).toFixed(2) }}</TableCell>
                          <TableCell>
                            <div class="flex items-center gap-1.5">
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
                          <TableCell class="font-medium tabular-nums">{{ fmt(Number(i.line_total || 0)) }}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </TableCell>
              </TableRow>
            </template>
            <TableEmpty v-if="ordersApi.loading.value && ordersApi.items.value.length === 0">
              <div class="space-y-2 py-2">
                <div v-for="i in 5" :key="i" class="flex items-center gap-3">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-28" />
                  <Skeleton class="h-3 w-24" />
                  <Skeleton class="h-3 w-16" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-8 w-16 rounded-md" />
                  <Skeleton class="h-8 w-20 rounded-md" />
                </div>
              </div>
            </TableEmpty>
            <TableEmpty v-else-if="ordersApi.items.value.length === 0">
              {{ t('audit.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
