<!--
  src/views/admin/ProductImportPage.vue
  后台：CSV 库存导入向导（色号 + 客户组映射版）

  步骤：
    1. 上传 CSV
    2. 预览（固定视口：分类-型号-色号树状展示 + sticky 操作条）
    3. 选择策略 + 一键写入 products / stock_colors / account_products
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertTriangle, Eye, EyeOff, Boxes } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

import { useInventoryCsv, type ProductCandidate } from '@/composables/useInventoryCsv'
import { useProducts } from '@/composables/useProducts'
import { useCustomerGroupMappings } from '@/composables/useCustomerGroupMappings'
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
const importResult = ref<{ products: number; colors: number; whiteRows: number } | null>(null)

const onPickFile = () => fileInput.value?.click()

const onFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  // 拉已有 model 集合 + 已有映射（用于自动解析账户 ID）
  const existing = await products.fetchAll()
  const set = new Set(existing.map((p) => p.model))
  await csv.parseFile(file, set)
  // 顺手刷新映射缓存
  await mappings.fetchAll()
  // 解析本次导入涉及的账户 ID
  await refreshAccountIds()
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

// 统计：未映射的客户组（导入时这些组对应的账户白名单会缺）
const unmappedGroups = computed(() => {
  const mapped = new Set(mappings.items.value.map((m) => m.customer_group))
  const all = new Set<string>()
  csv.products.value.forEach((p) => p.customerGroups.forEach((g) => all.add(g)))
  return Array.from(all).filter((g) => !mapped.has(g)).sort()
})

// 解析本次导入涉及的账户 ID（来自客户组→账户映射）
const involvedAccountIds = ref<string[]>([])
const refreshAccountIds = async () => {
  const allGroups = new Set<string>()
  csv.products.value.forEach((p) => p.customerGroups.forEach((g) => allGroups.add(g)))
  involvedAccountIds.value = await mappings.resolveAccountIds(Array.from(allGroups))
}

const onImport = async () => {
  if (csv.products.value.length === 0) return
  importing.value = true
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
      }))
    const accountIds = involvedAccountIds.value
    const result = await products.bulkImportWithColors(toImport, accountIds)
    importResult.value = result
    csv.markExists(toImport.map((r) => r.model))
  } finally {
    importing.value = false
  }
}

const goAssign = () => router.push('/admin/assign')
const goGroupMapping = () => router.push('/admin/customer-groups')

function groupByCategory(items: ProductCandidate[]) {
  const map = new Map<string, ProductCandidate[]>()
  for (const p of items) {
    if (!map.has(p.category)) map.set(p.category, [])
    map.get(p.category)!.push(p)
  }
  return Object.fromEntries(map.entries())
}

const groupedByCategory = computed(() => groupByCategory(filteredProducts.value))
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
        <CardDescription>{{ t('admin.import.step1Desc') }}</CardDescription>
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
          <Badge variant="secondary">{{ t('admin.import.statColors', { n: csv.totalColors.value }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.import.statGroups', { n: csv.totalGroups.value }) }}</Badge>
        </div>
      </CardContent>
    </Card>

    <!-- 步骤 2：预览（关键改动：固定视口） -->
    <Card v-if="csv.products.value.length > 0" class="flex flex-col" style="height: calc(100vh - 220px); min-height: 480px;">
      <CardHeader class="shrink-0 pb-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Boxes class="h-5 w-5" />
              {{ t('admin.import.step2') }}
            </CardTitle>
            <CardDescription>{{ t('admin.import.step2Desc') }}</CardDescription>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Label class="text-xs">{{ t('admin.import.search') }}</Label>
            <Input v-model="search" class="w-56" :placeholder="t('admin.import.searchPh')" />
          </div>
        </div>
      </CardHeader>

      <CardContent class="flex-1 min-h-0 p-0">
        <div class="h-full overflow-y-auto px-6 pb-3">
          <!-- 按分类分组 -->
          <div v-for="(group, cat) in groupedByCategory" :key="cat" class="mb-4">
            <div class="sticky top-0 bg-card z-10 py-2 flex items-center gap-2 border-b">
              <Badge>{{ cat }}</Badge>
              <span class="text-xs text-muted-foreground">
                {{ group.length }} {{ t('admin.import.modelsUnit') }}
              </span>
            </div>
            <ul class="divide-y">
              <li
                v-for="p in group"
                :key="p.model"
                class="py-2 grid grid-cols-12 gap-2 items-start text-sm"
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
                    {{ t('admin.import.totalL1') }}: <span class="font-medium text-foreground">{{ p.totalLevel1 }}</span>
                    ·
                    {{ t('admin.import.totalL2') }}: <span class="font-medium text-foreground">{{ p.totalLevel2 }}</span>
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
              </li>
            </ul>
          </div>
          <div v-if="filteredProducts.length === 0" class="py-10 text-center text-sm text-muted-foreground">
            {{ t('admin.import.empty') }}
          </div>
        </div>
      </CardContent>

      <!-- 底部固定操作条 -->
      <div class="shrink-0 border-t bg-card px-6 py-3 flex items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span v-if="unmappedGroups.length > 0" class="flex items-center gap-1 text-amber-700">
            <AlertTriangle class="h-3 w-3" />
            {{ t('admin.import.unmappedWarn', { n: unmappedGroups.length }) }}
            <Button size="sm" variant="link" class="h-auto p-0 text-xs" @click="goGroupMapping">
              {{ t('admin.import.goMapping') }}
            </Button>
          </span>
          <span v-else class="text-emerald-700">
            ✓ {{ t('admin.import.allMapped') }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <Button
            size="sm"
            :variant="strategy === 'upsert' ? 'default' : 'outline'"
            @click="strategy = 'upsert'"
          >
            {{ t('admin.import.stratUpsert') }}
          </Button>
          <Button
            size="sm"
            :variant="strategy === 'skip_existing' ? 'default' : 'outline'"
            @click="strategy = 'skip_existing'"
          >
            {{ t('admin.import.stratSkip') }}
          </Button>
          <Button :disabled="importing" @click="onImport">
            <Loader2 v-if="importing" class="mr-2 h-4 w-4 animate-spin" />
            {{ t('admin.import.importBtn') }}
          </Button>
        </div>
      </div>
    </Card>

    <!-- 步骤 3：结果 -->
    <Card v-if="importResult || csv.error.value">
      <CardContent class="py-4 space-y-3">
        <div
          v-if="importResult"
          class="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm"
        >
          <CheckCircle2 class="h-5 w-5 text-emerald-600 mt-0.5" />
          <div>
            <p class="font-medium text-emerald-900">{{ t('admin.import.successTitle') }}</p>
            <p class="text-emerald-800">
              {{ t('admin.import.successBody', {
                n: importResult.products,
                colors: importResult.colors,
                whites: importResult.whiteRows,
              }) }}
            </p>
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