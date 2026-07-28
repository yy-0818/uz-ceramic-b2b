<!--
  src/views/customer/product-browse/CartDrawer.vue
  购物车抽屉 —— 列出已加商品 + 汇总 + 去结算
  父级：
    <CartDrawer v-model:open="showCart" :cart="cart" @checkout="goCheckout" />
-->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

import { useI18n } from '@/lib/i18n'
import type { useCart } from '@/composables/useCart'

const props = defineProps<{
  open: boolean
  // 完整 cart composable 实例（含 items/totalBoxes/totalM2/remove）
  cart: ReturnType<typeof useCart>
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'checkout'): void
}>()

const { t } = useI18n()

const fmtM2 = (n: number) => `${n.toFixed(2)} м²`
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="t('customer.cart.title')"
  >
    <div v-if="cart.items.value.length === 0" class="text-sm text-muted-foreground text-center py-6">
      {{ t('customer.cart.empty') }}
    </div>
    <ul v-else class="space-y-2 max-h-80 overflow-auto">
      <li
        v-for="c in cart.items.value" :key="c.product_id"
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
        <span class="font-medium">{{ cart.totalBoxes() }}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-muted-foreground">{{ t('customer.cart.totalM2') }}</span>
        <span class="font-medium">{{ fmtM2(cart.totalM2()) }}</span>
      </div>
      <Button class="w-full" @click="emit('checkout')">
        {{ t('customer.cart.checkoutBtn') }}
      </Button>
    </div>
  </Dialog>
</template>