<!--
  src/views/admin/ProductImportPage.vue
  后台：CSV 导入向导
  步骤：
    1. 上传 CSV
    2. 预览解析结果（按 model 聚合）
    3. 选择入库策略（新增 / 覆盖 / 跳过）
    4. 写入 products 表
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableEmpty from '@/components/ui/TableEmpty.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

import { useInventoryCsv } from '@/composables/useInventoryCsv'
import { useProducts } from '@/composables/useProducts'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()

const csv = useInventoryCsv()
const products = useProducts()

const fileInput = ref<HTMLInputElement | null>(null)
const search = ref('')
const strategy = ref<'upsert' | 'skip_existing'>('upsert')
const importing = ref(false)
const importResult = ref<{ inserted: number; updated: number } | null>(null)

// 搜索过滤
const filteredCandidates = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return csv.candidates.value
  return csv.candidates.value.filter((c) =>
    c.model.toLowerCase().includes(q) ||
    c.category.toLowerCase().includes(q) ||
    (c.remark || '').toLowerCase().includes(q),
  )
})

const onPickFile = () => fileInput.value?.click()

const onFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  // 加载已存在的 model 集合，用于标记 existsInDb
  const existing = await products.fetchAll()
  const set = new Set(existing.map((p) => p.model))
  await csv.parseFile(file, set)
}

const onImport = async () => {
  if (csv.candidates.value.length === 0) return
  importing.value = true
  try {
    const rows = csv.candidates.value
      .filter((c) => strategy.value === 'upsert' || !c.existsInDb)
      .map((c) => ({
        model: c.model,
        category: c.category,
        conversion_rate: c.conversionRate,
        remark: c.remark || null,
      }))
    const result = await products.bulkUpsert(rows as any)
    importResult.value = {
      inserted: result.length,
      updated: result.filter((r) => existingIdsBefore.value.has(r.id)).length,
    }
    csv.markExists(result.map((r) => r.model))
  } finally {
    importing.value = false
  }
}

const existingIdsBefore = computed(() => new Set(products.items.value.map((p) => p.id)))

const goAssign = () => router.push('/admin/assign')
</script>

<template>
  <div class="space-y-6">
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
          class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                 hover:border-primary/60 hover:bg-muted/30 transition"
          @click="onPickFile"
        >
          <FileSpreadsheet class="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p class="text-sm text-muted-foreground">
            {{ csv.filename.value || t('admin.import.dropHint') }}
          </p>
          <Button size="sm" class="mt-4" variant="outline" :disabled="csv.parsing.value">
            <Loader2 v-if="csv.parsing.value" class="mr-2 h-4 w-4 animate-spin" />
            {{ t('admin.import.chooseFile') }}
          </Button>
        </div>

        <div v-if="csv.candidates.value.length > 0" class="mt-4 flex flex-wrap gap-3 text-sm">
          <Badge>{{ t('admin.import.statRows', { n: csv.totalRows.value }) }}</Badge>
          <Badge>{{ t('admin.import.statProducts', { n: csv.totalCandidates.value }) }}</Badge>
          <Badge>{{ t('admin.import.statGroups', { n: csv.totalGroups.value }) }}</Badge>
        </div>
      </CardContent>
    </Card>

    <!-- 步骤 2：预览 -->
    <Card v-if="csv.candidates.value.length > 0">
      <CardHeader>
        <CardTitle>{{ t('admin.import.step2') }}</CardTitle>
        <CardDescription>{{ t('admin.import.step2Desc') }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-3">
          <Label class="text-sm">{{ t('admin.import.search') }}</Label>
          <Input v-model="search" class="max-w-xs" :placeholder="t('admin.import.searchPh')" />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('admin.import.colModel') }}</TableHead>
              <TableHead>{{ t('admin.import.colCategory') }}</TableHead>
              <TableHead>{{ t('admin.import.colConv') }}</TableHead>
              <TableHead>{{ t('admin.import.colRemark') }}</TableHead>
              <TableHead>{{ t('admin.import.colGroups') }}</TableHead>
              <TableHead>{{ t('admin.import.colStatus') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="c in filteredCandidates" :key="c.model">
              <TableCell class="font-mono font-medium">{{ c.model }}</TableCell>
              <TableCell>
                <Badge variant="secondary">{{ c.category }}</Badge>
              </TableCell>
              <TableCell>{{ c.conversionRate }}</TableCell>
              <TableCell class="text-muted-foreground text-xs">{{ c.remark || '—' }}</TableCell>
              <TableCell class="text-xs text-muted-foreground">
                {{ c.groups.map(g => g.customerGroup).join('、') }}
              </TableCell>
              <TableCell>
                <Badge v-if="c.existsInDb" class="bg-amber-100 text-amber-800">
                  {{ t('admin.import.exists') }}
                </Badge>
                <Badge v-else class="bg-emerald-100 text-emerald-800">
                  {{ t('admin.import.new') }}
                </Badge>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="filteredCandidates.length === 0">
              {{ t('admin.import.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- 步骤 3：策略 + 写入 -->
    <Card v-if="csv.candidates.value.length > 0">
      <CardHeader>
        <CardTitle>{{ t('admin.import.step3') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex gap-2">
          <Button
            :variant="strategy === 'upsert' ? 'default' : 'outline'"
            size="sm"
            @click="strategy = 'upsert'"
          >
            {{ t('admin.import.stratUpsert') }}
          </Button>
          <Button
            :variant="strategy === 'skip_existing' ? 'default' : 'outline'"
            size="sm"
            @click="strategy = 'skip_existing'"
          >
            {{ t('admin.import.stratSkip') }}
          </Button>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button :disabled="importing" @click="onImport">
            <Loader2 v-if="importing" class="mr-2 h-4 w-4 animate-spin" />
            {{ t('admin.import.importBtn') }}
          </Button>
          <Button variant="outline" @click="goAssign">
            {{ t('admin.import.goAssign') }}
          </Button>
        </div>

        <div
          v-if="importResult"
          class="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm"
        >
          <CheckCircle2 class="h-5 w-5 text-emerald-600 mt-0.5" />
          <div>
            <p class="font-medium text-emerald-900">
              {{ t('admin.import.successTitle') }}
            </p>
            <p class="text-emerald-800">
              {{ t('admin.import.successBody', { n: importResult.inserted }) }}
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
      </CardContent>
    </Card>
  </div>
</template>
