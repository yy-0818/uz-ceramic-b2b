<!--
  src/views/admin/accounts-admin/AssignStockDialog.vue
  分配库存组对话框（单主账号 / 批量两种模式）
  - 单主账号：传 :target + :initial-codes
  - 批量：      :target=null + :apply-count + :initial-codes（用首个选中的主账号作种子）
  父级拿提交结果后调 stockGroups.assignForParent()（单）或循环（批量）
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2, Check } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

import type { Account } from '@/composables/useAccounts'
import type { StockGroup } from '@/composables/useStockGroups'

const props = defineProps<{
  open: boolean
  target: Account | null            // null = 批量模式
  stockGroups: StockGroup[]        // 已加载的全量库存组
  initialCodes: string[]            // 打开时的初始勾选（单 = 该账号已分配；批量 = 首个选中的已分配）
  applyCount: number                // 批量模式：会应用到的账号数
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submit', payload: { codes: string[] }): void
}>()

const selected = ref<string[]>([])
const isEmpty = computed(() => props.stockGroups.length === 0)

watch(
  () => props.open,
  (v) => { if (v) selected.value = [...props.initialCodes] },
  { immediate: true },
)

const skuTouched = computed(() =>
  selected.value.reduce((s, c) =>
    s + (props.stockGroups.find(g => g.code === c)?.sku_count ?? 0), 0,
  ),
)

const isOn = (code: string) => selected.value.includes(code)
const toggle = (code: string) => {
  selected.value = isOn(code)
    ? selected.value.filter(c => c !== code)
    : [...selected.value, code]
}
const selectAll = () => { selected.value = props.stockGroups.map(g => g.code) }
const selectNone = () => { selected.value = [] }
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="target ? `分配库存组：${target.account_name}` : '批量分配库存组'"
    :description="target
      ? '勾选该主账号能看到的库存组（= 库存表 A 列客户组）'
      : `将 ${applyCount} 个主账号绑定到相同库存组`"
  >
    <div v-if="isEmpty" class="text-sm text-muted-foreground">
      还没有库存组 —— 请先在"库存表上传"页面导入库存表
    </div>
    <div v-else class="space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-xs text-muted-foreground">
          已分配: <strong>{{ selected.length }}</strong> / {{ stockGroups.length }}
          <span class="ml-2">触及 SKU 总数: <strong>{{ skuTouched }}</strong></span>
        </p>
        <div class="flex gap-1">
          <Button size="sm" variant="ghost" class="h-7 text-xs" @click="selectAll">全选</Button>
          <Button size="sm" variant="ghost" class="h-7 text-xs" @click="selectNone">清空</Button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 max-h-80 overflow-y-auto border rounded-md p-3">
        <button v-for="g in stockGroups" :key="g.id"
          type="button"
          class="text-sm px-2.5 py-1 rounded-md border transition"
          :class="isOn(g.code)
            ? 'bg-primary text-primary-foreground border-primary'
            : 'hover:bg-muted hover:border-muted-foreground/30'"
          @click="toggle(g.code)">
          <span class="inline-flex items-center gap-1">
            <Check v-if="isOn(g.code)" class="h-3 w-3" />
            {{ g.code }}
            <span class="text-xs opacity-70">·{{ g.sku_count }} SKU</span>
          </span>
        </button>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button @click="emit('submit', { codes: [...selected] })" :disabled="loading">
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          {{ target ? '保存' : `应用到 ${applyCount} 个主账号` }}
        </Button>
      </div>
    </div>
  </Dialog>
</template>