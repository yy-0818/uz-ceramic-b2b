<!--
  src/views/customer/ProductBrowsePage.vue
  客户"盲价列表" —— 移动端优先 + 三级导航
  - 第 1 级：瓷砖分类 (12J / 12P / 12F ...)
  - 第 2 级：型号 (A12P001)
  - 第 3 级：色号 (D1 D2 ... A1 ...) + 该色号箱数
  - 不显示单价；按"整箱"下单；每箱 = conversion_rate 平方米
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ChevronLeft, Search, Plus, Minus, ShoppingCart, Package, ImageOff, Box, Tag, Hash } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import Dialog from '@/components/ui/Dialog.vue'
import CategoryCardSkeleton from '@/components/ui/CategoryCardSkeleton.vue'
import ModelCardSkeleton from '@/components/ui/ModelCardSkeleton.vue'

import { useAccountProducts } from '@/composables/useAccountProducts'
import { useProducts, type ProductWithColors } from '@/composables/useProducts'
import { useCart } from '@/composables/useCart'
import { useAuth } from '@/composables/useAuth'
import { supabase } from '@/lib/supabase'

const { t } = useI18n()
const router = useRouter()
const ap = useAccountProducts()
const productsApi = useProducts()
const cart = useCart()
const { isAdmin } = useAuth()

const allProducts = ref<ProductWithColors[]>([])
const loading = ref(false)

const refresh = async () => {
  loading.value = true
  console.log('[catalog] refresh, role=', useAuth().appUser.value?.role, 'isAdmin=', isAdmin.value)
  // admin 视角：直接拉全部商品
  if (isAdmin.value) {
    try {
      allProducts.value = await productsApi.fetchAllWithColors()
      console.log('[catalog] admin fetched products', { count: allProducts.value.length })
      ap.items.value = allProducts.value.map((p) => ({
        account_id: '',
        product_id: p.product_id,
        is_visible: true,
        stock_level_1: p.total_boxes_level1,
        stock_level_2: p.total_boxes_level2,
        updated_at: '',
        product: {
          id: p.product_id,
          model: p.model,
          category: p.category,
          conversion_rate: p.conversion_rate,
          remark: p.remark,
        },
      }))
    } finally {
      loading.value = false
    }
    return
  }
  // 客户/审核员视角：按 stock_group 白名单
  try {
    // 1. 拿到当前父账号绑定的所有库存组
    const { data: groups } = await supabase
      .from('customer_group_mappings')
      .select('customer_group')
      .eq('is_active', true)
    const myGroups = (groups ?? []).map((r: any) => r.customer_group)
    console.log('[catalog] my stock groups', myGroups)
    if (myGroups.length === 0) {
      ap.items.value = []
      allProducts.value = []
      loading.value = false
      return
    }
    // 2. 拉这些组的所有 product
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .in('stock_group', myGroups)
    console.log('[catalog] whitelisted products by stock_group', { count: prods?.length })
    // 3. 拉全量带色号（view）
    allProducts.value = await productsApi.fetchAllWithColors()
    // 4. 把可白名单的产品按 AccountProductRow 装（合成）
    const allowedIds = new Set((prods ?? []).map((p: any) => p.id))
    const allowedFull = allProducts.value.filter((p) => allowedIds.has(p.product_id))
    ap.items.value = allowedFull.map((p) => ({
      account_id: '',
      product_id: p.product_id,
      is_visible: true,
      stock_level_1: p.total_boxes_level1,
      stock_level_2: p.total_boxes_level2,
      updated_at: '',
      product: {
        id: p.product_id,
        model: p.model,
        category: p.category,
        conversion_rate: p.conversion_rate,
        remark: p.remark,
      },
    }))
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

// 三级状态
const view = ref<'categories' | 'models' | 'colors'>('categories')
const selectedCategory = ref<string>('')
const selectedModel = ref<ProductWithColors | null>(null)
const search = ref('')
const showCart = ref(false)

// 第 1 级：分类列表（按白名单聚合：型号数 / 箱数 / 色号数）
const categoriesWithCount = computed(() => {
  type Agg = { models: number; boxes: number; colors: number }
  const map = new Map<string, Agg>()
  const fullMap = new Map<string, ProductWithColors>()
  for (const p of allProducts.value) fullMap.set(p.product_id, p)
  for (const row of ap.items.value) {
    if (!row.product) continue
    const cat = row.product.category
    const full = fullMap.get(row.product.id)
    let agg = map.get(cat)
    if (!agg) {
      agg = { models: 0, boxes: 0, colors: 0 }
      map.set(cat, agg)
    }
    agg.models += 1
    agg.boxes += row.stock_level_1 + row.stock_level_2
    agg.colors += (full?.colors ?? []).length
  }
  return Array.from(map.entries())
    .map(([cat, agg]) => ({ cat, ...agg }))
    .sort((a, b) => a.cat.localeCompare(b.cat))
})

// 分类卡片色板（基于 cat 名称 hash 选 preset，避免所有卡都一个色）
const PALETTES = [
  { bg: 'from-blue-500/15 to-blue-500/5',     fg: 'text-blue-600 dark:text-blue-400',     ring: 'hover:border-blue-500/40',     glow: 'group-hover:shadow-blue-500/10' },
  { bg: 'from-emerald-500/15 to-emerald-500/5', fg: 'text-emerald-600 dark:text-emerald-400', ring: 'hover:border-emerald-500/40', glow: 'group-hover:shadow-emerald-500/10' },
  { bg: 'from-amber-500/15 to-amber-500/5',   fg: 'text-amber-600 dark:text-amber-400',   ring: 'hover:border-amber-500/40',   glow: 'group-hover:shadow-amber-500/10' },
  { bg: 'from-rose-500/15 to-rose-500/5',     fg: 'text-rose-600 dark:text-rose-400',     ring: 'hover:border-rose-500/40',     glow: 'group-hover:shadow-rose-500/10' },
  { bg: 'from-violet-500/15 to-violet-500/5', fg: 'text-violet-600 dark:text-violet-400', ring: 'hover:border-violet-500/40', glow: 'group-hover:shadow-violet-500/10' },
  { bg: 'from-cyan-500/15 to-cyan-500/5',     fg: 'text-cyan-600 dark:text-cyan-400',     ring: 'hover:border-cyan-500/40',     glow: 'group-hover:shadow-cyan-500/10' },
  { bg: 'from-orange-500/15 to-orange-500/5', fg: 'text-orange-600 dark:text-orange-400', ring: 'hover:border-orange-500/40', glow: 'group-hover:shadow-orange-500/10' },
  { bg: 'from-teal-500/15 to-teal-500/5',     fg: 'text-teal-600 dark:text-teal-400',     ring: 'hover:border-teal-500/40',     glow: 'group-hover:shadow-teal-500/10' },
] as const
const paletteFor = (cat: string) => {
  let h = 0
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0
  return PALETTES[h % PALETTES.length]
}

// 第 2 级：选定分类下的型号列表（join 色号视图）
const modelsInCategory = computed(() => {
  if (!selectedCategory.value) return []
  const apMap = new Map<string, number>()  // product_id -> stock_level_1 + stock_level_2
  for (const row of ap.items.value) {
    if (!row.product) continue
    if (row.product.category !== selectedCategory.value) continue
    apMap.set(row.product.id, row.stock_level_1 + row.stock_level_2)
  }
  const q = search.value.trim().toLowerCase()
  return allProducts.value
    .filter((p) => p.category === selectedCategory.value && apMap.has(p.product_id))
    .filter((p) => {
      if (!q) return true
      return (
        p.model.toLowerCase().includes(q) ||
        (p.remark ?? '').toLowerCase().includes(q) ||
        (p.colors ?? []).some((c) => c.color_code.toLowerCase().includes(q))
      )
    })
    .map((p) => ({
      ...p,
      availableBoxes: apMap.get(p.product_id) ?? 0,
    }))
    .sort((a, b) => a.model.localeCompare(b.model))
})

// 第 3 级：当前选中型号的所有色号
const colorsInModel = computed(() => {
  if (!selectedModel.value) return []
  return (selectedModel.value.colors ?? []).filter((c) => c.boxes > 0)
})

const openCategory = (cat: string) => {
  selectedCategory.value = cat
  search.value = ''
  view.value = 'models'
}

const openModel = (p: ProductWithColors) => {
  selectedModel.value = p
  view.value = 'colors'
}

const back = () => {
  if (view.value === 'colors') {
    selectedModel.value = null
    view.value = 'models'
  } else if (view.value === 'models') {
    selectedCategory.value = ''
    view.value = 'categories'
  }
}

const onQty = (productId: string, model: string, conversionRate: number, delta: number) => {
  const cur = cart.qtyOf(productId)
  const next = Math.max(0, cur + delta)
  if (next === 0) cart.remove(productId)
  else cart.setQty(productId, model, conversionRate, next)
}

const fmtM2 = (n: number) => `${n.toFixed(2)} м²`
const cartTotalBoxes = computed(() => cart.totalBoxes())
const cartTotalM2 = computed(() => cart.totalM2())
</script>

<template>
  <div class="space-y-3">
    <!-- 头部：面包屑 + 购物车 -->
    <header class="flex items-center justify-between gap-2 sticky top-0 bg-background/95 backdrop-blur z-10 py-2">
      <div class="flex items-center gap-2 min-w-0">
        <Button v-if="view !== 'categories'" size="icon" variant="ghost" class="h-8 w-8" @click="back">
          <ChevronLeft class="h-5 w-5" />
        </Button>
        <div class="min-w-0">
          <h1 class="text-base font-semibold truncate">
            <span v-if="view === 'categories'">{{ t('customer.catalog.title') }}</span>
            <span v-else-if="view === 'models'">{{ selectedCategory }}</span>
            <span v-else class="font-mono">{{ selectedModel?.model }}</span>
          </h1>
          <p class="text-xs text-muted-foreground truncate">
            <span v-if="view === 'categories'">{{ t('customer.catalog.subtitle') }}</span>
            <span v-else-if="view === 'models'">{{ modelsInCategory.length }} {{ t('customer.catalog.modelsUnit') }}</span>
            <span v-else>{{ selectedModel?.category }} · {{ selectedModel?.conversion_rate }} м²/ящ</span>
          </p>
        </div>
      </div>
      <Button size="icon" class="relative shrink-0" @click="showCart = true">
        <ShoppingCart class="h-5 w-5" />
        <span
          v-if="cartTotalBoxes > 0"
          class="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center"
        >
          {{ cartTotalBoxes }}
        </span>
      </Button>
    </header>

    <!-- 搜索（仅 models 视图需要） -->
    <div v-if="view === 'models'" class="relative">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input v-model="search" :placeholder="t('customer.catalog.search')" class="pl-9 h-10" />
    </div>

    <!-- 加载中：按当前 view 显示不同骨架 -->
    <div v-if="loading" class="space-y-4">
      <div v-if="view === 'categories' || ap.loading.value" class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <CategoryCardSkeleton v-for="i in 6" :key="i" />
      </div>
      <div v-else class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        <ModelCardSkeleton v-for="i in 8" :key="i" />
      </div>
    </div>

    <!-- 第 1 级：分类网格 -->
    <div v-else-if="view === 'categories'">
      <!-- 智能空状态：区分"全库空" vs "白名单空" vs "分类未映射" -->
      <div v-if="categoriesWithCount.length === 0" class="space-y-3 py-10">
        <!-- admin：库里压根没商品 -->
        <div v-if="isAdmin && allProducts.length === 0"
          class="text-center text-sm text-muted-foreground border border-dashed rounded-lg p-6">
          <p class="font-medium text-foreground">库里还没有商品</p>
          <p class="mt-1">先去 <code class="bg-muted px-1 rounded">/admin/import</code> 导入一次 CSV。</p>
        </div>
        <!-- admin：有商品 → admin 视角下理论上能看到全部 -->
        <div v-else-if="isAdmin && allProducts.length > 0"
          class="text-center text-sm text-amber-800 border border-amber-200 bg-amber-50 rounded-lg p-6">
          <p class="font-medium">⚠ admin 视角本应看到全部 {{ allProducts.length }} 个商品，但白名单聚合为空</p>
          <p class="mt-1 text-xs">检查 console 的 <code>[catalog]</code> 日志</p>
        </div>
        <!-- 客户：白名单为空 -->
        <div v-else
          class="text-center text-sm text-muted-foreground border border-dashed rounded-lg p-6">
          <p class="font-medium text-foreground">你的账号还没有可见商品</p>
          <p class="mt-1">请联系管理员把客户组关联到你的账号，或者让你被加入某些商品的白名单。</p>
        </div>
      </div>
      <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          v-for="{ cat, models, boxes, colors } in categoriesWithCount"
          :key="cat"
          :class="[
            'group cursor-pointer overflow-hidden border-2 transition-all active:scale-[0.98]',
            paletteFor(cat).ring,
            'hover:shadow-md',
            paletteFor(cat).glow,
          ].join(' ')"
          @click="openCategory(cat)"
        >
          <CardContent class="flex items-center gap-3 pt-5 pb-4 px-4">
            <!-- Icon 区（带色板渐变） -->
            <div
              class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br transition-transform duration-200 group-hover:scale-105"
              :class="paletteFor(cat).bg"
            >
              <Tag class="h-5 w-5" :class="paletteFor(cat).fg" />
            </div>

            <!-- 文本信息 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-1.5">
                <span class="truncate font-mono text-base font-bold tracking-tight" :title="cat">
                  {{ cat }}
                </span>
                <span class="text-[11px] text-muted-foreground shrink-0">
                  {{ t('customer.catalog.classification') || '分类' }}
                </span>
              </div>
              <!-- 元信息：型号 / 箱数 / 色号 -->
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground">
                  <Package class="h-3 w-3 text-muted-foreground" />
                  {{ models }} {{ t('customer.catalog.modelsUnit') }}
                </span>
                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  <Box class="h-3 w-3" />
                  {{ boxes.toLocaleString() }} {{ t('customer.catalog.box') }}
                </span>
                <span class="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10.5px] font-medium text-blue-700 dark:text-blue-400">
                  <Hash class="h-3 w-3" />
                  {{ colors }} {{ t('customer.catalog.colorsUnit') }}
                </span>
              </div>
            </div>

            <!-- 右箭头 -->
            <ChevronLeft
              class="h-4 w-4 shrink-0 rotate-180 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
            />
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 第 2 级：型号卡片网格（含图片） -->
    <div v-else-if="view === 'models'">
      <!-- 空状态：搜索无果 -->
      <div v-if="modelsInCategory.length === 0" class="py-12 text-center">
        <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Search class="h-5 w-5" />
        </div>
        <p class="text-sm text-muted-foreground">
          {{ search ? `没找到「${search}」相关型号` : t('customer.catalog.empty') }}
        </p>
      </div>
      <div v-else class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        <Card
          v-for="p in modelsInCategory"
          :key="p.product_id"
          class="group cursor-pointer overflow-hidden transition-all hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 active:scale-[0.98]"
          @click="openModel(p)"
        >
          <!-- 图片区 -->
          <div class="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-muted to-muted/40">
            <img
              v-if="p.image_url"
              :src="p.image_url"
              :alt="p.model"
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
            <div v-else class="flex h-full w-full items-center justify-center">
              <div class="flex flex-col items-center gap-1 text-muted-foreground/50">
                <Package class="h-7 w-7" />
                <span class="text-[10px]">暂无图片</span>
              </div>
            </div>
            <!-- 角标：型号分类 -->
            <Badge class="absolute left-1.5 top-1.5 bg-background/85 px-1.5 py-0.5 text-[10px] text-foreground backdrop-blur">
              {{ p.category }}
            </Badge>
          </div>

          <!-- 信息区 -->
          <CardContent class="space-y-1 p-2.5">
            <p class="truncate font-mono text-sm font-semibold leading-tight" :title="p.model">
              {{ p.model }}
            </p>
            <p v-if="p.remark" class="line-clamp-1 text-[11px] text-muted-foreground" :title="p.remark">
              {{ p.remark }}
            </p>
            <div class="flex items-center justify-between gap-1 pt-0.5 text-[11px]">
              <span class="text-muted-foreground">
                {{ p.conversion_rate }} <span class="text-[10px]">м²/ящ</span>
              </span>
              <span
                class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono font-semibold"
                :class="p.availableBoxes > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'"
              >
                <Box class="h-3 w-3" />
                {{ p.availableBoxes }}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 第 3 级：型号详情（hero + 色号卡片） -->
    <div v-else-if="view === 'colors' && selectedModel">
      <!-- Hero：型号大图 + 信息 -->
      <Card class="overflow-hidden">
        <div class="relative">
          <!-- 大图 / 占位 -->
          <div class="aspect-[2/1] w-full overflow-hidden bg-gradient-to-br from-muted via-muted/60 to-primary/5 sm:aspect-[2.5/1]">
            <img
              v-if="selectedModel.image_url"
              :src="selectedModel.image_url"
              :alt="selectedModel.model"
              class="h-full w-full object-cover"
            />
            <div v-else class="flex h-full w-full items-center justify-center">
              <div class="flex flex-col items-center gap-2 text-muted-foreground/40">
                <ImageOff class="h-12 w-12" />
                <span class="text-xs">暂无产品图</span>
              </div>
            </div>
          </div>
          <!-- 角标 -->
          <Badge class="absolute left-3 top-3 bg-background/90 px-2 py-0.5 text-xs backdrop-blur">
            {{ selectedModel.category }}
          </Badge>
        </div>

        <CardContent class="space-y-2 p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate font-mono text-xl font-semibold leading-tight" :title="selectedModel.model">
                {{ selectedModel.model }}
              </h2>
              <p v-if="selectedModel.remark" class="mt-0.5 text-xs text-muted-foreground">
                {{ selectedModel.remark }}
              </p>
            </div>
            <Badge variant="secondary" class="shrink-0">
              {{ colorsInModel.length }} {{ t('customer.catalog.colorsUnit') }}
            </Badge>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span class="inline-flex items-center gap-1 text-muted-foreground">
              <Box class="h-3.5 w-3.5" />
              {{ t('customer.catalog.totalBoxes') }}:
              <b class="font-mono text-foreground">{{ selectedModel.total_boxes_level1 + selectedModel.total_boxes_level2 }}</b>
            </span>
            <span class="inline-flex items-center gap-1 text-muted-foreground">
              <Hash class="h-3.5 w-3.5" />
              {{ selectedModel.conversion_rate }} м²/ящ
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- 色号网格 -->
      <div v-if="colorsInModel.length === 0" class="mt-4 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        暂无在售色号
      </div>
      <div v-else class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Card
          v-for="c in colorsInModel"
          :key="c.color_code + c.stock_level"
          class="overflow-hidden transition-all hover:border-primary/40 hover:shadow-sm"
          :class="cart.qtyOf(selectedModel.product_id) > 0 ? 'border-primary/40 bg-primary/5' : ''"
        >
          <CardContent class="p-2.5">
            <div class="flex items-start justify-between gap-1">
              <div class="min-w-0">
                <span class="font-mono text-base font-bold">{{ c.color_code }}</span>
                <Badge variant="outline" class="ml-1.5 h-4 px-1 text-[9px]">
                  L{{ c.stock_level }}
                </Badge>
              </div>
              <span
                class="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700"
              >
                {{ c.boxes }} {{ t('customer.catalog.box') }}
              </span>
            </div>
            <p class="mt-0.5 text-[10px] text-muted-foreground">
              ≈ {{ fmtM2(c.boxes * selectedModel.conversion_rate) }}
            </p>
            <div class="mt-2 flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                class="h-7 w-7"
                :disabled="cart.qtyOf(selectedModel.product_id) === 0"
                @click="onQty(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, -1)"
              >
                <Minus class="h-3.5 w-3.5" />
              </Button>
              <div class="flex h-7 flex-1 items-center justify-center rounded-md border bg-background font-mono text-sm font-semibold">
                {{ cart.qtyOf(selectedModel.product_id) }}
              </div>
              <Button
                size="icon"
                class="h-7 w-7"
                :disabled="cart.qtyOf(selectedModel.product_id) >= c.boxes"
                @click="onQty(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, 1)"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 购物车抽屉 -->
    <Dialog v-model:open="showCart" :title="t('customer.cart.title')">
      <div v-if="cart.items.value.length === 0" class="text-sm text-muted-foreground text-center py-6">
        {{ t('customer.cart.empty') }}
      </div>
      <ul v-else class="space-y-2 max-h-80 overflow-auto">
        <li
          v-for="c in cart.items.value"
          :key="c.product_id"
          class="flex items-center justify-between border rounded-md p-2"
        >
          <div class="min-w-0 flex-1">
            <p class="font-mono text-sm truncate">{{ c.model }}</p>
            <p class="text-xs text-muted-foreground">
              {{ c.boxes }} ящ. × {{ c.conversion_rate }} = {{ fmtM2(c.boxes * c.conversion_rate) }}
            </p>
          </div>
          <Button size="sm" variant="ghost" @click="cart.remove(c.product_id)">
            {{ t('customer.cart.remove') }}
          </Button>
        </li>
      </ul>

      <div v-if="cart.items.value.length > 0" class="mt-4 border-t pt-3 space-y-2">
        <div class="flex justify-between text-sm">
          <span class="text-muted-foreground">{{ t('customer.cart.totalBoxes') }}</span>
          <span class="font-medium">{{ cartTotalBoxes }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-muted-foreground">{{ t('customer.cart.totalM2') }}</span>
          <span class="font-medium">{{ fmtM2(cartTotalM2) }}</span>
        </div>
        <Button class="w-full" @click="router.push('/customer/checkout')">
          {{ t('customer.cart.checkout') }}
        </Button>
      </div>
    </Dialog>
  </div>
</template>