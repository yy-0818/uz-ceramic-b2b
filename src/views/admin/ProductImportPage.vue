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
import {
  Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2,
  ChevronRight, Eye, Database, Sparkles, ArrowLeft,
} from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
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

// ===== 步骤状态 (与 AccountsImportPage 保持一致的视觉语言) =====
//   1: 清空 → 2: 上传 → 3: 预览 → 4: 完成
// phase 从 idle（清空态）到 uploading（解析 CSV）再到 preview（已解析）再到 done（已导入）
const phase = computed<'clear' | 'uploading' | 'preview' | 'done'>(() => {
  if (importing.value) return 'uploading'
  if (csv.products.value.length === 0) return 'clear'
  if (importResult.value) return 'done'
  return 'preview'
})

const stepDone = (n: number) => {
  const p = phase.value
  if (p === 'clear') return false
  if (p === 'uploading') return n <= 1
  if (p === 'preview') return n <= 2
  return true
}

const stepStateClass = (n: number) => {
  if (stepDone(n)) return 'text-emerald-700'
  const active = (
    (phase.value === 'clear' && n === 1) ||
    (phase.value === 'uploading' && n === 2) ||
    (phase.value === 'preview' && n === 3) ||
    (phase.value === 'done' && n === 4)
  )
  return active ? 'text-foreground' : 'text-muted-foreground'
}

const stepCircleClass = (n: number) => {
  if (stepDone(n)) return 'bg-emerald-100 text-emerald-700'
  const active = (
    (phase.value === 'clear' && n === 1) ||
    (phase.value === 'uploading' && n === 2) ||
    (phase.value === 'preview' && n === 3) ||
    (phase.value === 'done' && n === 4)
  )
  if (active) return 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
  return 'border bg-background text-muted-foreground'
}

const stepLineClass = (n: number) => stepDone(n) ? 'bg-emerald-300' : 'bg-border'

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'clear': return '第一步：清空旧数据（可选）/ 上传 CSV 库存文件'
    case 'uploading': return '第二步：正在解析 CSV，请稍候'
    case 'preview': return '第三步：核对两层归纳结果 + 选策略，确认后一键导入'
    case 'done': return '第四步：导入完成，可前往库存分配'
  }
})

const onBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/admin')
}
</script>

<template>
  <div class="space-y-4">
    <!-- ===================== 顶部 hero ===================== -->
    <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4 sm:py-5">
      <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      <div class="pointer-events-none absolute -right-4 top-1/2 h-24 w-24 rounded-full bg-primary/5" />

      <div class="relative flex items-start gap-2">
        <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0 -ml-1" @click="onBack">
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 flex-wrap">
            <h1 class="text-base sm:text-lg font-bold leading-tight">
              商品库存导入
            </h1>
            <span class="text-[10px] font-semibold tracking-wider text-primary uppercase">
              CSV · 批量
            </span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            上传 <span class="font-mono">库存 CSV</span>，
            系统按"色号 + 客户组"两层归纳，确认策略后一键写入
            <span class="font-mono">products / stock_colors / account_products</span>。
          </p>
        </div>
      </div>

      <!-- 步骤条：清空 → 上传 → 预览 → 完成 -->
      <ol class="relative mt-4 grid grid-cols-4 sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-1.5 sm:gap-2 text-[11px]">
        <li class="flex items-center gap-1.5" :class="stepStateClass(1)">
          <span class="h-5 w-5 rounded-full flex items-center justify-center" :class="stepCircleClass(1)">
            <CheckCircle2 v-if="stepDone(1)" class="h-3 w-3" />
            <Database v-else class="h-3 w-3" />
          </span>
          <span class="font-medium hidden sm:inline">清空</span>
        </li>
        <li class="hidden sm:block"><span class="block h-px" :class="stepLineClass(1)" /></li>
        <li class="flex items-center gap-1.5" :class="stepStateClass(2)">
          <span class="h-5 w-5 rounded-full flex items-center justify-center" :class="stepCircleClass(2)">
            <CheckCircle2 v-if="stepDone(2)" class="h-3 w-3" />
            <Upload v-else class="h-3 w-3" />
          </span>
          <span class="font-medium hidden sm:inline">上传</span>
        </li>
        <li class="hidden sm:block"><span class="block h-px" :class="stepLineClass(2)" /></li>
        <li class="flex items-center gap-1.5" :class="stepStateClass(3)">
          <span class="h-5 w-5 rounded-full flex items-center justify-center" :class="stepCircleClass(3)">
            <CheckCircle2 v-if="stepDone(3)" class="h-3 w-3" />
            <span v-else class="text-[10px] font-bold">3</span>
          </span>
          <span class="font-medium hidden sm:inline">预览</span>
        </li>
        <li class="hidden sm:block"><span class="block h-px" :class="stepLineClass(3)" /></li>
        <li class="flex items-center gap-1.5" :class="stepStateClass(4)">
          <span class="h-5 w-5 rounded-full flex items-center justify-center" :class="stepCircleClass(4)">
            <CheckCircle2 v-if="stepDone(4)" class="h-3 w-3" />
            <span v-else class="text-[10px] font-bold">4</span>
          </span>
          <span class="font-medium hidden sm:inline">完成</span>
        </li>
      </ol>
    </header>

    <!-- ===================== 主区：单一卡片（3 个 section） ===================== -->
    <Card class="overflow-hidden">
      <CardContent class="p-0">
        <!-- 顶部 mini header -->
        <div class="px-5 sm:px-6 py-4 border-b bg-muted/20 flex items-center gap-3">
          <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">导入工作流</p>
            <p class="text-[11px] text-muted-foreground leading-snug">{{ phaseLabel }}</p>
          </div>
          <div class="hidden sm:flex items-center gap-3 text-right shrink-0">
            <div v-if="csv.products.value.length > 0">
              <p class="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">商品</p>
              <p class="text-sm font-bold tabular-nums leading-tight mt-0.5">
                {{ csv.products.value.length }}
              </p>
            </div>
            <div v-if="totalColors > 0" class="h-7 w-px bg-border" />
            <div v-if="totalColors > 0">
              <p class="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">色号</p>
              <p class="text-sm font-bold tabular-nums leading-tight mt-0.5">
                {{ totalColors }}
              </p>
            </div>
          </div>
        </div>

        <!-- Section 1：清空旧数据 -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span
              class="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              :class="stepDone(1) ? 'bg-emerald-100 text-emerald-700' : (phase === 'clear' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')"
            >
              <CheckCircle2 v-if="stepDone(1)" class="h-3 w-3" />
              <Database v-else class="h-3 w-3" />
            </span>
            <Database class="h-3.5 w-3.5 text-primary" />
            <h2 class="text-sm font-semibold text-foreground">清空旧数据（可选）</h2>
            <Badge variant="secondary" class="ml-auto text-[10px]">谨慎操作</Badge>
          </div>
          <ClearAllPanel
            ref="clearPanelRef"
            :clearing="clearing"
            :result="clearResult"
            :error="clearError"
            @execute="onClearAll"
          />
        </section>

        <!-- Section 2：上传 CSV -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span
              class="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              :class="stepDone(2) ? 'bg-emerald-100 text-emerald-700' : (phase === 'uploading' ? 'bg-primary text-primary-foreground' : (stepDone(1) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'))"
            >
              <CheckCircle2 v-if="stepDone(2)" class="h-3 w-3" />
              <Upload v-else class="h-3 w-3" />
            </span>
            <Upload class="h-3.5 w-3.5 text-primary" />
            <h2 class="text-sm font-semibold text-foreground">上传 CSV 库存文件</h2>
            <span v-if="unmappedGroups.length > 0" class="ml-auto">
              <Badge class="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                <AlertTriangle class="h-3 w-3 mr-0.5" />
                {{ unmappedGroups.length }} 个未映射客户组
              </Badge>
            </span>
          </div>
          <ImportUploadCard
            :csv="csv"
            :total-colors="totalColors"
            :total-l1="totalBoxesL1"
            :total-l2="totalBoxesL2"
            :unmapped-count="unmappedGroups.length"
            @pick-file="onFilePicked"
          />
        </section>

        <!-- Section 3：预览 + 导入（合并，原 ImportPreviewCard 包含此功能） -->
        <section v-if="csv.products.value.length > 0" class="px-5 sm:px-6 py-5">
          <div class="flex items-center gap-2 mb-3">
            <span
              class="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              :class="stepDone(3) ? 'bg-emerald-100 text-emerald-700' : (phase === 'preview' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')"
            >
              <CheckCircle2 v-if="stepDone(3)" class="h-3 w-3" />
              <Eye v-else-if="phase === 'preview'" class="h-3 w-3" />
              <span v-else class="text-[10px] font-bold">3</span>
            </span>
            <Sparkles class="h-3.5 w-3.5 text-primary" />
            <h2 class="text-sm font-semibold text-foreground">解析预览（两层归纳）</h2>
            <Badge v-if="unmappedGroups.length > 0" class="ml-auto bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
              <AlertTriangle class="h-3 w-3 mr-0.5" />
              {{ unmappedGroups.length }} 未映射
            </Badge>
          </div>
          <ImportPreviewCard
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
        </section>
      </CardContent>
    </Card>

    <!-- 未映射客户组弹窗（独立于主卡片） -->
    <UnmappedGroupsDialog
      v-model:open="unmappedDialogOpen"
      :groups="unmappedGroups"
      @go-assign="goAssign"
    />

    <!-- ===================== Section 4：导入结果 ===================== -->
    <Card v-if="importResult || importError || csv.error.value" class="overflow-hidden">
      <CardContent class="p-0">
        <div class="px-5 sm:px-6 py-4 border-b bg-muted/20 flex items-center gap-3">
          <div
            class="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
            :class="importError || csv.error.value ? 'bg-destructive/10 text-destructive' : 'bg-emerald-100 text-emerald-700'"
          >
            <CheckCircle2 v-if="importResult && !importError && !csv.error.value" class="h-4 w-4" />
            <AlertTriangle v-else class="h-4 w-4" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">
              {{ importError || csv.error.value ? '导入出错' : '导入完成' }}
            </p>
            <p class="text-[11px] text-muted-foreground leading-snug">
              {{
                importError || csv.error.value
                  ? '请查看下方错误并修正后重试'
                  : '已成功写入 products / stock_colors / account_products'
              }}
            </p>
          </div>
        </div>

        <!-- 成功统计 -->
        <div v-if="importResult" class="px-5 sm:px-6 py-5">
          <div class="rounded-lg border bg-gradient-to-br from-emerald-50 to-background p-5 space-y-3">
            <div class="flex items-center gap-2">
              <CheckCircle2 class="h-5 w-5 text-emerald-600" />
              <p class="text-base font-semibold">{{ t('admin.import.successTitle') }}</p>
            </div>
            <p class="text-sm text-emerald-900">
              {{
                t('admin.import.successBody', {
                  n: importResult.products,
                  colors: importResult.colors,
                  whites: importResult.whiteRows,
                })
              }}
            </p>
            <div v-if="importResult.dbReadback" class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <div class="rounded-md border bg-card px-3 py-2">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground">DB 商品数</p>
                <p class="text-lg font-bold tabular-nums mt-0.5">
                  {{ importResult.dbReadback.products }}
                </p>
              </div>
              <div class="rounded-md border bg-card px-3 py-2">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground">DB 色号行</p>
                <p class="text-lg font-bold tabular-nums mt-0.5">
                  {{ importResult.dbReadback.colors }}
                </p>
              </div>
              <div class="rounded-md border bg-card px-3 py-2">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground">DB 1级箱数</p>
                <p class="text-lg font-bold tabular-nums mt-0.5">
                  {{ importResult.dbReadback.boxesL1.toLocaleString() }}
                </p>
              </div>
              <div class="rounded-md border bg-card px-3 py-2">
                <p class="text-[10px] uppercase tracking-wider text-muted-foreground">DB 2级箱数</p>
                <p class="text-lg font-bold tabular-nums mt-0.5">
                  {{ importResult.dbReadback.boxesL2.toLocaleString() }}
                </p>
              </div>
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <Button @click="goAssign" class="shadow-md shadow-primary/20">
                <ChevronRight class="mr-1 h-4 w-4" />
                {{ t('admin.import.goAssign') }}
              </Button>
            </div>
          </div>
        </div>

        <!-- 错误 -->
        <div v-if="importError" class="px-5 sm:px-6 py-3">
          <div class="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 text-destructive rounded-md p-3 text-sm">
            <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
            <div class="flex-1">
              <p class="font-medium">导入失败</p>
              <p class="font-mono text-xs mt-0.5">{{ importError }}</p>
            </div>
          </div>
        </div>

        <div v-if="csv.error.value" class="px-5 sm:px-6 py-3">
          <div class="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 text-destructive rounded-md p-3 text-sm">
            <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
            <p class="leading-relaxed">{{ csv.error.value }}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>