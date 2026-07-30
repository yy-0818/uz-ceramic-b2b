<!--
  src/views/customer/ProductBrowsePage.vue
  客户"盲价列表" —— 移动端优先 + 三级导航
  - 第 1 级：瓷砖分类 (12J / 12P / 12F ...)
  - 第 2 级：型号 (A12P001)
  - 第 3 级：色号 (D1 D2 ... A1 ...) + 该色号箱数
  - 不显示单价；按"整箱"下单；每箱 = conversion_rate 平方米
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch, reactive, nextTick } from 'vue'
import { Search, Plus, Minus, ChevronLeft, Package, ImageOff, Box, Tag, Hash, ShoppingCart, Trash2, X } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import CategoryCardSkeleton from '@/components/ui/CategoryCardSkeleton.vue'
import ModelCardSkeleton from '@/components/ui/ModelCardSkeleton.vue'

import { useAccountProducts } from '@/composables/useAccountProducts'
import { useProducts, type ProductWithColors } from '@/composables/useProducts'
import { useCart, type CartItem } from '@/composables/useCart'
import { useAuth } from '@/composables/useAuth'
import { supabase } from '@/lib/supabase'

const { t } = useI18n()
const router = useRouter()
const ap = useAccountProducts()
const productsApi = useProducts()
const cart = useCart()
const { isAdmin } = useAuth()
type CartRow = CartItem

const allProducts = ref<ProductWithColors[]>([])

const refresh = async () => {
  // admin 视角：直接拉全部商品
  if (isAdmin.value) {
    allProducts.value = await productsApi.fetchAllWithColors()
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
    return
  }
  // 客户/审核员视角：按 stock_group 白名单
  // 1. 拿到当前父账号绑定的所有库存组
  const { data: groups } = await supabase
    .from('customer_group_mappings')
    .select('customer_group')
    .eq('is_active', true)
  const myGroups = (groups ?? []).map((r: any) => r.customer_group)
  if (myGroups.length === 0) {
    ap.items.value = []
    allProducts.value = []
    return
  }
  // 2. 拉这些组的所有 product
  const { data: prods } = await supabase
    .from('products')
    .select('*')
    .in('stock_group', myGroups)
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
}

onMounted(refresh)

// 三级状态
const view = ref<'categories' | 'models' | 'colors'>('categories')
const selectedCategory = ref<string>('')
const selectedModel = ref<ProductWithColors | null>(null)
const search = ref('')
const cartDetailOpen = ref(false)     // 详情面板是否展开（FAB 直接触发）

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

// 路由跳转前先把购物车抽屉关掉：抽屉是 fixed 定位 + z-50，
// 若开着就路由切换，Transition leave 动画跑 200ms，期间抽屉仍浮在
// 新页面之上，会让用户感觉"点了但没反应"。先关再 push 顺手解决。
const goCheckout = async () => {
  // 1. 先关抽屉 (避免抽屉 leave (180ms) 与 page-transition leave 重叠)
  cartDetailOpen.value = false
  // 2. 等一帧 + drawer leave 时长,确保抽屉已经在视觉上离场
  await new Promise((r) => setTimeout(r, 220))
  // 3. 跳转到 checkout (此时 page-transition leave 已被配置为 0ms,
  //    见 PageTransition.vue, 不再与 router 争抢时机)
  // 注意: 路由表里 checkout 用的是相对路径 path: 'checkout',
  // 全路径是 /checkout, 不是 /customer/checkout.
  router.push('/checkout')
}

const fmtM2 = (n: number) => `${n.toFixed(2)} м²`
const cartTotalBoxes = computed(() => cart.totalBoxes())
const cartTotalM2 = computed(() => cart.totalM2())
const cartHasItems = computed(() => cartTotalBoxes.value > 0)
const cartItemsCount = computed(() => cart.items.value.length)

// 全局统计：白名单里有多少型号 / 多少箱 / 多少色号
const totalModels = computed(() => ap.items.value.filter((r) => r.product).length)
const totalBoxes = computed(() =>
  ap.items.value.reduce((s, r) => s + r.stock_level_1 + r.stock_level_2, 0),
)
const totalColors = computed(() => {
  const fullMap = new Map<string, ProductWithColors>()
  for (const p of allProducts.value) fullMap.set(p.product_id, p)
  const set = new Set<string>()
  for (const row of ap.items.value) {
    if (!row.product) continue
    const full = fullMap.get(row.product.id)
    for (const c of full?.colors ?? []) {
      if (c.boxes > 0) set.add(`${row.product.id}:${c.color_code}`)
    }
  }
  return set.size
})

// 购物车清空后，关闭详情面板（避免空列表浮在屏上）。
watch(cartItemsCount, (n) => {
  if (n === 0) cartDetailOpen.value = false
})

// 关闭详情面板前，把所有未提交的草稿一次性收敛进 cart，避免用户
// 改了数字但没点 -/+/blur 就关掉面板，导致键入的数字被静默丢弃。
watch(cartDetailOpen, (open) => {
  if (open) return
  for (const item of cart.items.value) {
    const k = cart.keyOf(item)
    if (lineDrafts.has(k)) commitLineDraft(item)
  }
})

// 切换 selectedModel 时清掉所有草稿：旧 product_id 的草稿已不被任何
// input 引用，留着只是内存垃圾，并且如果用户后退到旧 model 也不会
// 看到陈旧输入。
watch(
  () => selectedModel.value?.product_id,
  (id, prev) => {
    if (!id && !prev) return
    const toCheck = new Set<string>()
    if (prev) for (const k of lineDrafts.keys()) if (k.startsWith(prev + '::')) toCheck.add(k)
    if (id)   for (const k of lineDrafts.keys()) if (k.startsWith(id + '::'))   toCheck.add(k)
    for (const k of toCheck) clearDraft(k)
  },
)

// 在详情面板里调整单条数量：超过该色号可用箱数则限制。
const onLineQty = (item: CartRow, delta: number) => {
  const next = Math.max(0, item.boxes + delta)
  if (next === 0) cart.remove(item.product_id, item.color_code, item.stock_level)
  else cart.setQty(item.product_id, item.model, item.conversion_rate, next, item.color_code, item.stock_level)
}

// 详情面板里调整数量时需找到该商品对应色号的库存上限。
// （按 (product, color, level) 精确定位）
const stockForColor = (productId: string, colorCode: string, stockLevel: number) => {
  const full = allProducts.value.find((p) => p.product_id === productId)
  if (!full) return 0
  const c = (full.colors ?? []).find((x) => x.color_code === colorCode && x.stock_level === stockLevel)
  return c?.boxes ?? 0
}

// 聚合读：整商品的总库存（用于详情面板的 max 兜底 / 上限提示）
const stockFor = (productId: string) => {
  const full = allProducts.value.find((p) => p.product_id === productId)
  return full ? full.total_boxes_level1 + full.total_boxes_level2 : 0
}

/** 用 (product, color, level) 生成的草稿 key */
type ColorKey = string
const lineDrafts = reactive(new Map<ColorKey, string>())
const draftKey = (productId: string, colorCode: string, stockLevel: number) =>
  `${productId}::${colorCode}::${stockLevel}`

const draftOf = (productId: string, colorCode: string, stockLevel: number, fallback: number) =>
  lineDrafts.get(draftKey(productId, colorCode, stockLevel)) ?? String(fallback)

const setDraft = (productId: string, colorCode: string, stockLevel: number, value: string) => {
  const k = draftKey(productId, colorCode, stockLevel)
  if (value === '' || /^\d+$/.test(value)) lineDrafts.set(k, value)
  else lineDrafts.set(k, lineDrafts.get(k) ?? '0')
}

const clearDraft = (k: ColorKey) => lineDrafts.delete(k)
const clearDraftForColor = (productId: string, colorCode: string, stockLevel: number) =>
  lineDrafts.delete(draftKey(productId, colorCode, stockLevel))

/** 详情面板里某行（cart item）的草稿提交 */
const commitLineDraft = (item: CartRow) => {
  const k = draftKey(item.product_id, item.color_code, item.stock_level)
  const raw = lineDrafts.get(k)
  clearDraft(k)
  if (raw === undefined) return
  let n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) n = 0
  const max = stockForColor(item.product_id, item.color_code, item.stock_level)
  if (n > max) n = max
  if (n === item.boxes) return
  if (n === 0) cart.remove(item.product_id, item.color_code, item.stock_level)
  else cart.setQty(item.product_id, item.model, item.conversion_rate, n, item.color_code, item.stock_level)
}

// - / + 点击：先把任何未提交的草稿收敛，再调整（避免点击时草稿被无视）。
const onLineBtn = (item: CartRow, delta: number) => {
  const k = draftKey(item.product_id, item.color_code, item.stock_level)
  if (lineDrafts.has(k)) commitLineDraft(item)
  onLineQty(item, delta)
}

// 模型/色号视图的草稿提交：输入上限是该色号的可用箱数（参数传入），
// 且当前购物车值用 cart.qtyOfColor 读，不依赖 items 对象。
const commitModelDraft = (
  productId: string,
  model: string,
  conversionRate: number,
  colorCode: string,
  stockLevel: number,
  maxBoxes: number,
) => {
  const k = draftKey(productId, colorCode, stockLevel)
  const raw = lineDrafts.get(k)
  clearDraft(k)
  if (raw === undefined) return
  let n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) n = 0
  if (n > maxBoxes) n = maxBoxes
  const cur = cart.qtyOfColor(productId, colorCode, stockLevel)
  if (n === cur) return
  if (n === 0) cart.remove(productId, colorCode, stockLevel)
  else cart.setQty(productId, model, conversionRate, n, colorCode, stockLevel)
}

// 模型视图的 -/+：先 flush 草稿，再 ±1。
const onModelQty = (
  productId: string,
  model: string,
  conversionRate: number,
  colorCode: string,
  stockLevel: number,
  delta: number,
) => {
  const k = draftKey(productId, colorCode, stockLevel)
  if (lineDrafts.has(k)) {
    commitModelDraft(productId, model, conversionRate, colorCode, stockLevel, stockForColor(productId, colorCode, stockLevel))
  }
  const cur = cart.qtyOfColor(productId, colorCode, stockLevel)
  const next = Math.max(0, cur + delta)
  if (next === 0) cart.remove(productId, colorCode, stockLevel)
  else cart.setQty(productId, model, conversionRate, next, colorCode, stockLevel)
}
</script>

<template>
  <div class="space-y-3 pb-24">
    <!-- 头部：面包屑 + 搜索（仅 categories 视图显示 totals 摘要） -->
    <header class="sticky top-0 z-10 bg-background/95 backdrop-blur">
      <div class="flex items-center justify-between gap-2 py-2">
        <div class="flex items-center gap-2 min-w-0">
          <Button v-if="view !== 'categories'" size="icon" variant="ghost" class="h-8 w-8 shrink-0" @click="back">
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
      </div>

      <!-- 总览统计条（仅 categories 视图显示，让用户对库容一目了然） -->
      <div
        v-if="view === 'categories'"
        class="grid grid-cols-3 gap-2 border-y bg-muted/30 px-1 py-2 text-center"
      >
        <div>
          <p class="font-mono text-base font-bold leading-none">{{ totalModels }}</p>
          <p class="mt-0.5 text-[10px] text-muted-foreground">{{ t('customer.catalog.modelsUnit') }}</p>
        </div>
        <div class="border-x">
          <p class="font-mono text-base font-bold leading-none text-emerald-600 dark:text-emerald-400">
            {{ totalBoxes.toLocaleString() }}
          </p>
          <p class="mt-0.5 text-[10px] text-muted-foreground">{{ t('customer.catalog.box') }}</p>
        </div>
        <div>
          <p class="font-mono text-base font-bold leading-none text-blue-600 dark:text-blue-400">
            {{ totalColors }}
          </p>
          <p class="mt-0.5 text-[10px] text-muted-foreground">{{ t('customer.catalog.colorsUnit') }}</p>
        </div>
      </div>
    </header>

    <!-- 搜索（仅 models 视图需要） -->
    <div v-if="view === 'models'" class="relative">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input v-model="search" :placeholder="t('customer.catalog.search')" class="pl-9 h-10" />
    </div>

    <!-- 骨架屏：只在单例 composable 从未拉取过数据时显示（已拉取过则直接渲染缓存） -->
    <div v-if="!productsApi.fetched.value" class="space-y-4">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <CategoryCardSkeleton v-for="i in 6" :key="i" />
      </div>
    </div>

    <!-- 第 1 级：分类网格 -->
    <div v-else-if="view === 'categories'">
      <!-- 智能空状态：区分"全库空" vs "白名单空" vs "分类未映射" -->
      <div v-if="categoriesWithCount.length === 0" class="space-y-3 py-10">
        <!-- admin：库里压根没商品 -->
        <div v-if="isAdmin && allProducts.length === 0"
          class="text-center text-sm text-muted-foreground border border-dashed rounded-lg p-6">
          <p class="font-medium text-foreground">{{ t('customer.catalog.emptyNoProducts') }}</p>
          <p class="mt-1"><span v-html="t('customer.catalog.emptyNoProductsHint', { path: '/admin/import' })"></span></p>
        </div>
        <!-- admin：有商品 → admin 视角下理论上能看到全部 -->
        <div v-else-if="isAdmin && allProducts.length > 0"
          class="text-center text-sm text-amber-800 border border-amber-200 bg-amber-50 rounded-lg p-6">
          <p class="font-medium">⚠ {{ t('customer.catalog.emptyAdminVisible', { n: allProducts.length }) }}</p>
          <p class="mt-1 text-xs"><span v-html="t('customer.catalog.emptyAdminHint')"></span></p>
        </div>
        <!-- 客户：白名单为空 -->
        <div v-else
          class="text-center text-sm text-muted-foreground border border-dashed rounded-lg p-6">
          <p class="font-medium text-foreground">{{ t('customer.catalog.emptyNoAccess') }}</p>
          <p class="mt-1">{{ t('customer.catalog.emptyNoAccessHint') }}</p>
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
                  {{ t('customer.catalog.classification') }}
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
          {{ search ? t('customer.catalog.searchNotFound', { q: search }) : t('customer.catalog.empty') }}
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
                <span class="text-[10px]">{{ t('customer.catalog.noImage') }}</span>
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
                <span class="text-xs">{{ t('customer.catalog.noModelImage') }}</span>
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
        {{ t('customer.catalog.noColors') }}
      </div>
      <div v-else class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Card
          v-for="c in colorsInModel"
          :key="c.color_code + c.stock_level"
          class="overflow-hidden transition-all hover:border-primary/40 hover:shadow-sm"
          :class="cart.qtyOfColor(selectedModel.product_id, c.color_code, c.stock_level) > 0 ? 'border-primary/40 bg-primary/5' : ''"
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
                :disabled="Number(draftOf(selectedModel.product_id, c.color_code, c.stock_level, cart.qtyOfColor(selectedModel.product_id, c.color_code, c.stock_level))) === 0"
                @click="onModelQty(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, c.color_code, c.stock_level, -1)"
              >
                <Minus class="h-3.5 w-3.5" />
              </Button>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                :max="c.boxes"
                :value="draftOf(selectedModel.product_id, c.color_code, c.stock_level, cart.qtyOfColor(selectedModel.product_id, c.color_code, c.stock_level))"
                :aria-label="t('customer.cart.qty')"
                class="h-7 w-full rounded-md border bg-background text-center font-mono text-sm font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                @input="setDraft(selectedModel.product_id, c.color_code, c.stock_level, ($event.target as HTMLInputElement).value)"
                @blur="commitModelDraft(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, c.color_code, c.stock_level, c.boxes)"
                @keydown.enter.prevent="commitModelDraft(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, c.color_code, c.stock_level, c.boxes); ($event.target as HTMLInputElement).blur()"
              />
              <Button
                size="icon"
                class="h-7 w-7"
                :disabled="Number(draftOf(selectedModel.product_id, c.color_code, c.stock_level, cart.qtyOfColor(selectedModel.product_id, c.color_code, c.stock_level))) >= c.boxes"
                @click="onModelQty(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, c.color_code, c.stock_level, 1)"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!--
      购物车 FAB + 详情面板（catalog 专属）

      状态机：
        cart empty                → 全部不渲染
        cart has items, panel off → FAB 在右下角（带箱数角标）
        cart has items, panel on  → 详情面板从屏外滑入（位于 FAB 上方），
                                    显示购物车明细（每行 -/+ 调整 + 删除），
                                    底部带汇总和去结算

      点 FAB → 详情面板打开；点面板 ✕ / 遮罩 / 清空购物车 → 关闭。
    -->
    <template v-if="cartHasItems">
      <!-- 遮罩：详情面板打开时浮起 -->
      <Transition
        enter-active-class="transition-opacity duration-200 ease-out"
        leave-active-class="transition-opacity duration-150 ease-in"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="cartDetailOpen"
          class="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
          aria-hidden="true"
          @click="cartDetailOpen = false"
        />
      </Transition>

      <!-- FAB：右下角圆形按钮（带箱数角标）。点击直接展开详情面板。 -->
      <button
        type="button"
        class="fixed right-4 bottom-14 md:bottom-6 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition active:scale-95"
        :class="cartDetailOpen ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'"
        :aria-label="t('common.cart')"
        @click="cartDetailOpen = true"
      >
        <ShoppingCart class="h-6 w-6 transition-transform" />
        <span class="absolute -top-1 -right-1 h-6 min-w-6 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-mono font-semibold">
          {{ cartItemsCount }}
        </span>
      </button>

      <!-- 详情面板：从屏外滑入，位于 FAB 上方 -->
      <Transition
        enter-active-class="transition-all duration-260 ease-out"
        leave-active-class="transition-all duration-180 ease-in"
        enter-from-class="translate-y-full opacity-0"
        leave-to-class="translate-y-full opacity-0"
      >
        <div
          v-if="cartDetailOpen"
          class="fixed inset-x-0 bottom-14 md:bottom-4 z-50 px-4 pointer-events-none"
        >
          <div
            class="mx-auto max-w-screen-md bg-background rounded-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden flex flex-col pointer-events-auto"
            style="max-height: min(70vh, 36rem)"
          >
            <!-- 顶部把手 + 标题 + 关闭 -->
            <div class="shrink-0 relative">
              <div class="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <div class="flex items-center justify-between px-4 pt-3 pb-2">
                <p class="text-sm font-semibold">
                  {{ t('customer.cart.title') }}
                  <span class="text-muted-foreground font-normal">· {{ cartItemsCount }}</span>
                </p>
                <button
                  type="button"
                  class="grid h-7 w-7 place-items-center rounded-md hover:bg-muted transition"
                  :aria-label="t('common.close')"
                  @click="cartDetailOpen = false"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>

            <!-- 明细列表（可滚动） -->
            <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-2">
              <ul class="space-y-1.5">
                <li
                  v-for="c in cart.items.value"
                  :key="cart.keyOf(c)"
                  class="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
                >
                  <!-- 信息 -->
                  <div class="min-w-0 flex-1">
                    <p class="font-mono text-sm font-semibold truncate" :title="c.model">{{ c.model }}</p>
                    <p class="text-[11px] text-muted-foreground mt-0.5">
                      <span class="font-mono">{{ c.color_code }}</span> · L{{ c.stock_level }} · {{ c.conversion_rate }} м²/ящ · ≈ {{ fmtM2(c.boxes * c.conversion_rate) }}
                    </p>
                  </div>
                  <!-- 步进器：[-] [input] [+]，中间是可直接键入的数量框 -->
                  <div class="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      class="grid h-7 w-7 place-items-center rounded-md border bg-background hover:bg-muted transition active:scale-95 disabled:opacity-40 disabled:hover:bg-background"
                      :disabled="draftOf(c.product_id, c.color_code, c.stock_level, c.boxes) === '0'"
                      :aria-label="t('common.decrease')"
                      @click="onLineBtn(c, -1)"
                    >
                      <Minus class="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      inputmode="numeric"
                      min="0"
                      :max="stockForColor(c.product_id, c.color_code, c.stock_level)"
                      :value="draftOf(c.product_id, c.color_code, c.stock_level, c.boxes)"
                      :aria-label="t('customer.cart.qty')"
                      class="h-7 w-12 rounded-md border bg-background text-center font-mono text-sm font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                      @input="setDraft(c.product_id, c.color_code, c.stock_level, ($event.target as HTMLInputElement).value)"
                      @blur="commitLineDraft(c)"
                      @keydown.enter.prevent="commitLineDraft(c); ($event.target as HTMLInputElement).blur()"
                    />
                    <button
                      type="button"
                      class="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition active:scale-95 disabled:opacity-40"
                      :disabled="Number(draftOf(c.product_id, c.color_code, c.stock_level, c.boxes)) >= stockForColor(c.product_id, c.color_code, c.stock_level)"
                      :aria-label="t('common.increase')"
                      @click="onLineBtn(c, 1)"
                    >
                      <Plus class="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <!-- 移除 -->
                  <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition active:scale-95 shrink-0"
                    :aria-label="t('customer.cart.remove')"
                    @click="cart.remove(c.product_id, c.color_code, c.stock_level)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </li>
              </ul>
            </div>

            <!-- 底部汇总 + 去结算 -->
            <div class="shrink-0 border-t bg-muted/30 px-4 py-3 space-y-2">
              <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{{ t('customer.cart.totalBoxes') }}</span>
                <span class="font-mono font-semibold">{{ cartTotalBoxes }}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{{ t('customer.cart.totalM2') }}</span>
                <span class="font-mono font-semibold">{{ fmtM2(cartTotalM2) }}</span>
              </div>
              <Button class="w-full h-11 font-medium" @click="goCheckout">
                {{ t('customer.cart.checkoutBtn') }}
              </Button>
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>