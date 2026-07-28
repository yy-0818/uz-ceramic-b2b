<!--
  src/views/admin/ProductImportPage.vue
  后台：CSV 库存导入向导（色号 + 客户组映射版）
  步骤：
    1. 上传 CSV        → ImportUploadCard
    2. 预览（两层归纳）  → ImportPreviewCard（aggregate() 从 useCategoryAggregate）
    3. 选择策略 + 一键写入 products / stock_colors / account_products
  清空旧数据 → ClearAllPanel；未映射客户组 → UnmappedGroupsDialog
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CheckCircle2, AlertTriangle } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import { useI18n } from '@/lib/i18n'

import { useInventoryCsv } from '@/composables/useInventoryCsv'
import { useProducts } from '@/composables/useProducts'
import { useCustomerGroupMappings } from '@/composables/useCustomerGroupMappings'
import { aggregate, type CategoryAgg } from '@/composables/useCategoryAggregate'
import { supabase } from '@/lib/supabase'

import ClearAllPanel from './product-import/ClearAllPanel.vue'
import ImportUploadCard from './product-import/ImportUploadCard.vue'
import ImportPreviewCard from './product-import/ImportPreviewCard.vue'
import UnmappedGroupsDialog from './product-import/UnmappedGroupsDialog.vue'

const { t } = useI18n()
const router = useRouter()

const csv = useInventoryCsv()
const products = useProducts()
const mappings = useCustomerGroupMappings()

const search = ref('')
const strategy = ref<'upsert' | 'skip_existing'>('upsert')
const importing = ref(false)
const importResult = ref<{
  products: number
  colors: number
  whiteRows: number
  dbReadback?: { products: number; colors: number; boxesL1: number; boxesL2: number }
} | null>(null)
const importError = ref<string | null>(null)

const expanded = ref<Record<string, boolean>>({})
const unmappedDialogOpen = ref(false)

const involvedAccountIds = ref<string[]>([])

// ===== 清空旧数据 =====
const clearing = ref(false)
const clearResult = ref<{ products: number; colors: number; whiteRows: number } | null>(null)
const clearError = ref<string | null>(null)
const clearPanelRef = ref<InstanceType<typeof ClearAllPanel> | null>(null)

const onClearAll = async () => {
  clearing.value = true
  clearError.value = null
  clearResult.value = null
  try {
    clearResult.value = await products.clearAll()
    clearPanelRef.value?.reset()
  } catch (e) {
    clearError.value = e instanceof Error ? e.message : String(e)
  } finally {
    clearing.value = false
  }
}

// ===== 上传 =====
const onFilePicked = async (file: File) => {
  const existing = await products.fetchAll()
  const set = new Set(existing.map((p) => p.model))
  await csv.parseFile(file, set)
  await mappings.fetchAll()
  await refreshAccountIds()
  const first = csv.products.value[0]
  if (first) expanded.value[first.category] = true
}

// ===== 搜索过滤 =====
const filteredProducts = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return csv.products.value
  return csv.products.value.filter((p) =>
    p.model.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    p.customerGroups.some((g) => g.toLowerCase().includes(q)) ||
    p.colors.some((c) => c.colorCode.toLowerCase().includes(q)),
  )
})

// ===== 未映射客户组 =====
const unmappedGroups = computed(() => {
  const mapped = new Set(mappings.items.value.map((m) => m.customer_group))
  const all = new Set<string>()
  csv.products.value.forEach((p) => p.customerGroups.forEach((g) => all.add(g)))
  return Array.from(all).filter((g) => !mapped.has(g)).sort()
})

const refreshAccountIds = async () => {
  const allGroups = new Set<string>()
  csv.products.value.forEach((p) => p.customerGroups.forEach((g) => allGroups.add(g)))
  involvedAccountIds.value = await mappings.resolveAccountIds(Array.from(allGroups))
}

// ===== 全局统计 =====
const totalColors = computed(() => csv.products.value.reduce((s, p) => s + p.colors.length, 0))
const totalBoxesL1 = computed(() => csv.products.value.reduce((s, p) => s + p.totalLevel1, 0))
const totalBoxesL2 = computed(() => csv.products.value.reduce((s, p) => s + p.totalLevel2, 0))

// ===== 两层归纳 =====
const aggregatedCategories = computed<CategoryAgg[]>(() => aggregate(filteredProducts.value))

const toggleCategory = (cat: string) => {
  expanded.value[cat] = !expanded.value[cat]
}

// ===== 导入 =====
const onImport = async () => {
  if (csv.products.value.length === 0) return
  importing.value = true
  importError.value = null
  try {
    const toImport = csv.products.value
      .filter((p) => strategy.value === 'upsert' || !p.existsInDb)
      .map((p) => ({
        model: p.model,
        category: p.category,
        conversionRate: p.conversionRate,
        remark: p.remark || null,
        totalLevel1: p.totalLevel1,
        totalLevel2: p.totalLevel2,
        colors: p.colors,
        stockGroup: p.customerGroups[0] ?? null,
      }))
    const accountIds = involvedAccountIds.value
    const result = await products.bulkImportWithColors(toImport, accountIds)

    const [pCnt, cData, l1Agg, l2Agg] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('stock_colors').select('*', { count: 'exact', head: true }),
      supabase.from('stock_colors').select('boxes').eq('stock_level', 1),
      supabase.from('stock_colors').select('boxes').eq('stock_level', 2),
    ])
    const sumFn = (rows: { boxes: number }[] | null) =>
      (rows ?? []).reduce((s, r) => s + (r.boxes ?? 0), 0)
    importResult.value = {
      ...result,
      dbReadback: {
        products: pCnt.count ?? 0,
        colors: cData.count ?? 0,
        boxesL1: sumFn(l1Agg.data as { boxes: number }[] | null),
        boxesL2: sumFn(l2Agg.data as { boxes: number }[] | null),
      },
    }
    csv.markExists(toImport.map((r) => r.model))
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e)
    console.error('[import] failed:', e)
  } finally {
    importing.value = false
  }
}

const goAssign = () => router.push('/admin/assign')
</script>

<template>
  <div class="space-y-4">
    <!-- 清空旧数据 -->
    <ClearAllPanel
      ref="clearPanelRef"
      :clearing="clearing"
      :result="clearResult"
      :error="clearError"
      @execute="onClearAll"
    />

    <!-- 步骤 1：上传 -->
    <ImportUploadCard
      :csv="csv"
      :total-colors="totalColors"
      :total-l1="totalBoxesL1"
      :total-l2="totalBoxesL2"
      :unmapped-count="unmappedGroups.length"
      @pick-file="onFilePicked"
    />

    <!-- 步骤 2：预览 -->
    <ImportPreviewCard
      v-if="csv.products.value.length > 0"
      :categories="aggregatedCategories"
      :expanded="expanded"
      :unmapped-count="unmappedGroups.length"
      :strategy="strategy"
      :importing="importing"
      :search="search"
      :empty="filteredProducts.length === 0"
      @toggle-category="toggleCategory"
      @change-strategy="s => strategy = s"
      @update:search="v => search = v"
      @import="onImport"
      @show-unmapped="unmappedDialogOpen = true"
      @go-assign="goAssign"
    />

    <!-- 未映射客户组 -->
    <UnmappedGroupsDialog
      v-model:open="unmappedDialogOpen"
      :groups="unmappedGroups"
      @go-assign="goAssign"
    />

    <!-- 步骤 3：结果 -->
    <Card v-if="importResult || importError || csv.error.value">
      <CardContent class="py-4 space-y-3">
        <div v-if="importResult"
          class="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <CheckCircle2 class="h-5 w-5 text-emerald-600 mt-0.5" />
          <div class="flex-1">
            <p class="font-medium text-emerald-900">{{ t('admin.import.successTitle') }}</p>
            <p class="text-emerald-800">
              {{ t('admin.import.successBody', {
                n: importResult.products,
                colors: importResult.colors,
                whites: importResult.whiteRows,
              }) }}
            </p>
            <div v-if="importResult.dbReadback" class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-900">
              <div>DB 商品数：<strong>{{ importResult.dbReadback.products }}</strong></div>
              <div>DB 色号行：<strong>{{ importResult.dbReadback.colors }}</strong></div>
              <div>DB 1级箱数：<strong>{{ importResult.dbReadback.boxesL1.toLocaleString() }}</strong></div>
              <div>DB 2级箱数：<strong>{{ importResult.dbReadback.boxesL2.toLocaleString() }}</strong></div>
            </div>
          </div>
        </div>
        <div v-if="importError"
          class="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <AlertTriangle class="h-5 w-5 text-red-600 mt-0.5" />
          <div>
            <p class="font-medium text-red-900">导入失败</p>
            <p class="text-red-800 font-mono text-xs">{{ importError }}</p>
          </div>
        </div>
        <div v-if="csv.error.value"
          class="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <AlertTriangle class="h-5 w-5 text-red-600 mt-0.5" />
          <p class="text-red-800">{{ csv.error.value }}</p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" @click="goAssign">{{ t('admin.import.goAssign') }}</Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>