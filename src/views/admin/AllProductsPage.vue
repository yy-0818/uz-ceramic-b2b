<!--
  src/views/admin/AllProductsPage.vue
  admin 视角：所有商品 — 独立 Card 列表（每张占整行）

  - 走 v_products_with_colors view（绕过 account_products 白名单）
  - 搜索 + 按分类 / 仅显示有库存筛选
  - 每张 Card 由 ./all-products/ProductCard 子组件渲染
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, RefreshCw, Image as ImageIcon, Database, X } from 'lucide-vue-next'
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
</script>

<template>
  <div class="space-y-3">
    <!-- Sticky toolbar: top-14 = below AppLayout header -->
    <div class="sticky top-14 z-20 bg-background/95 backdrop-blur shadow-sm border rounded-lg p-3 space-y-2">
      <!-- Row 1: 标题 + 统计 chip + 刷新 -->
      <div class="flex items-center gap-2 flex-wrap min-h-[2rem]">
        <ImageIcon class="h-5 w-5 text-muted-foreground shrink-0" />
        <h1 class="text-base sm:text-lg font-semibold">{{ t('admin.products.title') }}</h1>
        <Badge variant="secondary" class="font-mono tabular-nums text-xs">{{ summary.total }}</Badge>
        <span class="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {{ t('admin.productsAll.withImage') }}
          <span class="font-mono font-semibold text-foreground tabular-nums">{{ summary.withImage }}</span>
        </span>
        <span class="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />
          {{ t('admin.productsAll.withStock') }}
          <span class="font-mono font-semibold text-foreground tabular-nums">{{ summary.withStock }}</span>
        </span>
        <Button size="sm" variant="outline" class="ml-auto" @click="load" :disabled="loading">
          <RefreshCw class="h-4 w-4 sm:mr-1.5" :class="{ 'animate-spin': loading }" />
          <span class="hidden xs:inline">{{ t('admin.productsAll.refresh') }}</span>
        </Button>
      </div>
      <!-- Row 2: 搜索 + 分类 + 复选框 -->
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative flex-1 min-w-[140px]">
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
          class="h-9 rounded-md border bg-background px-2 text-sm shrink-0">
          <option value="all">{{ t('admin.productsAll.allCategory') }}</option>
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none shrink-0">
          <Checkbox :checked="onlyWithStock" @update:checked="onlyWithStock = $event" />
          <span class="whitespace-nowrap">{{ t('admin.productsAll.onlyWithStock') }}</span>
        </label>
      </div>
    </div>

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

    <!-- 列表：content-visibility auto skips off-screen rendering -->
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
  </div>
</template>