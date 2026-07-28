<!--
  src/views/admin/product-import/ImportUploadCard.vue
  步骤 1：上传 CSV + 解析后统计
  父级：<ImportUploadCard :csv="csv" :total-colors="N" :total-l1="N" :total-l2="N"
                        :unmapped-count="N" @pick-file="onPick" />
-->
<script setup lang="ts">
import { ref } from 'vue'
import { Upload, Loader2, FileSpreadsheet } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'

import { useI18n } from '@/lib/i18n'

defineProps<{
  csv: {
    filename: { value: string | null }
    parsing: { value: boolean }
    totalRows: { value: number }
    totalProducts: { value: number }
    totalGroups: { value: number }
  }
  totalColors: number
  totalL1: number
  totalL2: number
  unmappedCount: number
}>()

const emit = defineEmits<{
  (e: 'pick-file', file: File): void
}>()

const { t } = useI18n()

const fileInput = ref<HTMLInputElement | null>(null)
const onPickFile = () => fileInput.value?.click()
const onChange = (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) emit('pick-file', f)
}
</script>

<template>
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
        @change="onChange"
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

      <div v-if="csv.totalProducts.value > 0" class="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">{{ t('admin.import.statRows', { n: csv.totalRows.value }) }}</Badge>
        <Badge variant="secondary">{{ t('admin.import.statProducts', { n: csv.totalProducts.value }) }}</Badge>
        <Badge variant="secondary">{{ t('admin.import.statColors', { n: totalColors }) }}</Badge>
        <Badge variant="secondary">
          L1: {{ totalL1.toLocaleString() }} · L2: {{ totalL2.toLocaleString() }}
        </Badge>
        <Badge :variant="unmappedCount === 0 ? 'secondary' : 'destructive'">
          {{ t('admin.import.statGroups', { n: csv.totalGroups.value }) }}
          <span v-if="unmappedCount > 0" class="ml-1">· !{{ unmappedCount }}</span>
        </Badge>
      </div>
    </CardContent>
  </Card>
</template>