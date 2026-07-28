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
  Attachment, AttachmentMedia, AttachmentContent,
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
  <Card class="overflow-hidden hover:shadow-md transition">
    <div class="grid grid-cols-1 sm:grid-cols-[280px_1fr] gap-0">
      <!-- 图片区 + 上传附件 -->
      <Attachment
        orientation="vertical"
        size="default"
        :state="attachmentState()"
        class="rounded-none border-0 border-b sm:border-b-0 sm:border-r border-border shadow-none"
      >
        <AttachmentMedia
          v-if="product.image_url && !isUploading()"
          variant="image"
          class="aspect-square sm:aspect-auto sm:min-h-[220px] bg-gradient-to-br from-muted to-muted/40"
        >
          <img :src="product.image_url" :alt="product.model"
            class="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        </AttachmentMedia>

        <AttachmentMedia v-else-if="status() === 'uploading'"
          variant="icon" class="aspect-square sm:aspect-auto sm:min-h-[220px]">
          <div class="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 class="h-7 w-7 animate-spin text-primary" />
            <span class="text-xs font-mono">{{ percent() }}%</span>
          </div>
        </AttachmentMedia>

        <AttachmentMedia v-else-if="status() === 'error'"
          variant="icon"
          class="aspect-square sm:aspect-auto sm:min-h-[220px] bg-destructive/5 text-destructive">
          <AlertTriangle class="h-7 w-7" />
        </AttachmentMedia>

        <AttachmentMedia v-else
          variant="icon" class="aspect-square sm:aspect-auto sm:min-h-[220px]">
          <div class="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageIcon class="h-8 w-8 mb-1" />
            <span class="text-xs">{{ t('admin.products.image.noImage') }}</span>
            <button type="button"
              class="mt-1 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground transition hover:bg-primary hover:text-primary-foreground hover:border-primary"
              @click="emit('pick')">
              <UploadCloud class="h-3.5 w-3.5" />
              {{ t('admin.products.image.upload') }}
            </button>
          </div>
        </AttachmentMedia>

        <AttachmentContent class="hidden" />
      </Attachment>

      <!-- 上传中信息条 -->
      <div v-if="status() === 'uploading'"
        class="border-b bg-primary/5 px-3 py-2 text-xs">
        <div class="flex items-center justify-between gap-2 text-muted-foreground">
          <span class="truncate">
            <span class="font-mono">{{ fileName() }}</span>
            · {{ fileType() }}
            · {{ fileSize() }}
          </span>
          <span class="font-mono font-semibold text-primary">{{ percent() }}%</span>
        </div>
        <div class="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div class="h-full bg-primary transition-all duration-200"
            :style="{ width: percent() + '%' }" />
        </div>
      </div>

      <!-- 错误态信息条 -->
      <div v-else-if="status() === 'error'"
        class="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-destructive">
            <AlertTriangle class="h-3.5 w-3.5" />
            <span class="truncate">{{ errorMsg() }}</span>
          </span>
          <div class="flex shrink-0 items-center gap-1">
            <button v-if="uploadState?.file" type="button"
              class="rounded-md px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              @click="emit('retry', uploadState.file)">
              重试
            </button>
            <button type="button"
              class="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
              @click="emit('clear-upload')">
              忽略
            </button>
          </div>
        </div>
      </div>

      <!-- 文字区 -->
      <div class="p-4 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="font-mono font-semibold text-base truncate">{{ product.model }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ product.remark || '—' }}</p>
          </div>
          <Badge variant="outline" class="shrink-0">{{ product.category }}</Badge>
        </div>

        <!-- 库存小卡 -->
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded-md bg-muted/40 p-2 text-center">
            <p class="text-[10px] text-muted-foreground">{{ t('admin.products.colL1') }}</p>
            <p class="font-mono font-semibold tabular-nums">{{ fmtBoxes(product.total_boxes_level1) }}</p>
          </div>
          <div class="rounded-md bg-muted/40 p-2 text-center">
            <p class="text-[10px] text-muted-foreground">{{ t('admin.products.colL2') }}</p>
            <p class="font-mono font-semibold tabular-nums">{{ fmtBoxes(product.total_boxes_level2) }}</p>
          </div>
          <div class="rounded-md bg-muted/40 p-2 text-center">
            <p class="text-[10px] text-muted-foreground">{{ t('admin.products.colConv') }}</p>
            <p class="font-mono font-semibold tabular-nums">{{ product.conversion_rate }}</p>
          </div>
        </div>

        <!-- 状态 + 操作 -->
        <div class="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1.5 text-xs">
          <template v-if="status() === 'uploading'">
            <Loader2 class="h-3.5 w-3.5 animate-spin text-primary" />
            <span class="font-mono text-primary">上传中 · {{ percent() }}%</span>
            <span class="ml-auto text-muted-foreground">{{ fileSize() }}</span>
          </template>
          <template v-else-if="status() === 'error'">
            <AlertTriangle class="h-3.5 w-3.5 text-destructive" />
            <span class="text-destructive">上传失败</span>
          </template>
          <template v-else-if="status() === 'done'">
            <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
            <span class="text-emerald-700">已上传</span>
          </template>
          <template v-else-if="product.image_url">
            <ImageIcon class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-muted-foreground">{{ product.image_url.split('/').pop()?.split('?')[0] }}</span>
          </template>
          <template v-else>
            <UploadCloud class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-muted-foreground">待上传产品图</span>
          </template>

          <div class="ml-auto flex items-center gap-1">
            <button type="button"
              class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              :disabled="isUploading()"
              @click="emit('pick')">
              <UploadCloud class="h-3 w-3" />
              {{ product.image_url ? '替换' : '上传' }}
            </button>
            <button v-if="product.image_url && !isUploading()" type="button"
              class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
              @click="emit('remove')">
              <Trash2 class="h-3 w-3" />
              删除
            </button>
          </div>
        </div>

        <!-- 色号 chips -->
        <div>
          <p class="text-[10px] text-muted-foreground mb-1">{{ t('admin.products.colColors') }}</p>
          <div class="flex flex-wrap gap-1">
            <Badge v-for="c in (product.colors ?? [])" :key="c.color_code + '_' + c.stock_level"
              variant="secondary" class="font-mono text-[10px]">
              {{ c.color_code }}: {{ c.boxes }}
            </Badge>
            <span v-if="(product.colors ?? []).length === 0" class="text-xs text-muted-foreground italic">—</span>
          </div>
        </div>
      </div>
    </div>
  </Card>
</template>