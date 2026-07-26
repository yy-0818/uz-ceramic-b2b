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
import { Search, RefreshCw, Loader2, ImagePlus, Box, Image as ImageIcon, Pencil, MoreHorizontal } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'

import { useProducts, type ProductWithColors } from '@/composables/useProducts'
import { uploadProductImage } from '@/composables/useProductImage'

const { t } = useI18n()
const productsApi = useProducts()

const items = ref<ProductWithColors[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const categoryFilter = ref<string>('all')
const onlyWithStock = ref(false)
const uploadingId = ref<string | null>(null)
const uploadErr = ref<string | null>(null)

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
const fileInput = ref<HTMLInputElement | null>(null)
const uploadTargetId = ref<string | null>(null)

const onPickImage = (productId: string) => {
  uploadTargetId.value = productId
  fileInput.value?.click()
}

const onFileSelected = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !uploadTargetId.value) return
  uploadingId.value = uploadTargetId.value
  uploadErr.value = null
  try {
    const url = await uploadProductImage(uploadTargetId.value, file)
    // 本地更新缓存
    const target = items.value.find((p) => p.product_id === uploadTargetId.value)
    if (target) target.image_url = url
  } catch (e: any) {
    uploadErr.value = e.message ?? String(e)
  } finally {
    uploadingId.value = null
    uploadTargetId.value = null
    if (fileInput.value) fileInput.value.value = ''
  }
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
            <CardDescription>{{ t('admin.products.desc') }}</CardDescription>
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

    <!-- 加载中 -->
    <div v-if="loading && items.length === 0" class="text-center text-sm text-muted-foreground py-10">
      <Loader2 class="h-5 w-5 mx-auto mb-2 animate-spin" />
      {{ t('common.loading') }}
    </div>

    <!-- 独立 Card 列表：每张占一整行 -->
    <div v-else-if="filtered.length > 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card
        v-for="p in filtered"
        :key="p.product_id"
        class="overflow-hidden hover:shadow-md transition"
      >
        <div class="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-0">
          <!-- 图片区 -->
          <div
            class="relative aspect-square sm:aspect-auto sm:min-h-[160px] bg-muted/40 flex items-center justify-center"
          >
            <img
              v-if="p.image_url"
              :src="p.image_url"
              :alt="p.model"
              class="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
            <div
              v-else
              class="flex flex-col items-center justify-center text-muted-foreground text-xs"
            >
              <ImageIcon class="h-8 w-8 mb-1" />
              <span>暂无图片</span>
            </div>

            <!-- 上传按钮：悬浮在右下角 -->
            <Button
              size="icon"
              variant="secondary"
              class="absolute bottom-2 right-2 h-8 w-8 rounded-full shadow"
              :disabled="uploadingId === p.product_id"
              @click="onPickImage(p.product_id)"
            >
              <Loader2 v-if="uploadingId === p.product_id" class="h-4 w-4 animate-spin" />
              <ImagePlus v-else class="h-4 w-4" />
            </Button>
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