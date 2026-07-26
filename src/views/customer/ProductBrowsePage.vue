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
import { ChevronLeft, Search, Plus, Minus, ShoppingCart, Package } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import Dialog from '@/components/ui/Dialog.vue'

import { useAccountProducts } from '@/composables/useAccountProducts'
import { useProducts, type ProductWithColors } from '@/composables/useProducts'
import { useCart } from '@/composables/useCart'
import { useAuth } from '@/composables/useAuth'

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
  // admin 视角：直接拉全部商品（用 view，不走白名单）
  if (isAdmin.value) {
    try {
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
    } finally {
      loading.value = false
    }
    return
  }
  // 客户/审核员视角：拉白名单
  await ap.fetchForCurrentAccount()
  try {
    allProducts.value = await productsApi.fetchAllWithColors()
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

// 第 1 级：分类列表（按白名单聚合）
const categoriesWithCount = computed(() => {
  const map = new Map<string, number>()
  for (const row of ap.items.value) {
    if (!row.product) continue
    const cat = row.product.category
    map.set(cat, (map.get(cat) ?? 0) + 1)
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
})

// 第 2 级：选定分类下的型号列表（join 色号视图）
const modelsInCategory = computed(() => {
  if (!selectedCategory.value) return []
  const apMap = new Map<string, number>()  // product_id -> stock_level_1 + stock_level_2
  for (const row of ap.items.value) {
    if (!row.product) continue
    if (row.product.category !== selectedCategory.value) continue
    apMap.set(row.product.id, row.stock_level_1 + row.stock_level_2)
  }
  return allProducts.value
    .filter((p) => p.category === selectedCategory.value && apMap.has(p.product_id))
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

    <!-- 加载中 -->
    <div v-if="loading" class="text-center text-sm text-muted-foreground py-10">
      {{ t('common.loading') }}
    </div>

    <!-- 第 1 级：分类网格 -->
    <div v-else-if="view === 'categories'">
      <div v-if="categoriesWithCount.length === 0" class="text-center text-sm text-muted-foreground py-10">
        {{ t('customer.catalog.empty') }}
      </div>
      <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        <Card
          v-for="[cat, count] in categoriesWithCount"
          :key="cat"
          class="hover:bg-muted/50 transition cursor-pointer"
          @click="openCategory(cat)"
        >
          <CardContent class="p-3 text-center">
            <div class="text-lg font-mono font-semibold">{{ cat }}</div>
            <div class="text-xs text-muted-foreground mt-1">
              {{ count }} {{ t('customer.catalog.modelsUnit') }}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 第 2 级：型号列表 -->
    <ul v-else-if="view === 'models'" class="space-y-2">
      <li v-for="p in modelsInCategory" :key="p.product_id">
        <Card
          class="overflow-hidden hover:bg-muted/30 cursor-pointer"
          @click="openModel(p)"
        >
          <CardContent class="p-3">
            <div class="flex items-start gap-3">
              <div class="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Package class="h-4 w-4 text-muted-foreground" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="font-mono font-medium truncate">{{ p.model }}</p>
                  <Badge variant="outline" class="shrink-0 text-[10px]">{{ p.category }}</Badge>
                </div>
                <p v-if="p.remark" class="text-xs text-muted-foreground truncate">{{ p.remark }}</p>
                <div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{{ p.conversion_rate }} м²/ящ</span>
                  <span>
                    {{ t('customer.catalog.stock') }}:
                    <span class="font-medium text-foreground">{{ p.availableBoxes }}</span>
                  </span>
                  <span v-if="p.colors?.length" class="ml-auto text-emerald-600">
                    {{ p.colors.length }} {{ t('customer.catalog.colorsUnit') }}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </li>
      <li v-if="modelsInCategory.length === 0" class="text-center text-sm text-muted-foreground py-10">
        {{ t('customer.catalog.empty') }}
      </li>
    </ul>

    <!-- 第 3 级：色号列表 -->
    <div v-else-if="view === 'colors' && selectedModel">
      <Card class="mb-3">
        <CardContent class="p-3">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-mono font-semibold text-lg">{{ selectedModel.model }}</p>
              <p class="text-xs text-muted-foreground">
                {{ selectedModel.category }} ·
                {{ selectedModel.conversion_rate }} м²/ящ ·
                {{ t('customer.catalog.totalBoxes') }}: {{ selectedModel.total_boxes_level1 + selectedModel.total_boxes_level2 }}
              </p>
            </div>
            <Badge>{{ colorsInModel.length }} {{ t('customer.catalog.colorsUnit') }}</Badge>
          </div>
        </CardContent>
      </Card>

      <ul class="space-y-2">
        <li v-for="c in colorsInModel" :key="c.color_code + c.stock_level">
          <Card>
            <CardContent class="p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-mono font-semibold text-lg">{{ c.color_code }}</span>
                    <Badge variant="outline" class="text-[10px]">
                      L{{ c.stock_level }}
                    </Badge>
                  </div>
                  <p class="text-xs text-muted-foreground mt-1">
                    {{ t('customer.catalog.box') }}: {{ c.boxes }} ·
                    ≈ {{ fmtM2(c.boxes * selectedModel.conversion_rate) }}
                  </p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="outline"
                    class="h-9 w-9"
                    :disabled="cart.qtyOf(selectedModel.product_id) === 0"
                    @click="onQty(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, -1)"
                  >
                    <Minus class="h-4 w-4" />
                  </Button>
                  <div class="w-10 text-center font-medium">
                    {{ cart.qtyOf(selectedModel.product_id) }}
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    class="h-9 w-9"
                    :disabled="cart.qtyOf(selectedModel.product_id) >= c.boxes"
                    @click="onQty(selectedModel.product_id, selectedModel.model, selectedModel.conversion_rate, 1)"
                  >
                    <Plus class="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </li>
      </ul>
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