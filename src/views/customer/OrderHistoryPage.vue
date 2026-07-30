<!--
  src/views/customer/OrderHistoryPage.vue
  客户订单历史
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import { Eye, Loader2 } from 'lucide-vue-next'

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
import TableEmpty from '@/components/ui/TableEmpty.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

import { useOrders } from '@/composables/useOrders'

const { t } = useI18n()
const router = useRouter()
const ordersApi = useOrders()
const statusFilter = ref<'all' | 'pending' | 'audited' | 'accounted' | 'shipped' | 'cancelled'>('all')

const refresh = async () => {
  if (statusFilter.value === 'all') await ordersApi.fetchMine()
  else await ordersApi.fetchByStatus(statusFilter.value)
}

onMounted(refresh)

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

const statusVariant = (s: string) => {
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
    <header class="flex items-center justify-between">
      <h1 class="text-lg font-semibold">{{ t('orders.title') }}</h1>
      <Button size="sm" variant="ghost" @click="refresh">
        <Loader2 v-if="ordersApi.loading.value" class="h-4 w-4 animate-spin" />
      </Button>
    </header>

    <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
      <Button
        v-for="s in (['all','pending','audited','accounted','shipped','cancelled'] as const)"
        :key="s"
        size="sm"
        :variant="statusFilter === s ? 'default' : 'outline'"
        class="shrink-0"
        @click="statusFilter = s; refresh()"
      >
        {{ t(`orders.status.${s}`) }}
      </Button>
    </div>

    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('orders.colNo') }}</TableHead>
              <TableHead>{{ t('orders.colDate') }}</TableHead>
              <TableHead>子账户</TableHead>
              <TableHead>{{ t('orders.colItems') }}</TableHead>
              <TableHead>{{ t('orders.colM2') }}</TableHead>
              <TableHead>{{ t('orders.colStatus') }}</TableHead>
              <TableHead class="text-right">{{ t('orders.colAction') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="o in ordersApi.items.value" :key="o.id">
              <TableCell class="font-mono text-sm">{{ o.order_no }}</TableCell>
              <TableCell class="text-xs text-muted-foreground">{{ fmtDate(o.created_at) }}</TableCell>
              <TableCell>
                <span v-if="o.sub_account" class="font-mono text-xs">{{ o.sub_account.account_name }}</span>
                <span v-else class="text-xs text-muted-foreground italic">—</span>
              </TableCell>
              <TableCell>{{ o.items?.length ?? 0 }}</TableCell>
              <TableCell>
                {{ (o.items ?? []).reduce((s, i) => s + Number(i.m2_total ?? 0), 0).toFixed(2) }} м²
              </TableCell>
              <TableCell>
                <Badge :variant="statusVariant(o.status) as any">
                  {{ t(`orders.status.${o.status}`) }}
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="ghost" @click="router.push(`/orders/${o.id}`)">
                  <Eye class="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="!ordersApi.fetched.value && ordersApi.items.value.length === 0">
              <div class="space-y-2 py-2">
                <div v-for="i in 5" :key="i" class="flex items-center gap-3">
                  <Skeleton class="h-4 w-24" />
                  <Skeleton class="h-3 w-28" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-3 w-16" />
                  <Skeleton class="h-3 w-20" />
                  <Skeleton class="h-6 w-16 rounded-full" />
                </div>
              </div>
            </TableEmpty>
            <TableEmpty v-else-if="ordersApi.items.value.length === 0">
              {{ t('orders.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
