<!--
  src/views/admin/AllProductsPage.vue
  admin 视角：所有商品 — 独立 Card 列表（每张占整行）

  - 走 v_products_with_colors view（绕过 account_products 白名单）
  - 搜索 + 按分类 / 仅显示有库存筛选
  - 每张 Card 由 ./all-products/ProductCard 子组件渲染
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, RefreshCw, Image as ImageIcon, Database, X, ArrowLeft, Package } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import ProductCardSkeleton from '@/components/ui/ProductCardSkeleton.vue'

import { useProducts, type ProductWithColors } from '@/composables/useProducts'
import {
  uploadProductImage,
  removeProductImage,
} from '@/composables/useProductImage'

import ProductCard, { type UploadState } from './all-products/ProductCard.vue'
import BulkImportDialog from './all-products/BulkImportDialog.vue'

const { t } = useI18n()
const router = useRouter()
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

// Upload state
const uploads = ref<Map<string, UploadState>>(new Map())
const statusFor = (id: string) => uploads.value.get(id)

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

// Recompute categories from items
const categories = computed(() => {
  const set = new Set<string>()
  for (const p of items.value) set.add(p.category)
  return Array.from(set).sort()
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const cat = categoryFilter.value
  const stock = onlyWithStock.value
  return items.value.filter((p) => {
    if (cat !== 'all' && p.category !== cat) return false
    if (stock && p.total_boxes_level1 + p.total_boxes_level2 === 0) return false
    if (!q) return true
    return p.model.toLowerCase().includes(q)
      || (p.remark?.toLowerCase().includes(q) ?? false)
      || p.category.toLowerCase().includes(q)
  })
})

// Single-pass summary: one loop, three counters
const summary = computed(() => {
  let withImage = 0
  let withStock = 0
  for (const p of items.value) {
    if (p.image_url) withImage++
    if (p.total_boxes_level1 + p.total_boxes_level2 > 0) withStock++
  }
  return { total: items.value.length, withImage, withStock }
})

const performUpload = async (productId: string, file: File) => {
  uploads.value.set(productId, { productId, file, percent: 0, status: 'uploading' })
  uploads.value = new Map(uploads.value)
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
    const target = items.value.find((p) => p.product_id === productId)
    if (target) target.image_url = url
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
  if (!confirm(t('admin.productsAll.confirmDelImage'))) return
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
  uploads.value.delete(productId)
  uploads.value = new Map(uploads.value)
}

const onPickImage = (productId: string) => {
  uploadTargetId.value = productId
  fileInput.value?.click()
}

const goBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/admin')
}

// ===== 批量导入 =====
const bulkDialogOpen = ref(false)
const modelToProductId = computed(() => {
  const m = new Map<string, string>()
  for (const p of items.value) m.set(p.model, p.product_id)
  return m
})
const openBulkImport = () => {
  if (items.value.length === 0) {
    error.value = '商品列表为空, 请先刷新页面'
    return
  }
  bulkDialogOpen.value = true
}
const onBulkDone = async () => {
  // 批量上传完成后重新拉一次列表, 让新图即时显示
  await load()
}
</script>

<template>
  <div class="space-y-4">
    <!-- ===================== 顶部 hero（sticky） ===================== -->
    <header class="sticky top-14 z-20">
      <!--
        mobile 优先: 不用 flex-wrap 做行布局, 改用 grid + 显式行,
        避免 chip / select / 复选框在窄屏被压扁或溢出
      -->
      <div class="rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 py-4 sm:px-6 sm:py-5 shadow-sm relative overflow-hidden">
        <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
        <div class="pointer-events-none absolute -right-4 top-1/2 h-24 w-24 rounded-full bg-primary/5" />

        <!-- Row 1: 返回 + 标题 + 刷新 -->
        <div class="relative flex items-center gap-2">
          <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0 -ml-1" @click="goBack">
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              <h1 class="text-base sm:text-lg font-bold leading-tight truncate">
                {{ t('admin.products.title') }}
              </h1>
              <span class="text-[10px] font-semibold tracking-wider text-primary uppercase whitespace-nowrap">
                {{ summary.total }} 商品
              </span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl hidden sm:block">
              全量商品图册；点击卡片右上角上传商品图，支持按分类 / 库存过滤。
            </p>
          </div>
          <Button size="sm" variant="outline" class="shrink-0" @click="load" :disabled="loading">
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
            <span class="hidden sm:inline ml-1">刷新</span>
          </Button>
        </div>

        <!-- Row 2: 统计 chips (横向滚动容器, mobile 不溢出) -->
        <div class="relative mt-3 -mx-4 sm:mx-0">
          <div class="flex gap-2 overflow-x-auto px-4 sm:px-0 scrollbar-none">
            <div class="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs shrink-0">
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span class="text-muted-foreground whitespace-nowrap">{{ t('admin.productsAll.withImage') }}</span>
              <Badge variant="secondary" class="text-[10px] tabular-nums ml-0.5">
                {{ summary.withImage }}
              </Badge>
            </div>
            <div class="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs shrink-0">
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
              <span class="text-muted-foreground whitespace-nowrap">{{ t('admin.productsAll.withStock') }}</span>
              <Badge variant="secondary" class="text-[10px] tabular-nums ml-0.5">
                {{ summary.withStock }}
              </Badge>
            </div>
            <div v-if="filtered.length !== items.length" class="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs shrink-0">
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span class="text-muted-foreground whitespace-nowrap">已过滤</span>
              <Badge variant="secondary" class="text-[10px] tabular-nums ml-0.5">
                {{ filtered.length }}
              </Badge>
            </div>
            <div class="inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1 text-xs shrink-0">
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              <button type="button" class="text-primary whitespace-nowrap font-medium" @click="openBulkImport">
                批量导入图册
              </button>
            </div>
          </div>
        </div>

        <!-- Row 3: 搜索 + 分类 + 复选框 (mobile 用 2 列 grid) -->
        <div class="relative mt-3 grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2">
          <div class="relative min-w-0 sm:flex-1">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input v-model="search" :placeholder="t('admin.productsAll.searchPh')"
              class="pl-8 pr-8 w-full h-9 text-sm" />
            <button v-if="search" type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              @click="search = ''">
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <select v-model="categoryFilter"
            class="h-9 rounded-md border bg-background px-2 text-sm w-full sm:w-auto sm:shrink-0">
            <option value="all">{{ t('admin.productsAll.allCategory') }}</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
          <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0 sm:ml-auto">
            <Checkbox :checked="onlyWithStock" @update:checked="onlyWithStock = $event" />
            <span class="whitespace-nowrap">{{ t('admin.productsAll.onlyWithStock') }}</span>
          </label>
        </div>
      </div>
    </header>

    <!-- 错误条 -->
    <div v-if="error" class="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">
      {{ error }}
    </div>
    <div v-if="uploadErr" class="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2">
      {{ uploadErr }}
    </div>

    <!-- 上传 input（隐藏） -->
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileSelected" />

    <!-- 加载中 -->
    <div v-if="loading && items.length === 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
      <ProductCardSkeleton v-for="i in 8" :key="i" />
    </div>

    <!-- 列表 -->
    <div v-else-if="filtered.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
      <ProductCard
        v-for="p in filtered" :key="p.product_id"
        :product="p"
        :upload-state="statusFor(p.product_id)"
        @pick="onPickImage(p.product_id)"
        @retry="(file: File) => onRetry(p.product_id, file)"
        @clear-upload="onClearUpload(p.product_id)"
        @remove="onRemove(p.product_id)"
      />
    </div>

    <!-- 空 -->
    <Card v-else>
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        <Database class="h-8 w-8 mx-auto mb-2 opacity-40" />
        {{ t('admin.products.allEmpty') }}
      </CardContent>
    </Card>

    <!-- 批量导入 dialog -->
    <BulkImportDialog
      v-model:open="bulkDialogOpen"
      :model-to-product-id="modelToProductId"
      @done="onBulkDone"
    />
  </div>
</template>