<!--
  src/views/customer/CheckoutPage.vue
  客户下单确认页（Phase 3 实装）
  - 展示购物车明细
  - 可选备注
  - 提交后跳转到订单详情
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowLeft, Loader2, CheckCircle2 } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Textarea from '@/components/ui/Textarea.vue'

import { useCart } from '@/composables/useCart'
import { useOrders } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'

const { t } = useI18n()
const router = useRouter()
const cart = useCart()
const orders = useOrders()
const { account } = useAuth()

const remark = ref('')
const submitting = ref(false)
const errMsg = ref<string | null>(null)

const fmtM2 = (n: number) => `${n.toFixed(2)} м²`
const totalBoxes = computed(() => cart.totalBoxes())
const totalM2 = computed(() => cart.totalM2())

const onSubmit = async () => {
  if (cart.items.value.length === 0 || !account.value) return
  submitting.value = true
  errMsg.value = null
  try {
    const order = await orders.submit(
      account.value.id,
      cart.items.value.map((c) => ({
        product_id: c.product_id,
        model: c.model,
        boxes: c.boxes,
        conversion_rate: c.conversion_rate,
        stock_level: 1,
      })),
      remark.value.trim() || null,
    )
    cart.clear()
    router.push(`/orders/${order.id}`)
  } catch (e: unknown) {
    errMsg.value = e instanceof Error ? e.message : String(t('customer.checkout.submitFail'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex items-center gap-2">
      <Button size="icon" variant="ghost" @click="router.back()">
        <ArrowLeft class="h-5 w-5" />
      </Button>
      <h1 class="text-lg font-semibold">{{ t('customer.checkout.title') }}</h1>
    </header>

    <Card v-if="cart.items.value.length === 0">
      <CardContent class="py-10 text-center text-sm text-muted-foreground">
        {{ t('customer.cart.empty') }}
      </CardContent>
    </Card>

    <template v-else>
      <Card>
        <CardHeader>
          <CardTitle>{{ t('customer.checkout.items') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul class="divide-y">
            <li v-for="i in cart.items.value" :key="i.product_id" class="py-2 flex justify-between gap-3">
              <div class="min-w-0">
                <p class="font-mono text-sm truncate">{{ i.model }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ i.boxes }} ящ. × {{ i.conversion_rate }} м²
                </p>
              </div>
              <p class="font-medium text-sm shrink-0">{{ fmtM2(i.boxes * i.conversion_rate) }}</p>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="py-4 space-y-3 text-sm">
          <div class="flex justify-between">
            <span class="text-muted-foreground">{{ t('customer.cart.totalBoxes') }}</span>
            <span class="font-medium">{{ totalBoxes }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">{{ t('customer.cart.totalM2') }}</span>
            <span class="font-medium">{{ fmtM2(totalM2) }}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="py-4 space-y-2">
          <Label for="remark">{{ t('customer.checkout.remark') }}</Label>
          <Textarea
            id="remark"
            v-model="remark"
            :placeholder="t('customer.checkout.remarkPh')"
            class="min-h-20"
          />
        </CardContent>
      </Card>

      <p v-if="errMsg" class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
        {{ errMsg }}
      </p>

      <Button class="w-full" size="lg" :disabled="submitting" @click="onSubmit">
        <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
        <CheckCircle2 v-else class="mr-2 h-4 w-4" />
        {{ t('customer.checkout.submit') }}
      </Button>
    </template>
  </div>
</template>
