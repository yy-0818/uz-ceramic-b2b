<!--
  src/views/customer/CheckoutPage.vue
  客户下单确认页（美化版）

  布局：
    顶部 hero：步骤指示器 + 标题 + 副标题
    桌面端（md+）：左右两栏
      左主区：商品明细 → 子账号选择 → 备注
      右 sticky：订单汇总（总价 / 提交按钮）
    移动端：单列堆叠，底部 sticky 摘要条

  视觉：
    - 商品表格化，行间分隔用 muted/40，密度紧凑
    - 子账号卡片化，整卡可点击，选中态 ring + primary/5
    - 主联系子账号带金色 Star + "主联系" Badge
    - 空购物车：SVG 插画 + 双按钮（去选购 / 回到订单）
    - 错误条：destructive/10 + AlertCircle 图标
    - 步骤条：1)购物车 ✓ 2)确认订单（当前） 3)报价 & 付款
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Star,
  ShoppingCart,
  Package,
  Receipt,
  Users,
  MessageSquare,
  Paperclip,
  ChevronRight,
  AlertCircle,
  Check,
  Circle,
  ImagePlus,
  X,
  Upload,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Label from '@/components/ui/Label.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Badge from '@/components/ui/Badge.vue'

import { useCart } from '@/composables/useCart'
import { useOrders } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'
import { useAccounts, type Account } from '@/composables/useAccounts'
import {
  useOrderAttachments,
  attachToOrder,
  removePending,
} from '@/composables/useOrderAttachments'

const { t } = useI18n()
const router = useRouter()
const cart = useCart()
const orders = useOrders()
const { account } = useAuth()
const accs = useAccounts()
const attachments = useOrderAttachments()

const remark = ref('')
const submitting = ref(false)
const errMsg = ref<string | null>(null)

const subs = ref<Account[]>([])
const subId = ref<string>('')
const loadingSubs = ref(false)

const parentAccountId = computed(() => account.value?.parent_id ?? account.value?.id ?? null)

const loadSubs = async (parentId: string) => {
  loadingSubs.value = true
  try {
    subs.value = await accs.fetchSubAccounts(parentId)
    const main = subs.value.find((s) => s.is_main)
    subId.value = main?.id ?? subs.value[0]?.id ?? ''
  } finally {
    loadingSubs.value = false
  }
}

watch(
  () => parentAccountId.value,
  (id) => { if (id) loadSubs(id) },
  { immediate: true },
)

onMounted(() => {
  if (parentAccountId.value) loadSubs(parentAccountId.value)
})

const fmtM2 = (n: number) => `${n.toFixed(2)} м²`
const totalBoxes = computed(() => cart.totalBoxes())
const totalM2 = computed(() => cart.totalM2())
const itemsCount = computed(() => cart.items.value.length)

const canSubmit = computed(
  () => itemsCount.value > 0 && !!parentAccountId.value && !!subId.value,
)

// 文件输入引用
const fileInput = ref<HTMLInputElement | null>(null)
const attachmentError = ref<string | null>(null)

const MAX_ATTACHMENTS = 5
const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

const onPickClick = () => {
  if (attachments.items.value.length >= MAX_ATTACHMENTS) {
    attachmentError.value = t('customer.checkout.attachmentsMaxReached')
    return
  }
  fileInput.value?.click()
}

const onFiles = async (files: FileList | null) => {
  if (!files || files.length === 0) return
  attachmentError.value = null
  const accountId = parentAccountId.value
  if (!accountId) {
    attachmentError.value = '缺少主账号 id,无法上传'
    return
  }
  const accepted = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.items.value.length)
  for (const file of accepted) {
    if (!ALLOWED_MIME.includes(file.type)) {
      attachmentError.value = t('customer.checkout.attachmentsBadType')
      continue
    }
    if (file.size > MAX_BYTES) {
      attachmentError.value = t('customer.checkout.attachmentsTooBig')
      continue
    }
    try {
      await attachments.add(file, accountId)
    } catch (e: any) {
      attachmentError.value = e?.message ?? String(e)
    }
  }
  if (fileInput.value) fileInput.value.value = ''   // 清空 input 允许重选同一文件
}

const onDrop = async (ev: DragEvent) => {
  ev.preventDefault()
  await onFiles(ev.dataTransfer?.files ?? null)
}
const onDragOver = (ev: DragEvent) => {
  ev.preventDefault()
}

const fmtSize = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const onSubmit = async () => {
  if (!parentAccountId.value || !subId.value) return
  submitting.value = true
  errMsg.value = null
  let createdOrderId: string | null = null
  try {
    const order = await orders.submit(
      parentAccountId.value,
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
    createdOrderId = order.id

    // 订单已创建 → 把已上传的 pending 附件绑定上去
    const successful = attachments.successful.value
    if (successful.length > 0) {
      try {
        await attachToOrder(successful, {
          orderId: order.id,
          accountId: parentAccountId.value,
        })
      } catch (attachErr: any) {
        // 附件绑定失败不应阻塞订单跳转, 但要明确提示
        errMsg.value = `订单已创建,但附件绑定失败: ${attachErr?.message ?? attachErr}`
      }
    }

    cart.clear()
    // 离开页面再 reset, 否则本地预览图会立刻 revoke 不优雅
    void attachments.reset()
    router.push(`/orders/${order.id}/pay`)
  } catch (e: unknown) {
    errMsg.value = e instanceof Error ? e.message : String(t('customer.checkout.submitFail'))
  } finally {
    submitting.value = false
    // 订单成功 → 不要再 reset(successful 已经 attach 上去了)
    void createdOrderId
  }
}

// 当前选中的子账号（用于 sticky 摘要显示）
const selectedSub = computed(() => subs.value.find((s) => s.id === subId.value))
</script>

<template>
  <!--
    pb-32 给移动端底部 sticky 摘要留出空间（64 + 16 = 80 ≈ 5rem），
    pb-4 是桌面端，无 sticky 摘要。lg+ 也不需要 sticky 但有视觉留白
  -->
  <div class="space-y-5 pb-4 lg:pb-0 lg:pb-20">
    <!-- 顶部 hero 区 -->
    <header class="space-y-3">
      <div class="flex items-center gap-2">
        <Button size="icon" variant="ghost" @click="router.back()">
          <ArrowLeft class="h-5 w-5" />
        </Button>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium tracking-wider text-primary uppercase">
            {{ t('customer.checkout.stepLabel') }}
          </p>
          <h1 class="text-xl sm:text-2xl font-bold leading-tight">
            {{ t('customer.checkout.stepTitle') }}
          </h1>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ t('customer.checkout.stepHint') }}
          </p>
        </div>
      </div>

      <!-- 步骤条：购物车(✓) → 确认(当前) → 报价 -->
      <div class="flex items-center gap-2 text-xs">
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 class="h-4 w-4 text-emerald-600" />
          <span>{{ t('customer.checkout.stepCart') }}</span>
        </div>
        <div class="flex-1 h-px bg-border" />
        <div class="flex items-center gap-1.5 text-foreground font-medium">
          <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
          <span>{{ t('customer.checkout.stepConfirm') }}</span>
        </div>
        <div class="flex-1 h-px bg-border" />
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <Circle class="h-4 w-4" />
          <span>{{ t('customer.checkout.stepPay') }}</span>
        </div>
      </div>
    </header>

    <!-- 空购物车 -->
    <Card v-if="itemsCount === 0" class="overflow-hidden">
      <CardContent class="py-10 px-6 text-center space-y-5">
        <div class="mx-auto h-24 w-24 rounded-full bg-muted/50 flex items-center justify-center">
          <ShoppingCart class="h-12 w-12 text-muted-foreground/40" />
        </div>
        <div class="space-y-1.5">
          <p class="font-semibold text-base">{{ t('customer.checkout.emptyCartTitle') }}</p>
          <p class="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            {{ t('customer.checkout.emptyCartHint') }}
          </p>
        </div>
        <div class="flex items-center justify-center gap-2 pt-1">
          <Button size="sm" variant="outline" @click="router.push('/orders')">
            {{ t('orders.title') }}
          </Button>
          <Button size="sm" @click="router.push('/catalog')">
            {{ t('customer.checkout.emptyCartBack') }}
            <ChevronRight class="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 主区：左右两栏 (lg+) / 单列堆叠 (mobile) -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
      <!-- 左侧：明细 + 子账号 + 备注 -->
      <div class="space-y-5 min-w-0">
        <!-- 商品明细 -->
        <Card>
          <CardContent class="p-0">
            <div class="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b bg-muted/30">
              <Package class="h-4 w-4 text-primary" />
              <h2 class="font-semibold text-sm">
                {{ t('customer.checkout.items') }}
              </h2>
              <Badge variant="secondary" class="ml-auto">
                {{ itemsCount }} {{ t('customer.checkout.itemsCount') }}
              </Badge>
            </div>

            <!-- 表头 (md+) -->
            <div class="hidden md:grid grid-cols-[1fr_100px_120px_120px] gap-3 px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground border-b">
              <span>Модель</span>
              <span class="text-right">Кол-во ящ.</span>
              <span class="text-right">м² / ящ.</span>
              <span class="text-right">Итого м²</span>
            </div>

            <ul class="divide-y divide-border/60">
              <li
                v-for="(i, idx) in cart.items.value"
                :key="i.product_id"
                class="px-4 sm:px-5 py-3 hover:bg-muted/20 transition"
              >
                <!-- 桌面：表格行 -->
                <div class="hidden md:grid grid-cols-[1fr_100px_120px_120px] gap-3 items-center">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="h-6 w-6 rounded-md bg-primary/10 text-primary text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                      {{ idx + 1 }}
                    </span>
                    <p class="font-mono text-sm font-medium truncate">{{ i.model }}</p>
                  </div>
                  <p class="text-right font-medium tabular-nums">
                    {{ i.boxes }} <span class="text-xs text-muted-foreground">ящ.</span>
                  </p>
                  <p class="text-right text-sm tabular-nums text-muted-foreground">
                    {{ i.conversion_rate.toFixed(2) }}
                  </p>
                  <p class="text-right font-semibold tabular-nums">
                    {{ fmtM2(i.boxes * i.conversion_rate) }}
                  </p>
                </div>
                <!-- 移动：堆叠卡片行 -->
                <div class="md:hidden space-y-1.5">
                  <div class="flex items-center gap-2">
                    <span class="h-5 w-5 rounded bg-primary/10 text-primary text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                      {{ idx + 1 }}
                    </span>
                    <p class="font-mono text-sm font-medium truncate flex-1">{{ i.model }}</p>
                    <p class="font-semibold tabular-nums shrink-0">
                      {{ fmtM2(i.boxes * i.conversion_rate) }}
                    </p>
                  </div>
                  <p class="text-xs text-muted-foreground pl-7">
                    {{ i.boxes }} ящ. × {{ i.conversion_rate.toFixed(2) }} м²
                  </p>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>

        <!-- 子账号选择（卡片化） -->
        <Card>
          <CardContent class="p-0">
            <div class="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b bg-muted/30">
              <Users class="h-4 w-4 text-primary" />
              <h2 class="font-semibold text-sm">
                {{ t('customer.checkout.subAccountLabel') }}
              </h2>
              <span class="text-[10px] font-medium text-destructive uppercase tracking-wider ml-1">
                {{ t('customer.checkout.subAccountRequired') }}
              </span>
            </div>

            <div class="p-4 sm:p-5 space-y-3">
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('customer.checkout.subAccountHint') }}
              </p>

              <!-- 加载态 -->
              <div v-if="loadingSubs" class="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <Loader2 class="h-4 w-4 animate-spin" />
                {{ t('customer.checkout.loadingSubs') }}
              </div>

              <!-- 空状态（无子账号） -->
              <div
                v-else-if="subs.length === 0"
                class="flex gap-3 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm"
              >
                <AlertCircle class="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
                <p class="leading-relaxed">{{ t('customer.checkout.noSubs') }}</p>
              </div>

              <!-- 子账号卡片网格 -->
              <div v-else class="space-y-2">
                <button
                  v-for="s in subs"
                  :key="s.id"
                  type="button"
                  class="w-full text-left rounded-lg border-2 p-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  :class="subId === s.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-muted/30'"
                  @click="subId = s.id"
                >
                  <div class="flex items-start gap-3">
                    <!-- 单选圆 -->
                    <div
                      class="mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition"
                      :class="subId === s.id
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground/40'"
                    >
                      <Check
                        v-if="subId === s.id"
                        class="h-3 w-3 text-primary-foreground"
                      />
                    </div>

                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-mono text-sm font-semibold truncate">
                          {{ s.account_name }}
                        </span>
                        <Badge
                          v-if="s.is_main"
                          class="bg-amber-100 text-amber-800 border-amber-200 text-[10px]"
                        >
                          <Star class="h-3 w-3 mr-0.5 fill-current" />
                          {{ t('customer.checkout.mainBadge') }}
                        </Badge>
                        <Badge
                          v-if="s.status === 'inactive'"
                          variant="secondary"
                          class="text-[10px]"
                        >
                          {{ t('customer.checkout.inactive') }}
                        </Badge>
                      </div>
                      <p
                        v-if="s.inn && s.inn !== '-'"
                        class="text-xs text-muted-foreground mt-0.5 font-mono"
                      >
                        INN {{ s.inn }}
                      </p>
                    </div>
                  </div>
                </button>
                <p class="text-[11px] text-muted-foreground/70">
                  {{ t('customer.checkout.subAccountPick') }}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- 附件（图片）：放最前，文本备注紧随其后 -->
        <Card>
          <CardContent class="p-0">
            <div class="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b bg-muted/30">
              <Paperclip class="h-4 w-4 text-primary" />
              <h2 class="font-semibold text-sm">
                {{ t('customer.checkout.attachmentsTitle') }}
              </h2>
              <Badge variant="secondary" class="ml-auto tabular-nums">
                {{ attachments.items.value.length }} / {{ MAX_ATTACHMENTS }}
              </Badge>
            </div>

            <div class="p-4 sm:p-5 space-y-3">
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('customer.checkout.attachmentsHint') }}
              </p>

              <!-- 上传区 -->
              <button
                type="button"
                class="w-full rounded-lg border-2 border-dashed transition p-6 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :class="attachments.items.value.length >= MAX_ATTACHMENTS
                  ? 'border-muted bg-muted/20 cursor-not-allowed opacity-60'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer'"
                :disabled="attachments.items.value.length >= MAX_ATTACHMENTS"
                @click="onPickClick"
                @drop="onDrop"
                @dragover="onDragOver"
              >
                <div class="flex flex-col items-center gap-2 text-muted-foreground">
                  <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <ImagePlus class="h-5 w-5 text-primary" />
                  </div>
                  <p class="text-xs font-medium text-foreground">
                    {{ t('customer.checkout.attachmentsEmpty') }}
                  </p>
                  <p class="text-[10px]">
                    jpg / png / webp / heic · ≤ 5 MB · {{ MAX_ATTACHMENTS }} {{ t('customer.checkout.itemsCount') }}
                  </p>
                </div>
              </button>
              <input
                ref="fileInput"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                class="hidden"
                @change="onFiles(($event.target as HTMLInputElement).files)"
              />

              <!-- 错误提示 -->
              <div
                v-if="attachmentError"
                class="flex gap-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-md p-2.5 text-xs"
              >
                <AlertCircle class="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <p>{{ attachmentError }}</p>
              </div>

              <!-- 已上传缩略图 -->
              <ul
                v-if="attachments.items.value.length > 0"
                class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5"
              >
                <li
                  v-for="(it, idx) in attachments.items.value"
                  :key="idx"
                  class="relative group rounded-lg border bg-card overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
                >
                  <!-- 缩略图 -->
                  <div class="aspect-square bg-muted relative overflow-hidden">
                    <img
                      :src="it.local_url"
                      :alt="it.caption ?? 'attachment'"
                      class="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <!-- 上传进度遮罩 -->
                    <div
                      v-if="(it.progress ?? 0) < 100 && !it.error"
                      class="absolute inset-0 bg-black/40 flex items-center justify-center"
                    >
                      <div class="text-white text-xs font-medium flex items-center gap-1.5">
                        <Loader2 class="h-3.5 w-3.5 animate-spin" />
                        {{ it.progress ?? 0 }}%
                      </div>
                    </div>
                    <!-- 错误遮罩 -->
                    <div
                      v-if="it.error"
                      class="absolute inset-0 bg-destructive/85 flex items-center justify-center p-2"
                    >
                      <p class="text-white text-[10px] text-center leading-tight">
                        {{ it.error }}
                      </p>
                    </div>
                    <!-- 移除按钮：移动端常驻，桌面 hover 显示 -->
                    <button
                      type="button"
                      class="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center transition shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      :title="t('customer.checkout.attachmentsRemove')"
                      @click="attachments.remove(idx)"
                    >
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <!-- 底部: 文件信息 -->
                  <div class="px-2 py-1.5">
                    <p class="text-[10px] text-muted-foreground truncate font-mono tabular-nums">
                      {{ it.mime.replace('image/', '').toUpperCase() }} · {{ fmtSize(it.size_bytes) }}
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <!-- 文本备注：放在附件下方，作为补充说明 -->
        <Card>
          <CardContent class="p-0">
            <div class="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b bg-muted/30">
              <MessageSquare class="h-4 w-4 text-primary" />
              <h2 class="font-semibold text-sm">
                {{ t('customer.checkout.remark') }}
              </h2>
              <span
                v-if="remark.length > 0"
                class="ml-auto text-[10px] text-muted-foreground tabular-nums"
              >
                {{ remark.length }}
              </span>
            </div>
            <div class="p-4 sm:p-5">
              <Label for="remark" class="sr-only">
                {{ t('customer.checkout.remark') }}
              </Label>
              <Textarea
                id="remark"
                v-model="remark"
                :placeholder="t('customer.checkout.remarkPh')"
                class="min-h-28 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <!-- 错误条 -->
        <div
          v-if="errMsg"
          class="flex gap-3 border border-destructive/30 bg-destructive/5 text-destructive rounded-lg p-3.5 text-sm"
        >
          <AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
          <p class="leading-relaxed">{{ errMsg }}</p>
        </div>
      </div>

      <!-- 右侧：订单汇总（桌面 sticky，移动端底部固定） -->
      <aside class="lg:sticky lg:top-4 lg:self-start">
        <!-- 桌面摘要卡 -->
        <Card class="hidden lg:block">
          <CardContent class="p-0">
            <div class="px-5 py-4 border-b bg-gradient-to-br from-primary/5 to-transparent">
              <div class="flex items-center gap-2 mb-1">
                <Receipt class="h-4 w-4 text-primary" />
                <h2 class="font-semibold text-sm">
                  {{ t('customer.checkout.summaryTitle') }}
                </h2>
              </div>
              <p class="text-[11px] text-muted-foreground leading-relaxed">
                {{ t('customer.checkout.summarySubtitle') }}
              </p>
            </div>

            <div class="p-5 space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">{{ t('customer.checkout.totalBoxes') }}</span>
                <span class="font-semibold tabular-nums">{{ totalBoxes }} ящ.</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">{{ t('customer.checkout.totalM2') }}</span>
                <span class="font-semibold tabular-nums">{{ fmtM2(totalM2) }}</span>
              </div>
              <div class="border-t pt-3 flex justify-between items-baseline">
                <span class="text-muted-foreground text-xs">
                  {{ t('customer.checkout.totalAmount') }}
                </span>
                <Badge variant="secondary" class="text-[10px]">
                  {{ t('customer.checkout.pendingAmount') }}
                </Badge>
              </div>
            </div>

            <!-- 选中的子账号 -->
            <div
              v-if="selectedSub"
              class="mx-5 mb-4 rounded-lg border bg-muted/30 p-3"
            >
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {{ t('customer.checkout.subAccountLabel') }}
              </p>
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm font-semibold truncate">
                  {{ selectedSub.account_name }}
                </span>
                <Star
                  v-if="selectedSub.is_main"
                  class="h-3 w-3 text-amber-500 fill-current shrink-0"
                />
              </div>
            </div>

            <div class="p-5 pt-0 space-y-2">
              <Button
                class="w-full h-11 text-base font-semibold shadow-md shadow-primary/20"
                size="lg"
                :disabled="!canSubmit || submitting"
                @click="onSubmit"
              >
                <Loader2 v-if="submitting" class="mr-2 h-5 w-5 animate-spin" />
                <CheckCircle2 v-else class="mr-2 h-5 w-5" />
                {{
                  submitting
                    ? t('customer.checkout.submitting')
                    : t('customer.checkout.submit')
                }}
              </Button>
              <p class="text-[11px] text-muted-foreground text-center leading-relaxed">
                {{ t('customer.checkout.submitHint') }}
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- 移动端底部固定摘要条 -->
        <div class="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t shadow-lg">
          <div class="px-4 py-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground">
                {{ t('customer.checkout.totalBoxes') }} · {{ t('customer.checkout.totalM2') }}
              </p>
              <p class="font-bold text-sm tabular-nums truncate">
                {{ totalBoxes }} ящ. · {{ fmtM2(totalM2) }}
              </p>
              <p
                v-if="selectedSub"
                class="text-[11px] text-muted-foreground truncate font-mono"
              >
                → {{ selectedSub.account_name }}
              </p>
            </div>
            <Button
              class="h-11 px-5 shadow-md shadow-primary/20"
              size="lg"
              :disabled="!canSubmit || submitting"
              @click="onSubmit"
            >
              <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
              <CheckCircle2 v-else class="mr-2 h-4 w-4" />
              {{
                submitting
                  ? t('customer.checkout.submitting')
                  : t('customer.checkout.submit')
              }}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>