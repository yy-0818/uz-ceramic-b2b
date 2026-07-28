<!--
  src/views/admin/AllProductsPage.vue
  admin 视角：所有商品 — 独立 Card 列表（每张占整行）

  - 走 v_products_with_colors view（绕过 account_products 白名单）
  - 搜索 + 按分类 / 仅显示有库存筛选
  - 每张 Card：图片区（占位 / 已上传）+ 型号 + 分类 + 换算率 + 1级/2级 + 色号 chips
  - 预留图片上传按钮（点击调 useStorageUpload）
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, RefreshCw, Loader2, Image as ImageIcon, CheckCircle2, UploadCloud, Trash2, AlertTriangle, Box } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import ProductCardSkeleton from '@/components/ui/ProductCardSkeleton.vue'
import {
  Attachment,
  AttachmentMedia,
} from '@/components/ui/attachment'

import { useProducts, type ProductWithColors } from '@/composables/useProducts'
import {
  uploadProductImage,
  removeProductImage,
  fmtFileSize,
  fmtFileType,
} from '@/composables/useProductImage'

const { t } = useI18n()
const productsApi = useProducts()

const items = ref<ProductWithColors[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const categoryFilter = ref<string>('all')
const onlyWithStock = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadTargetId = ref<string | null>(null)
const uploadErr = ref<string | null>(null)

interface UploadState {
  productId: string
  file: File
  percent: number
  status: 'uploading' | 'done' | 'error'
  message?: string
}
const uploads = ref<Map<string, UploadState>>(new Map())

const statusFor = (id: string) => uploads.value.get(id)

/** 上传态显示：idle / uploading / error / done + shimmer */
const attachmentStateFor = (p: ProductWithColors) => {
  const u = uploads.value.get(p.product_id)
  if (!u) {
    return p.image_url ? 'done' : 'idle'
  }
  if (u.status === 'uploading') return 'uploading'
  if (u.status === 'error') return 'error'
  // done 之后清空本地态
  return 'done'
}

const load = async () => {
  loading.value = true
  error.value = null
  try {
    items.value = await productsApi.fetchAllWithColors()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const categories = computed(() => {
  const set = new Set<string>()
  items.value.forEach((p) => p.category && set.add(p.category))
  return ['all', ...Array.from(set).sort()]
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value
    .filter((p) => {
      if (categoryFilter.value !== 'all' && p.category !== categoryFilter.value) return false
      if (onlyWithStock.value && (p.total_boxes_level1 + p.total_boxes_level2) === 0) return false
      if (!q) return true
      return (
        p.model.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.remark || '').toLowerCase().includes(q) ||
        (p.colors ?? []).some((c) => c.color_code.toLowerCase().includes(q))
      )
    })
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category)
      return a.model.localeCompare(b.model)
    })
})

const summary = computed(() => {
  const total = filtered.value.length
  const totalL1 = filtered.value.reduce((s, p) => s + (p.total_boxes_level1 ?? 0), 0)
  const totalL2 = filtered.value.reduce((s, p) => s + (p.total_boxes_level2 ?? 0), 0)
  const totalColors = filtered.value.reduce((s, p) => s + (p.colors?.length ?? 0), 0)
  const withImage = filtered.value.filter((p) => p.image_url).length
  return { total, totalL1, totalL2, totalColors, withImage }
})

const fmtBoxes = (n: number) => n.toLocaleString()

// 图片上传
const onPickImage = (productId: string) => {
  uploadTargetId.value = productId
  fileInput.value?.click()
}

const performUpload = async (productId: string, file: File) => {
  uploads.value.set(productId, { productId, file, percent: 0, status: 'uploading' })
  uploads.value = new Map(uploads.value) // 触发响应式
  try {
    const url = await uploadProductImage(productId, file, {
      simulateProgress: true,
      onProgress: (p) => {
        const cur = uploads.value.get(productId)
        if (!cur) return
        uploads.value.set(productId, { ...cur, percent: p })
        uploads.value = new Map(uploads.value)
      },
    })
    const cur = uploads.value.get(productId)
    if (cur) {
      uploads.value.set(productId, { ...cur, percent: 100, status: 'done' })
      uploads.value = new Map(uploads.value)
    }
    // 写回本地
    const target = items.value.find((p) => p.product_id === productId)
    if (target) target.image_url = url
    // 2s 后清掉态（保留流光体验）
    setTimeout(() => {
      if (uploads.value.get(productId)?.status === 'done') {
        uploads.value.delete(productId)
        uploads.value = new Map(uploads.value)
      }
    }, 2000)
  } catch (e: any) {
    uploadErr.value = e.message ?? String(e)
    const cur = uploads.value.get(productId)
    if (cur) {
      uploads.value.set(productId, { ...cur, status: 'error', message: e.message })
      uploads.value = new Map(uploads.value)
    }
  }
}

const onFileSelected = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !uploadTargetId.value) return
  const productId = uploadTargetId.value
  uploadTargetId.value = null
  if (fileInput.value) fileInput.value.value = ''
  await performUpload(productId, file)
}

const onRetry = async (productId: string, file: File) => {
  await performUpload(productId, file)
}

const onRemove = async (productId: string) => {
  if (!confirm('确定删除该商品的产品图吗？')) return
  try {
    await removeProductImage(productId)
    const target = items.value.find((p) => p.product_id === productId)
    if (target) target.image_url = null
    uploads.value.delete(productId)
    uploads.value = new Map(uploads.value)
  } catch (e: any) {
    uploadErr.value = e.message ?? String(e)
  }
}

const onClearUpload = (productId: string) => {
  // 用户取消当前上传
  uploads.value.delete(productId)
  uploads.value = new Map(uploads.value)
}
</script>

<template>
  <div class="space-y-4">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onFileSelected"
    />

    <!-- 顶部：汇总 + 筛选 -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Box class="h-5 w-5" />
              {{ t('admin.products.title') }}
            </CardTitle>
          </div>
          <Button variant="outline" size="sm" @click="load" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            <RefreshCw v-else class="mr-2 h-4 w-4" />
            {{ t('common.refresh') }}
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{{ t('admin.products.statTotal', { n: summary.total }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.products.statL1', { n: fmtBoxes(summary.totalL1) }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.products.statL2', { n: fmtBoxes(summary.totalL2) }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.products.statColors', { n: summary.totalColors }) }}</Badge>
          <Badge variant="secondary">{{ t('admin.products.statWithImage', { n: summary.withImage }) }}</Badge>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input v-model="search" :placeholder="t('admin.products.searchPh')" class="pl-9 h-9" />
          </div>
          <label class="flex items-center gap-2 text-xs whitespace-nowrap">
            <input type="checkbox" v-model="onlyWithStock" class="rounded" />
            {{ t('admin.products.onlyWithStock') }}
          </label>
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <Button
            v-for="c in categories"
            :key="c"
            size="sm"
            :variant="categoryFilter === c ? 'default' : 'outline'"
            class="shrink-0"
            @click="categoryFilter = c"
          >
            {{ c === 'all' ? t('admin.products.allCategory') : c }}
          </Button>
        </div>

        <div v-if="error" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ error }}
        </div>
        <div v-if="uploadErr" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ uploadErr }}
        </div>
      </CardContent>
    </Card>

    <!-- 加载中：商品卡骨架 -->
    <div v-if="loading && items.length === 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ProductCardSkeleton v-for="i in 4" :key="i" />
    </div>

    <!-- 独立 Card 列表：每张占一整行 -->
    <div v-else-if="filtered.length > 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card
        v-for="p in filtered"
        :key="p.product_id"
        class="overflow-hidden hover:shadow-md transition"
      >
        <div class="grid grid-cols-1 sm:grid-cols-[280px_1fr] gap-0">
          <!-- 图片区 + 上传附件 -->
          <Attachment
            orientation="vertical"
            size="default"
            :state="attachmentStateFor(p)"
            class="rounded-none border-0 border-b sm:border-b-0 sm:border-r border-border shadow-none"
          >
            <AttachmentMedia
              v-if="p.image_url && !statusFor(p.product_id)?.status"
              variant="image"
              class="aspect-square sm:aspect-auto sm:min-h-[220px] bg-gradient-to-br from-muted to-muted/40"
            >
              <img
                :src="p.image_url"
                :alt="p.model"
                class="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
            </AttachmentMedia>
            <AttachmentMedia
              v-else-if="statusFor(p.product_id)?.status === 'uploading'"
              variant="icon"
              class="aspect-square sm:aspect-auto sm:min-h-[220px]"
            >
              <div class="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 class="h-7 w-7 animate-spin text-primary" />
                <span class="text-xs font-mono">{{ statusFor(p.product_id)?.percent ?? 0 }}%</span>
              </div>
            </AttachmentMedia>
            <AttachmentMedia
              v-else-if="statusFor(p.product_id)?.status === 'error'"
              variant="icon"
              class="aspect-square sm:aspect-auto sm:min-h-[220px] bg-destructive/5 text-destructive"
            >
              <AlertTriangle class="h-7 w-7" />
            </AttachmentMedia>
            <AttachmentMedia
              v-else
              variant="icon"
              class="aspect-square sm:aspect-auto sm:min-h-[220px]"
            >
              <div class="flex flex-col items-center gap-1 text-muted-foreground">
                <ImageIcon class="h-8 w-8 mb-1" />
                <span class="text-xs">{{ t('admin.products.image.noImage') || '暂无图片' }}</span>
                <button
                  type="button"
                  class="mt-1 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground transition hover:bg-primary hover:text-primary-foreground hover:border-primary"
                  @click="onPickImage(p.product_id)"
                >
                  <UploadCloud class="h-3.5 w-3.5" />
                  {{ t('admin.products.image.upload') || '上传图片' }}
                </button>
              </div>
            </AttachmentMedia>

            <AttachmentContent class="hidden" />
          </Attachment>

          <!-- 上传态信息条 (uploading) -->
          <div
            v-if="statusFor(p.product_id)?.status === 'uploading'"
            class="border-b bg-primary/5 px-3 py-2 text-xs"
          >
            <div class="flex items-center justify-between gap-2 text-muted-foreground">
              <span class="truncate">
                <span class="font-mono">{{ statusFor(p.product_id)?.file?.name }}</span>
                ·
                {{ fmtFileType(statusFor(p.product_id)?.file?.type ?? '') }}
                ·
                {{ fmtFileSize(statusFor(p.product_id)?.file?.size ?? 0) }}
              </span>
              <span class="font-mono font-semibold text-primary">
                {{ statusFor(p.product_id)?.percent ?? 0 }}%
              </span>
            </div>
            <div class="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full bg-primary transition-all duration-200"
                :style="{ width: (statusFor(p.product_id)?.percent ?? 0) + '%' }"
              />
            </div>
          </div>

          <!-- 错误态信息条 -->
          <div
            v-if="statusFor(p.product_id)?.status === 'error'"
            class="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-1.5 text-destructive">
                <AlertTriangle class="h-3.5 w-3.5" />
                <span class="truncate">{{ statusFor(p.product_id)?.message || '上传失败' }}</span>
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="rounded-md px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                  @click="onRetry(p.product_id, statusFor(p.product_id)!.file)"
                >
                  重试
                </button>
                <button
                  type="button"
                  class="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                  @click="onClearUpload(p.product_id)"
                >
                  忽略
                </button>
              </div>
            </div>
          </div>

          <!-- 文字区 -->
          <div class="p-4 space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-mono font-semibold text-base truncate">{{ p.model }}</p>
                <p class="text-xs text-muted-foreground truncate">
                  {{ p.remark || '—' }}
                </p>
              </div>
              <Badge variant="outline" class="shrink-0">{{ p.category }}</Badge>
            </div>

            <!-- 库存小卡 -->
            <div class="grid grid-cols-3 gap-2">
              <div class="rounded-md bg-muted/40 p-2 text-center">
                <p class="text-[10px] text-muted-foreground">{{ t('admin.products.colL1') }}</p>
                <p class="font-mono font-semibold tabular-nums">{{ fmtBoxes(p.total_boxes_level1) }}</p>
              </div>
              <div class="rounded-md bg-muted/40 p-2 text-center">
                <p class="text-[10px] text-muted-foreground">{{ t('admin.products.colL2') }}</p>
                <p class="font-mono font-semibold tabular-nums">{{ fmtBoxes(p.total_boxes_level2) }}</p>
              </div>
              <div class="rounded-md bg-muted/40 p-2 text-center">
                <p class="text-[10px] text-muted-foreground">{{ t('admin.products.colConv') }}</p>
                <p class="font-mono font-semibold tabular-nums">{{ p.conversion_rate }}</p>
              </div>
            </div>

            <!-- 图态 indicator + 操作按钮 -->
            <div class="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1.5 text-xs">
              <template v-if="statusFor(p.product_id)?.status === 'uploading'">
                <Loader2 class="h-3.5 w-3.5 animate-spin text-primary" />
                <span class="font-mono text-primary">
                  上传中 · {{ statusFor(p.product_id)?.percent ?? 0 }}%
                </span>
                <span class="ml-auto text-muted-foreground">
                  {{ fmtFileSize(statusFor(p.product_id)?.file?.size ?? 0) }}
                </span>
              </template>
              <template v-else-if="statusFor(p.product_id)?.status === 'error'">
                <AlertTriangle class="h-3.5 w-3.5 text-destructive" />
                <span class="text-destructive">上传失败</span>
              </template>
              <template v-else-if="statusFor(p.product_id)?.status === 'done'">
                <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
                <span class="text-emerald-700">已上传</span>
              </template>
              <template v-else-if="p.image_url">
                <ImageIcon class="h-3.5 w-3.5 text-muted-foreground" />
                <span class="text-muted-foreground">
                  {{ p.image_url.split('/').pop()?.split('?')[0] }}
                </span>
              </template>
              <template v-else>
                <UploadCloud class="h-3.5 w-3.5 text-muted-foreground" />
                <span class="text-muted-foreground">待上传产品图</span>
              </template>

              <!-- 操作按钮：替换 / 删除 -->
              <div class="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                  @click="onPickImage(p.product_id)"
                  :disabled="statusFor(p.product_id)?.status === 'uploading'"
                >
                  <UploadCloud class="h-3 w-3" />
                  {{ p.image_url ? '替换' : '上传' }}
                </button>
                <button
                  v-if="p.image_url && statusFor(p.product_id)?.status !== 'uploading'"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                  @click="onRemove(p.product_id)"
                >
                  <Trash2 class="h-3 w-3" />
                  删除
                </button>
              </div>
            </div>

            <!-- 色号 chips -->
            <div>
              <p class="text-[10px] text-muted-foreground mb-1">{{ t('admin.products.colColors') }}</p>
              <div class="flex flex-wrap gap-1">
                <Badge
                  v-for="c in (p.colors ?? [])"
                  :key="c.color_code + '_' + c.stock_level"
                  variant="secondary"
                  class="font-mono text-[10px]"
                >
                  {{ c.color_code }}: {{ c.boxes }}
                </Badge>
                <span v-if="(p.colors ?? []).length === 0" class="text-xs text-muted-foreground italic">
                  —
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <!-- 空 -->
    <Card v-else>
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        {{ t('admin.products.empty') }}
      </CardContent>
    </Card>
  </div>
</template>