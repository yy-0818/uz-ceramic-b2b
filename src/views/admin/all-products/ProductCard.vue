<!--
  src/views/admin/all-products/ProductCard.vue
  AllProductsPage 单行 Card —— 图片 + 上传态 + 库存 + 色号 + 操作
  父级：
    <ProductCard
      :product="p"
      :upload-state="uploads.get(p.product_id)"
      @pick="onPickImage(p.product_id)"
      @retry="onRetry(p.product_id, file)"
      @clear-upload="onClearUpload(p.product_id)"
      @remove="onRemove(p.product_id)"
    />
-->
<script setup lang="ts">
import { Loader2, Image as ImageIcon, UploadCloud, AlertTriangle, Trash2, CheckCircle2 } from 'lucide-vue-next'

import Badge from '@/components/ui/Badge.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'

import {
  Attachment, AttachmentMedia,
} from '@/components/ui/attachment'

import { useI18n } from '@/lib/i18n'
import type { ProductWithColors } from '@/composables/useProducts'

type UploadStatus = 'uploading' | 'error' | 'done'
export type UploadState = {
  productId: string
  file: File
  percent: number
  status: UploadStatus
  message?: string
}

const props = defineProps<{
  product: ProductWithColors
  uploadState: UploadState | undefined
}>()

const emit = defineEmits<{
  (e: 'pick'): void
  (e: 'retry', file: File): void
  (e: 'clear-upload'): void
  (e: 'remove'): void
}>()

const { t } = useI18n()

const fmtBoxes = (n: number) => n.toLocaleString()
const fmtFileType = (type: string) => {
  if (!type) return t('admin.products.image.unknownType')
  if (type.startsWith('image/')) return type.replace('image/', '').toUpperCase()
  return type
}
const fmtFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const status = () => props.uploadState?.status
const percent = () => props.uploadState?.percent ?? 0
const fileName = () => props.uploadState?.file?.name ?? ''
const fileType = () => fmtFileType(props.uploadState?.file?.type ?? '')
const fileSize = () => fmtFileSize(props.uploadState?.file?.size ?? 0)
const errorMsg = () => props.uploadState?.message || t('admin.products.image.fail')
const isUploading = () => status() === 'uploading'

// 色号 chip 限制 12 个 + "+N more" 标记
const MAX_COLORS = 12
const visibleColors = () => (props.product.colors ?? []).slice(0, MAX_COLORS)
const extraColorsCount = () => Math.max(0, (props.product.colors ?? []).length - MAX_COLORS)

// Attachment 组件期望字符串 state；映射：done+有图 → 'done'，无图 → 'idle'
const attachmentState = () => {
  const s = status()
  if (s === 'uploading') return 'uploading'
  if (s === 'error') return 'error'
  if (s === 'done' || props.product.image_url) return 'done'
  return 'idle'
}
</script>

<template>
  <Card class="overflow-hidden hover:shadow-md transition flex flex-col" style="content-visibility: auto; contain-intrinsic-size: 0 380px;">
    <!-- 顶部：图缩略 -->
    <div class="relative aspect-[4/3] sm:aspect-[16/10] bg-muted/40 overflow-hidden">
      <img v-if="product.image_url && !isUploading()"
        :src="product.image_url" :alt="product.model"
        class="absolute inset-0 w-full h-full object-cover" loading="lazy" />

      <!-- 加载中 -->
      <div v-else-if="status() === 'uploading'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 text-muted-foreground">
        <Loader2 class="h-6 w-6 animate-spin text-primary" />
        <span class="text-xs font-mono">{{ percent() }}%</span>
      </div>

      <!-- 错误 -->
      <div v-else-if="status() === 'error'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-destructive bg-destructive/5">
        <AlertTriangle class="h-6 w-6" />
        <span class="text-xs">{{ t('admin.products.image.fail') }}</span>
      </div>

      <!-- 无图 -->
      <div v-else
        class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
        <ImageIcon class="h-6 w-6 sm:h-7 sm:w-7 opacity-60" />
        <span class="text-[10px] sm:text-[11px]">{{ t('admin.products.image.noImage') }}</span>
      </div>

      <!-- 右上分类 badge -->
      <Badge variant="secondary" class="absolute top-2 right-2 text-[10px] backdrop-blur bg-background/80">
        {{ product.category }}
      </Badge>

      <!-- 左上上传进度条（uploading 时） -->
      <div v-if="status() === 'uploading'"
        class="absolute bottom-0 inset-x-0 h-1 bg-muted/60">
        <div class="h-full bg-primary transition-all duration-200"
          :style="{ width: percent() + '%' }" />
      </div>
    </div>

    <!-- 中部：标题 + 备注 -->
    <div class="px-2 sm:px-3 pt-2 sm:pt-3 pb-1.5 sm:pb-2">
      <p class="font-mono font-semibold text-xs sm:text-sm truncate">{{ product.model }}</p>
      <p class="text-[10px] sm:text-[11px] text-muted-foreground truncate min-h-[12px] sm:min-h-[14px]">{{ product.remark || '—' }}</p>
    </div>

    <!-- KPI 3 列 -->
    <div class="grid grid-cols-3 gap-1 px-2 sm:px-3">
      <div class="rounded bg-muted/40 px-1 py-0.5 sm:px-1.5 sm:py-1 text-center">
        <p class="text-[8px] sm:text-[9px] text-muted-foreground uppercase tracking-wide">{{ t('admin.products.colL1') }}</p>
        <p class="font-mono font-semibold tabular-nums text-[10px] sm:text-xs">{{ fmtBoxes(product.total_boxes_level1) }}</p>
      </div>
      <div class="rounded bg-muted/40 px-1 py-0.5 sm:px-1.5 sm:py-1 text-center">
        <p class="text-[8px] sm:text-[9px] text-muted-foreground uppercase tracking-wide">{{ t('admin.products.colL2') }}</p>
        <p class="font-mono font-semibold tabular-nums text-[10px] sm:text-xs">{{ fmtBoxes(product.total_boxes_level2) }}</p>
      </div>
      <div class="rounded bg-muted/40 px-1 py-0.5 sm:px-1.5 sm:py-1 text-center">
        <p class="text-[8px] sm:text-[9px] text-muted-foreground uppercase tracking-wide">{{ t('admin.products.colConv') }}</p>
        <p class="font-mono font-semibold tabular-nums text-[10px] sm:text-xs">{{ product.conversion_rate }}</p>
      </div>
    </div>

    <!-- 色号 chips -->
    <div class="px-2 sm:px-3 py-1.5 sm:py-2 min-h-[36px] sm:min-h-[44px]">
      <p class="text-[8px] sm:text-[9px] text-muted-foreground mb-0.5 sm:mb-1 uppercase tracking-wide">{{ t('admin.products.colColors') }}</p>
      <div class="flex flex-wrap gap-0.5 sm:gap-1">
        <Badge v-for="c in visibleColors()" :key="c.color_code + '_' + c.stock_level"
          variant="outline" class="font-mono text-[9px] sm:text-[10px] h-4 sm:h-5 px-1 sm:px-1.5">
          {{ c.color_code }} <span class="tabular-nums text-muted-foreground">{{ c.boxes }}</span>
        </Badge>
        <Badge v-if="extraColorsCount() > 0" variant="secondary"
          class="font-mono text-[9px] sm:text-[10px] h-4 sm:h-5 px-1 sm:px-1.5">
          +{{ extraColorsCount() }}
        </Badge>
        <span v-if="(product.colors ?? []).length === 0"
          class="text-[10px] sm:text-[11px] text-muted-foreground italic">—</span>
      </div>
    </div>

    <!-- 错误信息条（upload error 时显示文件名 + 重试） -->
    <div v-if="status() === 'error'"
      class="mx-2 sm:mx-3 mb-1.5 sm:mb-2 border border-destructive/30 bg-destructive/5 rounded-md px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-[11px]">
      <div class="flex items-center justify-between gap-1">
        <span class="flex items-center gap-1 text-destructive truncate">
          <AlertTriangle class="h-3 w-3 shrink-0" />
          <span class="truncate">{{ fileName() || errorMsg() }}</span>
        </span>
        <div class="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button v-if="uploadState?.file" type="button"
            class="rounded px-1 sm:px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 text-[10px] sm:text-[11px]"
            @click="emit('retry', uploadState.file)">
            {{ t('admin.products.image.retry') }}
          </button>
          <button type="button"
            class="rounded px-1 sm:px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-muted text-[10px] sm:text-[11px]"
            @click="emit('clear-upload')">
            {{ t('admin.products.image.dismiss') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 底部操作行 -->
    <div class="mt-auto border-t bg-muted/20 px-1.5 sm:px-2 py-1 sm:py-1.5 flex items-center gap-1 text-[10px] sm:text-[11px]">
      <template v-if="status() === 'uploading'">
        <Loader2 class="h-3 w-3 animate-spin text-primary shrink-0" />
        <span class="font-mono text-primary truncate">{{ t('admin.products.image.uploading') }} · {{ percent() }}%</span>
        <span class="ml-auto text-muted-foreground font-mono shrink-0">{{ fileSize() }}</span>
      </template>
      <template v-else-if="status() === 'done'">
        <CheckCircle2 class="h-3 w-3 text-emerald-600 shrink-0" />
        <span class="text-emerald-700 truncate">{{ t('admin.products.image.uploaded') }}</span>
      </template>
      <template v-else-if="product.image_url">
        <ImageIcon class="h-3 w-3 text-muted-foreground shrink-0" />
        <span class="text-muted-foreground truncate">{{ product.image_url.split('/').pop()?.split('?')[0] }}</span>
      </template>
      <template v-else>
        <UploadCloud class="h-3 w-3 text-muted-foreground shrink-0" />
        <span class="text-muted-foreground truncate">{{ t('admin.products.image.pending') }}</span>
      </template>

      <div class="ml-auto flex items-center gap-0.5 sm:gap-1">
        <button type="button"
          class="inline-flex items-center gap-0.5 rounded px-1 sm:px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 disabled:opacity-40 text-[9px] sm:text-[11px]"
          :disabled="isUploading()"
          @click="emit('pick')">
          <UploadCloud class="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          {{ product.image_url ? t('admin.products.image.replace') : t('admin.products.image.upload') }}
        </button>
        <button v-if="product.image_url && !isUploading()" type="button"
          class="inline-flex items-center gap-0.5 rounded px-1 sm:px-1.5 py-0.5 font-medium text-destructive hover:bg-destructive/10 text-[9px] sm:text-[11px]"
          @click="emit('remove')">
          <Trash2 class="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          {{ t('admin.products.image.delete') }}
        </button>
      </div>
    </div>
  </Card>
</template>