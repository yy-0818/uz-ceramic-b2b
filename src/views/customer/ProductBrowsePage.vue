<!--
  src/views/customer/ProductBrowsePage.vue
  客户"盲价列表" —— 移动端优先
  - 不显示单价
  - 按"整箱"下单（每箱 = conversion_rate 平方米）
  - 自动计算总面积 / 箱数
  - 加入购物车 → 进入下单确认
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Plus, Minus, ShoppingCart, Package } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import Dialog from '@/components/ui/Dialog.vue'

import { useAccountProducts } from '@/composables/useAccountProducts'
import { useCart } from '@/composables/useCart'

const { t } = useI18n()
const router = useRouter()
const ap = useAccountProducts()
const cart = useCart()

const search = ref('')
const category = ref<string>('all')
const showCart = ref(false)

const refresh = async () => ap.fetchForCurrentAccount()

const categories = computed(() => {
  const set = new Set<string>()
  ap.items.value.forEach((it) => it.product?.category && set.add(it.product.category))
  return ['all', ...Array.from(set).sort()]
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return ap.items.value.filter((it) => {
    if (!it.product) return false
    if (category.value !== 'all' && it.product.category !== category.value) return false
    if (q && !it.product.model.toLowerCase().includes(q)) return false
    return true
  })
})

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
  <div class="space-y-4" @vue:mounted="refresh">
    <!-- 头部 -->
    <header class="flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10 py-2">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">{{ t('customer.catalog.title') }}</h1>
        <p class="text-xs text-muted-foreground">{{ t('customer.catalog.subtitle') }}</p>
      </div>
      <Button
        size="icon"
        class="relative"
        @click="showCart = true"
      >
        <ShoppingCart class="h-5 w-5" />
        <span
          v-if="cartTotalBoxes > 0"
          class="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center"
        >
          {{ cartTotalBoxes }}
        </span>
      </Button>
    </header>

    <!-- 搜索 + 类别 -->
    <div class="flex gap-2">
      <div class="relative flex-1">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input v-model="search" :placeholder="t('customer.catalog.search')" class="pl-9 h-10" />
      </div>
    </div>
    <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
      <Button
        v-for="c in categories"
        :key="c"
        size="sm"
        :variant="category === c ? 'default' : 'outline'"
        class="shrink-0"
        @click="category = c"
      >
        {{ c === 'all' ? t('customer.catalog.allCategory') : c }}
      </Button>
    </div>

    <!-- 商品列表 -->
    <div v-if="ap.loading.value" class="text-center text-sm text-muted-foreground py-10">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="filtered.length === 0" class="text-center text-sm text-muted-foreground py-10">
      {{ t('customer.catalog.empty') }}
    </div>

    <ul v-else class="space-y-3">
      <li v-for="it in filtered" :key="it.account_id + it.product_id">
        <Card class="overflow-hidden">
          <CardContent class="p-3">
            <div class="flex items-start gap-3">
              <div class="h-12 w-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Package class="h-5 w-5 text-muted-foreground" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="font-mono font-medium truncate">{{ it.product?.model }}</p>
                  <Badge variant="secondary">{{ it.product?.category }}</Badge>
                </div>
                <p v-if="it.product?.remark" class="text-xs text-muted-foreground truncate">
                  {{ it.product.remark }}
                </p>
                <div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{{ t('customer.catalog.box') }}: {{ it.product?.conversion_rate }} м²</span>
                  <span>{{ t('customer.catalog.stock') }}:
                    <span class="font-medium text-foreground">{{ it.stock_level_1 + it.stock_level_2 }}</span>
                  </span>
                </div>
              </div>
            </div>

            <!-- 数量步进器 -->
            <div class="mt-3 flex items-center justify-between">
              <span class="text-xs text-muted-foreground">
                {{ t('customer.catalog.boxesTo', { n: cart.qtyOf(it.product!.id) }) }}
              </span>
              <div class="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  class="h-9 w-9"
                  :disabled="cart.qtyOf(it.product!.id) === 0"
                  @click="onQty(it.product!.id, it.product!.model, it.product!.conversion_rate, -1)"
                >
                  <Minus class="h-4 w-4" />
                </Button>
                <div class="w-10 text-center font-medium">
                  {{ cart.qtyOf(it.product!.id) }}
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-9 w-9"
                  :disabled="cart.qtyOf(it.product!.id) >= (it.stock_level_1 + it.stock_level_2)"
                  @click="onQty(it.product!.id, it.product!.model, it.product!.conversion_rate, 1)"
                >
                  <Plus class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </li>
    </ul>

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
