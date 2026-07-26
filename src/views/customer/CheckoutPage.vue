<!--
  src/views/customer/CheckoutPage.vue
  客户下单确认页（Phase 3 实装）
  - 展示购物车明细
  - 可选备注
  - 提交后跳转到订单详情
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ArrowLeft, Loader2, CheckCircle2, Star } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Label from '@/components/ui/Label.vue'
import Textarea from '@/components/ui/Textarea.vue'

import { useCart } from '@/composables/useCart'
import { useOrders } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'
import { useAccounts, type Account } from '@/composables/useAccounts'

const { t } = useI18n()
const router = useRouter()
const cart = useCart()
const orders = useOrders()
const { account } = useAuth()
const accs = useAccounts()

const remark = ref('')
const submitting = ref(false)
const errMsg = ref<string | null>(null)

// 子账户选择
const subs = ref<Account[]>([])
const subId = ref<string>('')
const loadingSubs = ref(false)

onMounted(async () => {
  if (!account.value) return
  loadingSubs.value = true
  try {
    subs.value = await accs.fetchSubAccounts(account.value.id)
    // 默认：主联系 true → 否则第一行
    const main = subs.value.find((s) => s.is_main)
    subId.value = main?.id ?? subs.value[0]?.id ?? ''
  } finally {
    loadingSubs.value = false
  }
})

const fmtM2 = (n: number) => `${n.toFixed(2)} м²`
const totalBoxes = computed(() => cart.totalBoxes())
const totalM2 = computed(() => cart.totalM2())

const canSubmit = computed(
  () => cart.items.value.length > 0 && !!account.value && !!subId.value,
)

const onSubmit = async () => {
  if (!account.value || !subId.value) return
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
      subId.value,
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
          <Label>下单子账号 *</Label>
          <div v-if="loadingSubs" class="text-xs text-muted-foreground py-2">
            <Loader2 class="inline h-3 w-3 mr-1 animate-spin" />加载子账号...
          </div>
          <div v-else-if="subs.length === 0" class="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md p-2">
            你的主账号下还没有子账号，无法下单。请联系管理员在"账号管理 → 加子账号"。
          </div>
          <div v-else class="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
            <label
              v-for="s in subs"
              :key="s.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/40 transition text-sm"
              :class="subId === s.id ? 'bg-primary/10' : ''"
            >
              <input type="radio" :value="s.id" v-model="subId" class="shrink-0" />
              <Star v-if="s.is_main" class="h-3 w-3 text-amber-500 shrink-0" />
              <span v-else class="w-3 shrink-0" />
              <span class="font-mono truncate flex-1">{{ s.account_name }}</span>
              <span v-if="s.inn && s.inn !== '-'" class="text-xs text-muted-foreground font-mono shrink-0">
                INN {{ s.inn }}
              </span>
              <Badge v-if="s.status === 'inactive'" class="bg-gray-200 text-gray-700 text-[10px]">停用</Badge>
            </label>
          </div>
          <p class="text-xs text-muted-foreground">
            选择了哪个子账号，此订单就归属哪个子账号
          </p>
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

      <Button class="w-full" size="lg" :disabled="!canSubmit || submitting" @click="onSubmit">
        <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
        <CheckCircle2 v-else class="mr-2 h-4 w-4" />
        {{ t('customer.checkout.submit') }}
      </Button>
    </template>
  </div>
</template>
