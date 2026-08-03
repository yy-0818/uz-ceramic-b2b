<!--
  ChatOrderCard —— 关联订单卡片消息
  Phase 7: 实时状态 — 订阅 orders 表 realtime, 显示订单最新状态.
-->
<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Package, ArrowUpRight } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useOrderStatusCache } from '@/composables/useOrderStatusCache'

const { t } = useI18n()
const router = useRouter()
const cache = useOrderStatusCache()

const props = defineProps<{
  order_no: string
  status?: string
  item_count?: number
  total_boxes?: number
  total_amount?: number
  updated_at?: string
  order_id: string
}>()

const liveStatus = ref(props.status ?? '')
const liveTotal = ref<number>(props.total_amount ?? 0)
const liveNo = ref(props.order_no ?? '—')

watch(() => props.order_id, (id) => {
  liveStatus.value = cache.getStatus(id, props.status ?? '')
  liveTotal.value = cache.getTotal(id, props.total_amount ?? 0)
  liveNo.value = cache.getStatus(id, props.order_no ?? '—') // default order_no
  const cached = (cache as any)._cache?.get?.(id)
  if (cached) {
    liveStatus.value = cached.status
    liveTotal.value = cached.total_amount
    liveNo.value = cached.order_no
  }
}, { immediate: true })

onMounted(() => {
  cache.subscribe(props.order_id, (e) => {
    liveStatus.value = e.status
    liveTotal.value = e.total_amount
    liveNo.value = e.order_no
  })
  // 老消息没有 status → 拉一次
  if (!props.status || !props.order_no) {
    cache.hydrate([props.order_id])
  }
})

const statusLabel = computed(() => {
  const s = liveStatus.value
  if (!s) return ''
  return t(`orders.status.${s}`, { defaultValue: s })
})

const onOpen = () => {
  router.push(`/orders/${props.order_id}`)
}
</script>

<template>
  <button
    type="button"
    class="max-w-[78%] sm:max-w-[68%] text-left bg-card border rounded-xl px-3 py-2.5 shadow-sm hover:border-primary/50 hover:shadow-md transition"
    @click="onOpen"
  >
    <div class="flex items-center gap-2 mb-1">
      <span class="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <Package class="h-3.5 w-3.5" />
      </span>
      <span class="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
        {{ t('chat.orderBadge') }}
      </span>
      <span
        class="ml-auto text-[10px] px-1.5 py-0.5 rounded-md transition-colors"
        :class="{
          'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300': liveStatus === 'pending',
          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300': liveStatus === 'audited',
          'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300': liveStatus === 'accounted',
          'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300': liveStatus === 'shipped',
          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300': liveStatus === 'cancelled',
          'bg-muted text-foreground': !['pending','audited','accounted','shipped','cancelled'].includes(liveStatus ?? ''),
        }"
      >
        {{ statusLabel }}
      </span>
    </div>
    <div class="flex items-baseline gap-2">
      <span class="font-mono font-semibold text-sm">{{ liveNo }}</span>
      <ArrowUpRight class="h-3.5 w-3.5 text-muted-foreground" />
    </div>
    <div class="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
      <span>{{ item_count ?? 0 }} 项</span>
      <span v-if="total_boxes">{{ total_boxes }} ящ.</span>
      <span v-if="liveTotal">
        {{ Number(liveTotal).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) }} UZS
      </span>
    </div>
    <p class="mt-1.5 text-[10px] text-primary font-medium">
      {{ t('chat.viewOrder') }}
    </p>
  </button>
</template>