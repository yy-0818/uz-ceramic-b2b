<!--
  src/views/admin/ProductImportPage.vue
  后台：CSV 库存导入向导（色号 + 客户组映射版）

  步骤：
    1. 上传 CSV
    2. 预览（按分类归纳 + 色号前缀二级汇总）
    3. 选择策略 + 一键写入 products / stock_colors / account_products
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertTriangle, Eye, EyeOff, Boxes, ChevronDown, ChevronRight, X } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Dialog from '@/components/ui/Dialog.vue'

import { useInventoryCsv, type ProductCandidate } from '@/composables/useInventoryCsv'
import { useProducts } from '@/composables/useProducts'
import { useCustomerGroupMappings } from '@/composables/useCustomerGroupMappings'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()

const csv = useInventoryCsv()
const products = useProducts()
const mappings = useCustomerGroupMappings()

const fileInput = ref<HTMLInputElement | null>(null)
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

// 折叠状态：key=category, value=展开?
const expanded = ref<Record<string, boolean>>({})

// 客户组未映射 modal
const unmappedDialogOpen = ref(false)

const onPickFile = () => fileInput.value?.click()

const onFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const existing = await products.fetchAll()
  const set = new Set(existing.map((p) => p.model))
  await csv.parseFile(file, set)
  await mappings.fetchAll()
  await refreshAccountIds()
  // 默认全部展开第一个分类
  const first = csv.products.value[0]
  if (first) expanded.value[first.category] = true
}

// 搜索过滤（按 model / category / 客户组）
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

// 未映射的客户组
const unmappedGroups = computed(() => {
  const mapped = new Set(mappings.items.value.map((m) => m.customer_group))
  const all = new Set<string>()
  csv.products.value.forEach((p) => p.customerGroups.forEach((g) => all.add(g)))
  return Array.from(all).filter((g) => !mapped.has(g)).sort()
})

const involvedAccountIds = ref<string[]>([])
const refreshAccountIds = async () => {
  const allGroups = new Set<string>()
  csv.products.value.forEach((p) => p.customerGroups.forEach((g) => allGroups.add(g)))
  involvedAccountIds.value = await mappings.resolveAccountIds(Array.from(allGroups))
}

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

    // 写后回读：核对 DB 实际数据
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
const goGroupMapping = () => router.push('/admin/customer-groups')

// === 两层归纳：分类 → 色号前缀 ===
type PrefixAgg = {
  prefix: string
  boxes: number
  models: number
  colors: Array<{ code: string; boxes: number }>
}
type CategoryAgg = {
  category: string
  totalBoxes: number
  totalL1: number
  totalL2: number
  models: number
  prefixes: PrefixAgg[]
  products: ProductCandidate[]
}

function colorPrefix(code: string): string {
  // D1..D22 → D, A1..A14 → A, A → A, 其它 → 首字母
  const m = code.match(/^([A-Z])/i)
  return m ? m[1].toUpperCase() : '#'
}

function aggregate(items: ProductCandidate[]): CategoryAgg[] {
  const catMap = new Map<string, CategoryAgg>()
  for (const p of items) {
    let agg = catMap.get(p.category)
    if (!agg) {
      agg = {
        category: p.category,
        totalBoxes: 0,
        totalL1: 0,
        totalL2: 0,
        models: 0,
        prefixes: [],
        products: [],
      }
      catMap.set(p.category, agg)
    }
    agg.totalBoxes += p.totalLevel1 + p.totalLevel2
    agg.totalL1 += p.totalLevel1
    agg.totalL2 += p.totalLevel2
    agg.models += 1
    agg.products.push(p)

    // 合并色号前缀
    const prefMap = new Map<string, PrefixAgg>()
    for (const c of p.colors) {
      const pref = colorPrefix(c.colorCode)
      let pa = prefMap.get(pref)
      if (!pa) {
        pa = { prefix: pref, boxes: 0, models: 0, colors: [] }
        prefMap.set(pref, pa)
      }
      pa.boxes += c.boxes
      const exists = pa.colors.find((x) => x.code === c.colorCode)
      if (exists) exists.boxes += c.boxes
      else pa.colors.push({ code: c.colorCode, boxes: c.boxes })
    }
    for (const [pref, pa] of prefMap) {
      let exist = agg.prefixes.find((x) => x.prefix === pref)
      if (exist) {
        exist.boxes += pa.boxes
        for (const cc of pa.colors) {
          const e = exist.colors.find((x) => x.code === cc.code)
          if (e) e.boxes += cc.boxes
          else exist.colors.push(cc)
        }
      } else {
        agg.prefixes.push(pa)
      }
    }
  }
  for (const a of catMap.values()) {
    a.prefixes.sort((x, y) => x.prefix.localeCompare(y.prefix))
    a.prefixes.forEach((pf) => pf.colors.sort((x, y) => x.code.localeCompare(y.code)))
  }
  return Array.from(catMap.values()).sort((a, b) => a.category.localeCompare(b.category))
}

const aggregatedCategories = computed(() => aggregate(filteredProducts.value))

// 全局统计
const totalColors = computed(() =>
  csv.products.value.reduce((s, p) => s + p.colors.length, 0),
)
const totalBoxesL1 = computed(() =>
  csv.products.value.reduce((s, p) => s + p.totalLevel1, 0),
)
const totalBoxesL2 = computed(() =>
  csv.products.value.reduce((s, p) => s + p.totalLevel2, 0),
)

const toggleCategory = (cat: string) => {
  expanded.value[cat] = !expanded.value[cat]
}
</script>

<template>
  <div class="space-y-4">
    <!-- 步骤 1：上传 -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Upload class="h-5 w-5" />
          {{ t('admin.import.step1') }}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          @change="onFileChange"
        />
        <div
          class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                 hover:border-primary/60 hover:bg-muted/30 transition"
          @click="onPickFile"
        >
          <FileSpreadsheet class="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p class="text-sm text-muted-foreground">
            {{ csv.filename.value || t('admin.import.dropHint') }}
          </p>
          <Button size="sm" class="mt-3" variant="outline" :disabled="csv.parsing.value">
            <Loader2 v-if="csv.parsing.value" class="mr-2 h-4 w-4 animate-spin" />
            {{ t('admin.import.chooseFile') }}
          </Button>
        </div>

        <div v-if="csv.products.value.length > 0" class="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{{ t('admin.import.statRows', { n: csv.totalRows.value }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.import.statProducts', { n: csv.totalProducts.value }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.import.statColors', { n: totalColors }) }}</Badge>
          <Badge variant="secondary">
            L1: {{ totalBoxesL1.toLocaleString() }} · L2: {{ totalBoxesL2.toLocaleString() }}
          </Badge>
          <Badge :variant="unmappedGroups.length === 0 ? 'secondary' : 'destructive'">
            {{ t('admin.import.statGroups', { n: csv.totalGroups.value }) }}
            <span v-if="unmappedGroups.length > 0" class="ml-1">
              · !{{ unmappedGroups.length }}
            </span>
          </Badge>
        </div>
      </CardContent>
    </Card>

    <!-- 步骤 2：预览（两层归纳） -->
    <Card v-if="csv.products.value.length > 0" class="flex flex-col" style="height: calc(100vh - 220px); min-height: 480px;">
      <CardHeader class="shrink-0 pb-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Boxes class="h-5 w-5" />
              {{ t('admin.import.step2') }}
            </CardTitle>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Label class="text-xs">{{ t('admin.import.search') }}</Label>
            <Input v-model="search" class="w-56" :placeholder="t('admin.import.searchPh')" />
          </div>
        </div>
      </CardHeader>

      <CardContent class="flex-1 min-h-0 p-0">
        <div class="h-full overflow-y-auto px-6 pb-3">
          <div v-for="agg in aggregatedCategories" :key="agg.category" class="mb-4 border rounded-lg overflow-hidden">
            <!-- 分类头（可点击展开） -->
            <button
              class="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition text-left"
              @click="toggleCategory(agg.category)"
            >
              <component :is="expanded[agg.category] ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
              <Badge>{{ agg.category }}</Badge>
              <span class="text-xs text-muted-foreground">
                {{ agg.models }} {{ t('admin.import.modelsUnit') }}
              </span>
              <span class="text-xs text-muted-foreground">·</span>
              <span class="text-xs text-emerald-700">
                L1 {{ agg.totalL1.toLocaleString() }}
              </span>
              <span class="text-xs text-muted-foreground">·</span>
              <span class="text-xs text-sky-700">
                L2 {{ agg.totalL2.toLocaleString() }}
              </span>
              <span class="text-xs text-muted-foreground">·</span>
              <span class="text-xs">
                <span
                  v-for="pf in agg.prefixes"
                  :key="pf.prefix"
                  class="inline-flex items-center px-1.5 py-0.5 rounded bg-background border mr-1 font-mono text-[10px]"
                >
                  {{ pf.prefix }}: {{ pf.boxes.toLocaleString() }}
                </span>
              </span>
            </button>

            <!-- 分类下：商品列表 -->
            <div v-show="expanded[agg.category]" class="divide-y">
              <div
                v-for="p in agg.products"
                :key="p.model"
                class="px-4 py-2 grid grid-cols-12 gap-2 items-start text-sm"
              >
                <!-- 型号 + 分类 -->
                <div class="col-span-3">
                  <div class="flex items-center gap-1">
                    <span class="font-mono font-medium truncate">{{ p.model }}</span>
                    <span v-if="p.isVisible" class="text-emerald-600"><Eye class="h-3 w-3" /></span>
                    <span v-else class="text-muted-foreground"><EyeOff class="h-3 w-3" /></span>
                  </div>
                  <p v-if="p.remark" class="text-xs text-muted-foreground truncate">{{ p.remark }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ p.conversionRate }} м²/ящ
                  </p>
                </div>

                <!-- 色号 + 箱数 -->
                <div class="col-span-6 flex flex-wrap gap-1">
                  <Badge
                    v-for="c in p.colors"
                    :key="c.colorCode + c.stockLevel"
                    variant="outline"
                    class="font-mono"
                  >
                    {{ c.colorCode }}: {{ c.boxes }}
                  </Badge>
                  <span v-if="p.colors.length === 0" class="text-xs text-muted-foreground italic">
                    {{ t('admin.import.noColors') }}
                  </span>
                </div>

                <!-- 总库存 + 客户组 + 状态 -->
                <div class="col-span-3 text-xs text-muted-foreground">
                  <div>
                    L1: <span class="font-medium text-foreground">{{ p.totalLevel1 }}</span>
                    ·
                    L2: <span class="font-medium text-foreground">{{ p.totalLevel2 }}</span>
                  </div>
                  <div class="truncate" :title="p.customerGroups.join(', ')">
                    {{ t('admin.import.groups') }}: {{ p.customerGroups.length }}
                  </div>
                  <div>
                    <Badge v-if="p.existsInDb" class="bg-amber-100 text-amber-800 text-[10px] py-0">
                      {{ t('admin.import.exists') }}
                    </Badge>
                    <Badge v-else class="bg-emerald-100 text-emerald-800 text-[10px] py-0">
                      {{ t('admin.import.new') }}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="filteredProducts.length === 0" class="py-10 text-center text-sm text-muted-foreground">
            {{ t('admin.import.empty') }}
          </div>
        </div>
      </CardContent>

      <!-- 底部固定操作条（精简版） -->
      <div class="shrink-0 border-t bg-card px-6 py-3 flex items-center justify-between gap-3">
        <!-- 左侧：唯一的危险提示 → 触发 modal -->
        <div class="flex items-center gap-2 text-xs">
          <Button
            v-if="unmappedGroups.length > 0"
            variant="outline"
            size="sm"
            class="text-amber-700 border-amber-200 hover:bg-amber-50"
            @click="unmappedDialogOpen = true"
          >
            <AlertTriangle class="h-3 w-3 mr-1" />
            {{ t('admin.import.unmappedWarn', { n: unmappedGroups.length }) }}
          </Button>
          <span v-else class="text-emerald-700">
            ✓ {{ t('admin.import.allMapped') }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex items-center rounded-md border text-xs">
            <button
              class="px-3 py-1.5 transition"
              :class="strategy === 'upsert' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
              @click="strategy = 'upsert'"
            >
              {{ t('admin.import.stratUpsert') }}
            </button>
            <button
              class="px-3 py-1.5 border-l transition"
              :class="strategy === 'skip_existing' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
              @click="strategy = 'skip_existing'"
            >
              {{ t('admin.import.stratSkip') }}
            </button>
          </div>
          <Button :disabled="importing" @click="onImport">
            <Loader2 v-if="importing" class="mr-2 h-4 w-4 animate-spin" />
            {{ t('admin.import.importBtn') }}
          </Button>
        </div>
      </div>
    </Card>

    <!-- 未映射客户组 modal -->
    <Dialog v-model:open="unmappedDialogOpen" title="未映射客户组" description="这些客户组不会出现在任何账户的白名单中，需先在客户组映射中关联账户">
      <div class="space-y-3">
        <p class="text-sm text-muted-foreground">
          CSV 中出现 <strong>{{ unmappedGroups.length }}</strong> 个客户组未关联到任何账户：
        </p>
        <div class="max-h-60 overflow-y-auto rounded-md border bg-muted/30 p-2 flex flex-wrap gap-1">
          <Badge v-for="g in unmappedGroups" :key="g" variant="outline" class="font-mono text-xs">
            {{ g }}
          </Badge>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="unmappedDialogOpen = false">稍后处理</Button>
          <Button @click="goGroupMapping">前往映射</Button>
        </div>
      </div>
    </Dialog>

    <!-- 步骤 3：结果 -->
    <Card v-if="importResult || importError || csv.error.value">
      <CardContent class="py-4 space-y-3">
        <div
          v-if="importResult"
          class="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm"
        >
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
        <div
          v-if="importError"
          class="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm"
        >
          <AlertTriangle class="h-5 w-5 text-red-600 mt-0.5" />
          <div>
            <p class="font-medium text-red-900">导入失败</p>
            <p class="text-red-800 font-mono text-xs">{{ importError }}</p>
          </div>
        </div>
        <div
          v-if="csv.error.value"
          class="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm"
        >
          <AlertTriangle class="h-5 w-5 text-red-600 mt-0.5" />
          <p class="text-red-800">{{ csv.error.value }}</p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" @click="goAssign">{{ t('admin.import.goAssign') }}</Button>
          <Button variant="outline" @click="goGroupMapping">{{ t('admin.import.goMapping') }}</Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
