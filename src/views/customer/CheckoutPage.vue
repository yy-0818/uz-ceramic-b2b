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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Check,
  Circle,
  ImagePlus,
  X,
  Upload,
  Search,
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
import { useOrders, resetOrders } from '@/composables/useOrders'
import { useAuth } from '@/composables/useAuth'
import { useAccounts, type Account } from '@/composables/useAccounts'
import { useProducts } from '@/composables/useProducts'
import {
  useOrderAttachments,
  isBrowserRenderable,
} from '@/composables/useOrderAttachments'

const { t } = useI18n()
const router = useRouter()
const cart = useCart()
const orders = useOrders()
const { account, role } = useAuth()
const accs = useAccounts()
const attachments = useOrderAttachments()
const products = useProducts()

/**
 * 是否为「代客下单」模式——即非 customer 角色（admin / checker / 等）
 * 通过 CheckoutPage 给任意客户下单。这种模式下，前置「客户选择器」必选父账号。
 *
 * - customer：parentAccountId = account.parent_id ?? account.id，走自己那条线
 * - 其余角色：parentAccountId 必为空，必须先选 parent，下面的 picker 才出现
 */
const isOnBehalf = computed(() => role.value !== null && role.value !== 'customer')

const remark = ref('')
const submitting = ref(false)
const errMsg = ref<string | null>(null)

/** 代客下单：可选的父账号列表 */
const parents = ref<Account[]>([])
const loadingParents = ref(false)
/** 代客下单：选中的父账号 id。customer 模式下固定为自身 parent。 */
const pickedParentId = ref<string>('')
const parentsLoaded = ref(false)

const subs = ref<Account[]>([])
const subId = ref<string>('')
const loadingSubs = ref(false)
/** true after first load completes; prevents spinner flash on revisit with hot cache */
const subsLoaded = ref(false)

/**
 * 代客模式下的本地搜索词。
 * 父客户/子账号列表都可能很长（几十上百个），后台订单员经常
 * 跨多个客户来回切，所以两边都加了过滤搜索。
 */
const parentSearch = ref('')
const subSearch = ref('')

/**
 * 大小写不敏感的子串匹配：账号名 / 公司名 / INN / 客户类型都参与
 * 搜索，但只对 account_name/company_name 做 trim — 其余字段（如
 * account_type 的 i18n label）不在搜索范围，避免"搜不到俄语/乌语" 的
 * 体验割裂。
 */
const norm = (s: string) => s.toLowerCase().trim()
const filteredParents = computed(() => {
  const q = norm(parentSearch.value)
  if (!q) return parents.value
  return parents.value.filter((p) => {
    return norm(p.account_name).includes(q)
      || norm(p.company_name ?? '').includes(q)
  })
})
const filteredSubs = computed(() => {
  const q = norm(subSearch.value)
  const list = !q ? subs.value : subs.value.filter((s) => {
    return norm(s.account_name).includes(q)
      || norm(s.inn ?? '').includes(q)
  })
  // 主账号锁顶：is_main 排第一，其余按当前顺序
  return [...list].sort((a, b) => Number(b.is_main) - Number(a.is_main))
})

/**
 * 当前下单要用的父账号 id：
 *  - customer 模式：从 account 直接出
 *  - 代客模式：从 picker 出，未选则 null（强制走 picker 路径）
 */
const parentAccountId = computed<string | null>(() => {
  if (!isOnBehalf.value) {
    return account.value?.parent_id ?? account.value?.id ?? null
  }
  return pickedParentId.value || null
})

const loadSubs = async (parentId: string) => {
  loadingSubs.value = true
  try {
    subs.value = await accs.fetchSubAccounts(parentId)
    const main = subs.value.find((s) => s.is_main)
    subId.value = main?.id ?? subs.value[0]?.id ?? ''
  } finally {
    loadingSubs.value = false
    subsLoaded.value = true
  }
}

const loadParents = async () => {
  loadingParents.value = true
  try {
    parents.value = await accs.listParents()
  } finally {
    loadingParents.value = false
    parentsLoaded.value = true
  }
}

/**
 * 代客模式下，切换父账号时同时清空 sub 选中状态，等新 sub 加载完后再选默认。
 * customer 模式不挂这个 watcher（parent 是固定的）。
 */
watch(
  () => parentAccountId.value,
  (id) => {
    if (!id) return
    subId.value = ''
    subs.value = []
    subsLoaded.value = false
    subSearch.value = ''   // 切换父客户后，子账号搜索词归零
    loadSubs(id)
  },
)

onMounted(() => {
  // 商品图片缓存是模块级单例，通常 catalog 进来时已经 fetch。
  // 但 deep-link 进 checkout 时未必拉过，做一次保险。
  if (!products.fetched.value && !products.loading.value) {
    products.fetchAll().catch(() => { /* 网络失败展示首字母占位即可 */ })
  }
  if (isOnBehalf.value) {
    // 代客模式：只拉 parents，由上面 watcher 拉 subs
    loadParents()
    return
  }
  // 客户模式：直接走自己父账号
  if (parentAccountId.value) loadSubs(parentAccountId.value)
})

/**
 * 商品缩略图查表：product_id → image_url
 * - 从 useProducts() 模块级单例直接拿 items，零额外请求（catalog 已 fetch）
 * - 没图片或加载失败时由模板的 <ProductThumb> 组件用首字母占位回退
 */
const productImageMap = computed(() => {
  const m = new Map<string, string | null>()
  for (const p of products.items.value) m.set(p.id, p.image_url ?? null)
  return m
})

/**
 * 商品缩略图组件：
 * - 有 url 时渲染 <img>，onerror 切回字母占位
 * - 无 url 或加载失败时显示渐变背景 + 大写首字符（如 "A" for "Apex 6003"）
 */
const initialOf = (s: string) => (s.trim()[0] ?? '?').toUpperCase()
const colorFromModel = (s: string) => {
  // 用 model 字符串前 3 字符哈希成 HSL 色相，保证首字母占位色稳定
  let h = 0
  for (let i = 0; i < Math.min(s.length, 8); i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

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

// 附件 carousel —— 多张图片时只显示一张大图, 下方 thumbnail 横排 + 左右按钮
const activeIdx = ref(0)
const attCount = computed(() => attachments.items.value.length)
watch(attCount, (n) => {
  // 删除或上传成功后, 把 activeIdx 夹回合法范围
  if (activeIdx.value >= n) activeIdx.value = Math.max(0, n - 1)
})
const canPrev = computed(() => attCount.value > 1)
const canNext = computed(() => attCount.value > 1)
const goPrev = () => {
  if (attCount.value < 2) return
  activeIdx.value = (activeIdx.value - 1 + attCount.value) % attCount.value
}
const goNext = () => {
  if (attCount.value < 2) return
  activeIdx.value = (activeIdx.value + 1) % attCount.value
}
const selectAtt = (i: number) => { activeIdx.value = i }
const onCarouselKey = (ev: KeyboardEvent) => {
  if (attCount.value < 2) return
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); goPrev() }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); goNext() }
}

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

const onFiles = (files: FileList | null) => {
  if (!files || files.length === 0) return
  attachmentError.value = null
  const accountId = parentAccountId.value
  if (!accountId) {
    attachmentError.value = '缺少主账号 id, 无法添加附件'
    return
  }
  const remaining = MAX_ATTACHMENTS - attachments.items.value.length
  const accepted = Array.from(files).slice(0, remaining)
  const warnHeic: string[] = []
  for (const file of accepted) {
    try {
      const entry = attachments.add(file, accountId)
      // heic 浏览器不能本地预览. 不阻止上传, 但提示客户
      if (!isBrowserRenderable(file.type)) {
        warnHeic.push(file.name)
      }
      // entry 后续不需要用 (响应式已 push), 仅用于类型
      void entry
    } catch (e: any) {
      attachmentError.value = e?.message ?? String(e)
    }
  }
  if (warnHeic.length > 0) {
    // 追加而非覆盖
    const msg = `以下图片浏览器无法本地预览 (但仍会上传): ${warnHeic.join(', ')}`
    attachmentError.value = attachmentError.value
      ? `${attachmentError.value}\n${msg}`
      : msg
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
  if (!parentAccountId.value) {
    errMsg.value = isOnBehalf.value
      ? '请先选择要代下单的客户账号。'
      : '当前账号尚未关联客户，请联系管理员。'
    return
  }
  if (!subId.value) {
    errMsg.value = '请选择收货子账号。'
    return
  }
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
        color_code: c.color_code || undefined,
        stock_level: c.stock_level ?? 1,
      })),
      remark.value.trim() || null,
      subId.value,
    )
    createdOrderId = order.id

    // 订单已创建 → 上传本地的附件 + 绑定到订单
    // 路径: {account_id}/{order_id}/{uuid}.{ext} — 不再用 pending/ 魔法前缀
    if (attachments.items.value.length > 0) {
      try {
        await attachments.uploadAll(order.id, parentAccountId.value, account.value?.id ?? null)
      } catch (upErr: any) {
        // 附件上传失败 → 整体回滚订单 (避免出现"订单没图"的脏状态)
        // 用 admin 权限删除订单? 客户角色不能删. 提示用户手动处理.
        errMsg.value = `订单已创建 (${order.id}), 但附件上传失败: ${upErr?.message ?? upErr}。请联系客服处理。`
      }
    }

    cart.clear()
    // 离开页面再 reset, 否则本地预览图会立刻 revoke 不优雅
    void attachments.reset()
    // 清掉 useOrders 模块级单例, 让后续 OrderHistoryPage 进 onMounted
    // 时干净地全量重新拉（避免新订单没出现在列表里）
    resetOrders()
    router.push(`/orders/${order.id}/pay`)
  } catch (e: unknown) {
    errMsg.value = e instanceof Error ? e.message : String(t('customer.checkout.submitFail'))
  } finally {
    submitting.value = false
    // 订单成功 → 不要再 reset (uploadAll 成功后再 reset)
    void createdOrderId
  }
}

// 当前选中的子账号（用于 sticky 摘要显示）
const selectedSub = computed(() => subs.value.find((s) => s.id === subId.value))
// 当前选中的父账号（代客模式下用于 sticky 摘要显示）
const selectedParent = computed(() => parents.value.find((p) => p.id === pickedParentId.value))
</script>

<template>
  <!--
    整体布局：
      1. 顶部 hero：一个"取货表单"的统一标题层（返回 + 大标题 + 步骤条）
      2. 主区：左右两栏
         - 左侧：一个大的「订单表单」卡片，内含 4 个 section（统一编号 + icon）
         - 右侧：「结算面板」卡片（与左侧共享视觉语言），桌面 sticky / 移动 sticky 底栏

    视觉语言：
      - 所有 section 使用统一的 header（编号 + icon + 标题 + 可选 badge）
      - 主表单卡片 vs 结算卡片共享：圆角、内边距、icon 风格、border 风格
      - section 之间用 section-spacing（不是独立的 Card），靠 hairline + section title 分层
  -->

  <!-- ===================== 顶部 hero ===================== -->
  <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4 sm:py-5 mb-4">
    <!-- 装饰右上角的浅色 brand 圆形 (不喧宾夺主) -->
    <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
    <div class="pointer-events-none absolute -right-4 top-1/2 h-24 w-24 rounded-full bg-primary/5" />

    <div class="relative flex items-start gap-2">
      <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0 -ml-1" @click="router.back()">
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2 flex-wrap">
          <h1 class="text-base sm:text-lg font-bold leading-tight">
            {{ t('customer.checkout.stepTitle') }}
          </h1>
          <span class="text-[10px] font-semibold tracking-wider text-primary uppercase">
            {{ t('customer.checkout.stepLabel') }}
          </span>
        </div>
        <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
          {{ t('customer.checkout.stepHint') }}
        </p>
      </div>
    </div>

    <!-- 步骤条：购物车(✓) → 确认(当前) → 报价 -->
    <ol class="relative mt-4 grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 text-[11px]">
      <!-- 步骤 1 -->
      <li class="flex items-center gap-1.5 text-muted-foreground">
        <span class="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
          <CheckCircle2 class="h-3 w-3" />
        </span>
        <span class="font-medium hidden sm:inline">{{ t('customer.checkout.stepCart') }}</span>
      </li>
      <li><span class="block h-px bg-border" /></li>
      <!-- 步骤 2（当前） -->
      <li class="flex items-center gap-1.5 text-foreground">
        <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shadow-sm shadow-primary/30">
          2
        </span>
        <span class="font-semibold hidden sm:inline">{{ t('customer.checkout.stepConfirm') }}</span>
      </li>
      <li><span class="block h-px bg-border" /></li>
      <!-- 步骤 3 -->
      <li class="flex items-center gap-1.5 text-muted-foreground">
        <span class="h-5 w-5 rounded-full border bg-background flex items-center justify-center">
          <Circle class="h-2 w-2 text-muted-foreground/60" />
        </span>
        <span class="hidden sm:inline">{{ t('customer.checkout.stepPay') }}</span>
      </li>
    </ol>
  </header>

  <!-- ===================== 空购物车 ===================== -->
  <Card v-if="itemsCount === 0" class="overflow-hidden">
    <CardContent class="py-10 px-6 text-center space-y-4">
      <div class="mx-auto h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center">
        <ShoppingCart class="h-10 w-10 text-muted-foreground/40" />
      </div>
      <div class="space-y-1">
        <p class="font-semibold text-sm">{{ t('customer.checkout.emptyCartTitle') }}</p>
        <p class="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
          {{ t('customer.checkout.emptyCartHint') }}
        </p>
      </div>
      <div class="flex items-center justify-center gap-2 pt-0.5">
        <Button size="sm" variant="outline" @click="router.push('/orders')">
          {{ t('orders.title') }}
        </Button>
        <Button size="sm" @click="router.push('/catalog')">
          {{ t('customer.checkout.emptyCartBack') }}
          <ChevronRight class="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    </CardContent>
  </Card>

  <!-- ===================== 主区：左侧「订单表单」+ 右侧「结算面板」 ===================== -->
  <div v-else class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 lg:gap-6 pb-24 lg:pb-12">
    <!-- ============ 左侧：订单表单（单一容器，4 个 section） ============ -->
    <Card class="overflow-hidden">
      <CardContent class="p-0">
        <!-- 顶部：表单标题 + 摘要信息（数量 / 体积） -->
        <div class="px-5 sm:px-6 py-4 border-b bg-muted/20 flex items-center gap-3">
          <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Receipt class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold leading-tight">订单信息</p>
            <p class="text-[11px] text-muted-foreground leading-snug">
              请确认商品、选择收货账号，可附上图片或备注后提交。
            </p>
          </div>
          <div class="hidden sm:flex items-center gap-3 text-right shrink-0">
            <div>
              <p class="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">
                件数
              </p>
              <p class="text-sm font-bold tabular-nums leading-tight mt-0.5">
                {{ itemsCount }}
              </p>
            </div>
            <div class="h-7 w-px bg-border" />
            <div>
              <p class="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">
                总量
              </p>
              <p class="text-sm font-bold tabular-nums leading-tight mt-0.5">
                {{ fmtM2(totalM2) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Section 1：商品明细 -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <!--
            头部：仅 Step 1 + 图标 + 标题。
            - 件数 / 总量指标已经在顶 CartHeader 显示，不再重复
            - "图片稍后补全"提示也删掉 — 占位 UI 本身已经表达
          -->
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">
              1
            </span>
            <Package class="h-3.5 w-3.5 text-primary" />
            <h2 class="text-sm font-semibold text-foreground">
              {{ t('customer.checkout.items') }}
            </h2>
          </div>

          <!--
            商品列表 — 紧凑单行布局，每张卡：
              [缩略图 48px]  型号 (粗)              总额 м²
                            色号 · 级别 · 换算率

            去掉了：序号徽章 #1、色号/级别 Badge、左侧色条、第一张 ring、
                   三段式数量 chip、合计脚注的"箱数 · 总额"重复指标
            只保留：缩略图、型号、SKU 副行、单段计算式（右侧）
          -->
          <ul class="divide-y divide-border/40 border border-border/40 rounded-lg overflow-hidden bg-card">
            <li
              v-for="i in cart.items.value"
              :key="i.product_id"
              class="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition"
            >
              <!-- ============ 缩略图（48×48） ============ -->
              <div
                class="relative shrink-0 h-11 w-11 sm:h-12 sm:w-12 rounded-md overflow-hidden bg-muted/40 ring-1 ring-border/50"
              >
                <img
                  v-if="productImageMap.get(i.product_id)"
                  :src="productImageMap.get(i.product_id)!"
                  :alt="i.model"
                  class="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <div
                  class="absolute inset-0 flex items-center justify-center font-mono font-bold text-base sm:text-lg text-white"
                  :style="{
                    background: `linear-gradient(135deg, hsl(${colorFromModel(i.model)}, 55%, 45%), hsl(${(colorFromModel(i.model) + 40) % 360}, 65%, 35%))`,
                  }"
                  aria-hidden="true"
                >
                  {{ initialOf(i.model) }}
                </div>
              </div>

              <!-- ============ 主体 ============ -->
              <div class="min-w-0 flex-1">
                <p class="font-mono text-sm font-semibold truncate" :title="i.model">
                  {{ i.model }}
                </p>
                <p class="text-[11px] text-muted-foreground tabular-nums truncate">
                  {{ t('customer.checkout.colorCode') }} {{ i.color_code }}
                  <span class="opacity-50 mx-1">·</span>
                  {{ t('customer.checkout.stockLevel') }} {{ i.stock_level }}
                  <span class="opacity-50 mx-1">·</span>
                  {{ i.conversion_rate.toFixed(2) }} {{ t('customer.checkout.m2PerBox') }}
                </p>
              </div>

              <!-- ============ 右侧：单行计算式 ============ -->
              <div class="shrink-0 text-right leading-tight">
                <p class="text-sm font-bold tabular-nums text-primary">
                  {{ fmtM2(i.boxes * i.conversion_rate) }}
                </p>
                <p class="text-[10px] text-muted-foreground tabular-nums leading-tight mt-0.5">
                  {{ i.boxes }} × {{ i.conversion_rate.toFixed(2) }}
                </p>
              </div>
            </li>
          </ul>
        </section>

        <!-- Section 2：客户选择（代客：双列；普通客户：单列） -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
              2
            </span>
            <Users class="h-3.5 w-3.5 text-primary" />
            <h2 class="text-sm font-semibold text-foreground">
              {{ isOnBehalf
                ? t('customer.checkout.accountSectionTitle')
                : t('customer.checkout.subAccountLabel') }}
            </h2>
            <span class="text-[10px] font-semibold text-amber-700 uppercase tracking-wider ml-0.5">
              {{ t('customer.checkout.required') }}
            </span>
            <span
              v-if="selectedParent"
              class="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-mono font-semibold truncate max-w-[160px]"
            >
              <Check class="h-3 w-3 shrink-0" />
              {{ selectedParent.account_name }}
            </span>
          </div>

          <p class="text-[11px] text-muted-foreground leading-relaxed mb-2.5">
            {{ isOnBehalf
              ? t('customer.checkout.accountSectionHint')
              : t('customer.checkout.subAccountHint') }}
          </p>

          <!--
            ==================== 代客模式：lg+ 双列 / 移动单列 ====================

            用户反馈"web 端还是用左右布局，左边选主账号右边选子账号"
            —— web 端基本都 >= 1024px，所以这里用 `lg:grid-cols-2`：
              - 移动端 / 中等屏 (< 1024px) → 上下单列堆叠
              - 桌面 / web (>= 1024px) → 左右双列

            为了避免上次双列"卡片被切到 150px 截断"的问题：
              - 父列 5/12、子列 7/12（父客户通常 8 字内、子账号可显示
                账号名 + INN + 主账号徽章）
              - 卡片内部 min-w-0 + truncate；账号名独占一行，
                公司名 + 类型同行，< sm 时上下分行
              - 不再用 flex-1 min-h-0 让父容器挤压列表 → 列表用
                max-h-[480px] 自主决定高度
          -->
          <div v-if="isOnBehalf" class="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <!-- ========== 左列 5/12：父客户 ========== -->
            <div class="lg:col-span-5 relative rounded-lg border border-border/60 bg-muted/20 flex flex-col">
              <!-- 头部：步骤标 + 标题 + 角标 -->
              <div class="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-background/95 backdrop-blur rounded-t-lg">
                <span class="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                  2A
                </span>
                <span class="text-sm font-semibold text-foreground">
                  {{ t('customer.checkout.parentAccountLabel') }}
                </span>
                <span class="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                  {{ t('customer.checkout.required') }}
                </span>
                <span
                  v-if="parentsLoaded"
                  class="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-mono font-bold shrink-0"
                  :title="t('customer.checkout.parentAccountCount', { n: filteredParents.length })"
                >
                  {{ filteredParents.length }}<span class="opacity-60">/{{ parents.length }}</span>
                </span>
              </div>
              <!-- 搜索框 -->
              <div class="relative px-3 py-1.5 border-b border-border/60">
                <Search class="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  v-model="parentSearch"
                  type="text"
                  :placeholder="t('customer.checkout.parentSearchPh')"
                  class="w-full h-8 pl-9 pr-9 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  v-if="parentSearch"
                  type="button"
                  class="absolute right-5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  :title="t('common.clear')"
                  @click="parentSearch = ''"
                >
                  <X class="h-3 w-3" />
                </button>
              </div>

              <!-- 加载态 -->
              <div v-if="!parentsLoaded" class="flex items-center gap-2 text-xs text-muted-foreground px-3 py-4">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                {{ t('customer.checkout.loadingParents') }}
              </div>
              <!-- 空（数据） -->
              <div
                v-else-if="parents.length === 0"
                class="m-2 flex gap-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-2.5 text-xs"
              >
                <AlertCircle class="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <p class="leading-relaxed">{{ t('customer.checkout.noParents') }}</p>
              </div>
              <!-- 搜索无结果 -->
              <div
                v-else-if="filteredParents.length === 0"
                class="m-2 flex gap-2 border border-border bg-muted/40 text-muted-foreground rounded-lg p-2.5 text-xs"
              >
                <Search class="h-4 w-4 shrink-0 mt-0.5" />
                <p class="leading-relaxed">{{ t('customer.checkout.noSearchMatch') }}</p>
              </div>
              <!-- 列表 -->
              <div
                v-else
                class="relative"
              >
                <div
                  class="max-h-[480px] overflow-y-auto overscroll-contain p-2"
                  data-testid="parent-account-list-scroll"
                >
                  <div class="space-y-1.5">
                    <button
                      v-for="p in filteredParents"
                      :key="p.id"
                      type="button"
                      class="w-full text-left rounded-lg border-2 p-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      :class="pickedParentId === p.id
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border/60 hover:border-primary/40 hover:bg-muted/40'"
                      @click="pickedParentId = p.id"
                    >
                      <div class="flex items-center gap-2">
                        <div
                          class="h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition"
                          :class="pickedParentId === p.id
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/40'"
                        >
                          <Check v-if="pickedParentId === p.id" class="h-3 w-3 text-primary-foreground" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="font-mono text-sm font-semibold truncate leading-snug">{{ p.account_name }}</p>
                          <p class="text-[10px] text-muted-foreground truncate leading-tight">
                            {{ p.company_name }}
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <!-- 底部渐隐遮罩 -->
                <div
                  class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-muted/60 to-transparent rounded-b-lg"
                  aria-hidden="true"
                />
              </div>
            </div>

            <!-- ========== 右列 7/12：子账号 ========== -->
            <div class="lg:col-span-7 relative rounded-lg border border-border/60 bg-muted/20 flex flex-col">
              <!-- 头部 -->
              <div class="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-background/95 backdrop-blur rounded-t-lg">
                <span class="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                  2B
                </span>
                <span class="text-sm font-semibold text-foreground">
                  {{ t('customer.checkout.subAccountLabel') }}
                </span>
                <span class="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                  {{ t('customer.checkout.required') }}
                </span>
                <span
                  v-if="subsLoaded && pickedParentId"
                  class="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-mono font-bold shrink-0"
                  :title="t('customer.checkout.subCount', { n: filteredSubs.length })"
                >
                  {{ filteredSubs.length }}<span class="opacity-60">/{{ subs.length }}</span>
                </span>
              </div>
              <!-- 搜索框 -->
              <div class="relative px-3 py-1.5 border-b border-border/60">
                <Search class="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  v-model="subSearch"
                  type="text"
                  :placeholder="t('customer.checkout.subSearchPh')"
                  :disabled="!pickedParentId"
                  class="w-full h-8 pl-9 pr-9 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  v-if="subSearch"
                  type="button"
                  class="absolute right-5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  :title="t('common.clear')"
                  @click="subSearch = ''"
                >
                  <X class="h-3 w-3" />
                </button>
              </div>

              <!-- 占位：未选父客户 -->
              <div
                v-if="!pickedParentId"
                class="m-2 flex gap-2 border border-dashed border-border text-muted-foreground rounded-lg p-3 text-xs"
              >
                <ChevronRight class="h-4 w-4 shrink-0 mt-0.5" />
                <p class="leading-relaxed">{{ t('customer.checkout.pickParentFirst') }}</p>
              </div>
              <!-- 加载态 -->
              <div
                v-else-if="!subsLoaded"
                class="flex items-center gap-2 text-xs text-muted-foreground px-3 py-4"
              >
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                {{ t('customer.checkout.loadingSubs') }}
              </div>
              <!-- 空（数据） -->
              <div
                v-else-if="subs.length === 0"
                class="m-2 flex gap-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-2.5 text-xs"
              >
                <AlertCircle class="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <p class="leading-relaxed">{{ t('customer.checkout.noSubs') }}</p>
              </div>
              <!-- 搜索无结果 -->
              <div
                v-else-if="filteredSubs.length === 0"
                class="m-2 flex gap-2 border border-border bg-muted/40 text-muted-foreground rounded-lg p-2.5 text-xs"
              >
                <Search class="h-4 w-4 shrink-0 mt-0.5" />
                <p class="leading-relaxed">{{ t('customer.checkout.noSearchMatch') }}</p>
              </div>
              <!-- 列表 -->
              <div
                v-else
                class="relative"
              >
                <div
                  class="max-h-[480px] overflow-y-auto overscroll-contain p-2"
                  data-testid="sub-account-list-scroll"
                >
                  <div class="grid grid-cols-1 gap-2">
                    <button
                      v-for="s in filteredSubs"
                      :key="s.id"
                      type="button"
                      class="w-full text-left rounded-lg border-2 p-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      :class="subId === s.id
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border/60 hover:border-primary/40 hover:bg-muted/40'"
                      @click="subId = s.id"
                    >
                      <div class="flex items-center gap-2.5">
                        <div
                          class="h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition"
                          :class="subId === s.id
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/40'"
                        >
                          <Check v-if="subId === s.id" class="h-3 w-3 text-primary-foreground" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5 min-w-0">
                            <span class="font-mono text-sm font-semibold truncate">{{ s.account_name }}</span>
                            <Badge
                              v-if="s.is_main"
                              class="bg-amber-100 text-amber-800 border-amber-200 text-[10px] shrink-0"
                            >
                              <Star class="h-3 w-3 mr-0.5 fill-current" />
                              {{ t('customer.checkout.mainBadge') }}
                            </Badge>
                            <Badge
                              v-if="s.status === 'inactive'"
                              variant="secondary"
                              class="text-[10px] shrink-0"
                            >
                              {{ t('customer.checkout.inactive') }}
                            </Badge>
                          </div>
                          <p
                            v-if="s.inn && s.inn !== '-'"
                            class="text-[10px] text-muted-foreground mt-0.5 font-mono truncate"
                          >
                            INN {{ s.inn }}
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <!-- 底部渐隐遮罩 -->
                <div
                  class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-muted/60 to-transparent rounded-b-lg"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          <!--
            ==================== 普通客户模式：单列（不变） ====================
          -->
          <div v-else>
            <!-- 加载态 -->
            <div v-if="!subsLoaded" class="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              {{ t('customer.checkout.loadingSubs') }}
            </div>
            <!-- 空状态 -->
            <div
              v-else-if="subs.length === 0"
              class="flex gap-2.5 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-2.5 text-xs"
            >
              <AlertCircle class="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <p class="leading-relaxed">{{ t('customer.checkout.noSubs') }}</p>
            </div>
            <!-- 子账号卡片列表（紧凑式） -->
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                v-for="s in subs"
                :key="s.id"
                type="button"
                class="text-left rounded-lg border-2 p-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :class="subId === s.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/60 hover:border-primary/40 hover:bg-muted/40'"
                @click="subId = s.id"
              >
                <div class="flex items-start gap-2.5">
                  <div
                    class="mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition"
                    :class="subId === s.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40'"
                  >
                    <Check v-if="subId === s.id" class="h-3 w-3 text-primary-foreground" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
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
                      class="text-[10px] text-muted-foreground mt-0.5 font-mono"
                    >
                      INN {{ s.inn }}
                    </p>
                  </div>
                </div>
              </button>
            </div>
            <p v-if="subs.length > 0" class="text-[10px] text-muted-foreground/70 mt-2">
              {{ t('customer.checkout.subAccountPick') }}
            </p>
          </div>
        </section>

        <!-- Section 4：附件 + 备注（合并为一组，让"补充信息"集中） -->
        <section class="px-5 sm:px-6 py-5 border-b">
          <div class="flex items-center gap-2 mb-3">
            <span class="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">
              {{ isOnBehalf ? 3 : 3 }}
            </span>
            <Paperclip class="h-3.5 w-3.5 text-primary" />
            <h2 class="text-sm font-semibold text-foreground">附件与备注</h2>
            <Badge variant="secondary" class="ml-auto text-[10px] tabular-nums">
              {{ attachments.items.value.length }} / {{ MAX_ATTACHMENTS }}
            </Badge>
          </div>

          <!-- 上传区 -->
          <button
            type="button"
            class="w-full rounded-lg border-2 border-dashed transition p-4 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="attachments.items.value.length >= MAX_ATTACHMENTS
              ? 'border-muted bg-muted/20 cursor-not-allowed opacity-60'
              : 'border-border/60 hover:border-primary/50 hover:bg-primary/5 cursor-pointer'"
            :disabled="attachments.items.value.length >= MAX_ATTACHMENTS"
            @click="onPickClick"
            @drop="onDrop"
            @dragover="onDragOver"
          >
            <div class="flex flex-col items-center gap-1.5 text-muted-foreground">
              <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <ImagePlus class="h-4 w-4 text-primary" />
              </div>
              <p class="text-[11px] font-medium text-foreground">
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
            class="flex gap-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-md p-2 text-[11px] mt-2"
          >
            <AlertCircle class="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
            <p>{{ attachmentError }}</p>
          </div>

          <!-- 已上传图片 carousel -->
          <div
            v-if="attachments.items.value.length > 0"
            class="space-y-2 mt-2"
            @keydown="onCarouselKey"
            tabindex="0"
            role="region"
            :aria-label="t('customer.checkout.attachmentsTitle')"
          >
            <!-- 大图区 -->
            <div class="relative rounded-lg border bg-card overflow-hidden shadow-sm">
              <div class="relative aspect-[4/3] sm:aspect-[16/10] bg-muted">
                <TransitionGroup name="att-fade" tag="div" class="absolute inset-0">
                  <div
                    v-for="(it, idx) in attachments.items.value"
                    v-show="idx === activeIdx"
                    :key="idx"
                    class="absolute inset-0"
                  >
                    <img
                      v-if="isBrowserRenderable(it.mime)"
                      :src="it.local_url"
                      :alt="it.caption ?? `attachment ${idx + 1}`"
                      class="h-full w-full object-contain"
                      loading="lazy"
                    />
                    <!-- 浏览器不支持的格式 (heic 等) — 不尝试 <img>, 直接显示提示 -->
                    <div
                      v-else
                      class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/30"
                    >
                      <div class="h-12 w-12 rounded-full bg-amber-200/70 dark:bg-amber-800/50 flex items-center justify-center">
                        <ImagePlus class="h-6 w-6 text-amber-700 dark:text-amber-300" />
                      </div>
                      <div class="text-center px-4">
                        <p class="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
                          {{ (it.mime || '').replace('image/', '').toUpperCase() || '未知格式' }}
                        </p>
                        <p class="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                          浏览器无法预览 · 提交时仍会上传
                        </p>
                      </div>
                    </div>
                    <!-- 提交订单时上传进度 overlay -->
                    <div
                      v-if="attachments.uploading.value && (it.progress ?? 0) < 100"
                      class="absolute inset-0 bg-black/55 flex items-center justify-center backdrop-blur-[1px]"
                    >
                      <div class="text-white text-xs font-medium flex items-center gap-1.5">
                        <Loader2 class="h-3.5 w-3.5 animate-spin" />
                        {{ it.progress ?? 0 }}%
                      </div>
                    </div>
                    <div
                      v-if="it.error"
                      class="absolute inset-0 bg-destructive/85 flex items-center justify-center p-3"
                    >
                      <p class="text-white text-[11px] text-center leading-tight">
                        {{ it.error }}
                      </p>
                    </div>
                  </div>
                </TransitionGroup>
                <button
                  type="button"
                  class="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/70 hover:bg-destructive text-white flex items-center justify-center transition shadow-md"
                  :title="t('customer.checkout.attachmentsRemove')"
                  @click="attachments.remove(activeIdx)"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
                <template v-if="attachments.items.value.length > 1">
                  <button
                    type="button"
                    class="absolute top-1/2 left-1.5 -translate-y-1/2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition shadow-md backdrop-blur"
                    :aria-label="t('customer.checkout.attachmentsPrev')"
                    @click="goPrev"
                  >
                    <ChevronLeft class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="absolute top-1/2 right-1.5 -translate-y-1/2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition shadow-md backdrop-blur"
                    :aria-label="t('customer.checkout.attachmentsNext')"
                    @click="goNext"
                  >
                    <ChevronRight class="h-4 w-4" />
                  </button>
                  <span class="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-medium tabular-nums backdrop-blur">
                    {{ activeIdx + 1 }} / {{ attachments.items.value.length }}
                  </span>
                </template>
              </div>
              <div class="px-2.5 py-1.5 border-t bg-muted/30 flex items-center justify-between gap-2">
                <p class="text-[10px] text-muted-foreground truncate font-mono tabular-nums">
                  {{
                    (attachments.items.value[activeIdx]?.mime ?? '')
                      .replace('image/', '')
                      .toUpperCase()
                  }}
                  ·
                  {{ fmtSize(attachments.items.value[activeIdx]?.size_bytes ?? 0) }}
                </p>
                <p
                  v-if="attachments.items.value[activeIdx]?.error"
                  class="text-[10px] text-destructive truncate"
                >
                  {{ attachments.items.value[activeIdx]?.error }}
                </p>
              </div>
            </div>

            <!-- Thumbnail 横排 -->
            <ul class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
              <li
                v-for="(it, idx) in attachments.items.value"
                :key="idx"
                class="shrink-0 snap-start"
              >
                <button
                  type="button"
                  class="relative h-16 w-16 sm:h-20 sm:w-20 rounded-md overflow-hidden border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  :class="idx === activeIdx
                    ? 'border-primary shadow-md shadow-primary/20 ring-2 ring-primary/30'
                    : 'border-border/60 hover:border-primary/50 opacity-70 hover:opacity-100'"
                  :title="`#${idx + 1}`"
                  @click="selectAtt(idx)"
                >
                  <img
                    :src="it.local_url"
                    :alt="`thumbnail ${idx + 1}`"
                    class="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span
                    v-if="!isBrowserRenderable(it.mime)"
                    class="absolute inset-0 bg-amber-500/85 flex items-center justify-center p-1"
                    title="浏览器无法本地预览此格式 (提交时仍会上传)"
                  >
                    <span class="text-white text-[9px] font-bold text-center leading-tight">
                      浏览器无法预览
                    </span>
                  </span>
                  <span
                    v-if="it.error"
                    class="absolute inset-0 bg-destructive/70 flex items-center justify-center"
                  >
                    <AlertCircle class="h-3.5 w-3.5 text-white" />
                  </span>
                  <span
                    class="absolute top-0.5 left-0.5 h-4 min-w-4 px-1 rounded-full bg-black/70 text-white text-[9px] font-bold tabular-nums flex items-center justify-center"
                  >
                    {{ idx + 1 }}
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <!-- 文本备注：作为附件下方的"补充说明"内嵌在同一 section -->
          <div class="mt-4 pt-4 border-t border-dashed">
            <div class="flex items-center gap-2 mb-2">
              <MessageSquare class="h-3.5 w-3.5 text-muted-foreground" />
              <Label for="remark" class="text-xs font-medium text-muted-foreground">
                {{ t('customer.checkout.remark') }}
              </Label>
              <span
                v-if="remark.length > 0"
                class="ml-auto text-[10px] text-muted-foreground tabular-nums"
              >
                {{ remark.length }}
              </span>
            </div>
            <Textarea
              id="remark"
              v-model="remark"
              :placeholder="t('customer.checkout.remarkPh')"
              class="min-h-20 resize-none text-sm bg-background"
            />
          </div>
        </section>

        <!-- 错误条（贴近 section 下方） -->
        <div
          v-if="errMsg"
          class="mx-5 sm:mx-6 my-5 flex gap-2.5 border border-destructive/30 bg-destructive/5 text-destructive rounded-lg p-2.5 text-xs"
        >
          <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
          <p class="leading-relaxed">{{ errMsg }}</p>
        </div>
      </CardContent>
    </Card>

    <!-- ============ 右侧：结算面板（桌面） ============ -->
    <aside class="lg:sticky lg:top-4 lg:self-start space-y-3">
      <Card class="overflow-hidden">
        <CardContent class="p-0">
          <!-- header：与小卡片保持同语言 -->
          <div class="px-5 py-3.5 border-b bg-gradient-to-br from-primary/[0.06] via-primary/[0.02] to-transparent">
            <div class="flex items-center gap-2">
              <div class="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Receipt class="h-3.5 w-3.5 text-primary" />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-semibold leading-tight">
                  {{ t('customer.checkout.summaryTitle') }}
                </p>
                <p class="text-[10px] text-muted-foreground leading-snug">
                  {{ t('customer.checkout.summarySubtitle') }}
                </p>
              </div>
            </div>
          </div>

          <!-- 数据汇总 -->
          <div class="px-5 py-4 space-y-2 text-xs">
            <div class="flex justify-between items-baseline">
              <span class="text-muted-foreground">{{ t('customer.checkout.totalBoxes') }}</span>
              <span class="font-semibold tabular-nums text-sm">{{ totalBoxes }} ящ.</span>
            </div>
            <div class="flex justify-between items-baseline">
              <span class="text-muted-foreground">{{ t('customer.checkout.totalM2') }}</span>
              <span class="font-semibold tabular-nums text-sm">{{ fmtM2(totalM2) }}</span>
            </div>
            <div class="border-t pt-2.5 mt-2 flex justify-between items-baseline">
              <span class="text-muted-foreground text-[10px]">
                {{ t('customer.checkout.totalAmount') }}
              </span>
              <Badge variant="secondary" class="text-[9px]">
                {{ t('customer.checkout.pendingAmount') }}
              </Badge>
            </div>
          </div>

          <!-- 选中状态：代客父客户 + 收货子账号（共享同一块视觉区域） -->
          <div v-if="isOnBehalf || selectedSub" class="px-5 pb-4 space-y-2">
            <!-- 代客父客户 -->
            <div
              v-if="isOnBehalf && selectedParent"
              class="rounded-md border bg-amber-50 border-amber-200/80 p-2.5"
            >
              <p class="text-[9px] uppercase tracking-wider text-amber-700 mb-1 font-semibold">
                代客下单 · 父客户
              </p>
              <p class="font-mono text-xs font-semibold text-amber-900 truncate">
                {{ selectedParent.account_name }}
              </p>
            </div>

            <!-- 收货子账号 -->
            <div
              v-if="selectedSub"
              class="rounded-md border bg-muted/40 p-2.5"
            >
              <p class="text-[9px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                {{ t('customer.checkout.subAccountLabel') }}
              </p>
              <div class="flex items-center gap-1.5">
                <span class="font-mono text-xs font-semibold truncate">
                  {{ selectedSub.account_name }}
                </span>
                <Star
                  v-if="selectedSub.is_main"
                  class="h-3 w-3 text-amber-500 fill-current shrink-0"
                />
              </div>
            </div>

            <!-- 提示：父客户 / 子账号未选 -->
            <div
              v-if="isOnBehalf && !selectedParent"
              class="rounded-md border border-dashed bg-muted/30 p-2.5 text-[11px] text-muted-foreground"
            >
              请先在上方选择父客户
            </div>
            <div
              v-else-if="!selectedSub"
              class="rounded-md border border-dashed bg-muted/30 p-2.5 text-[11px] text-muted-foreground"
            >
              请在上方选择收货子账号
            </div>
          </div>

          <!-- 提交按钮 -->
          <div class="px-5 pb-5">
            <Button
              class="w-full h-11 text-sm font-semibold shadow-md shadow-primary/20"
              size="lg"
              :disabled="!canSubmit || submitting"
              @click="onSubmit"
            >
              <Loader2 v-if="submitting" class="mr-1.5 h-4 w-4 animate-spin" />
              <CheckCircle2 v-else class="mr-1.5 h-4 w-4" />
              {{
                submitting
                  ? t('customer.checkout.submitting')
                  : t('customer.checkout.submit')
              }}
            </Button>
            <p class="text-[10px] text-muted-foreground text-center leading-relaxed mt-1.5">
              {{ t('customer.checkout.submitHint') }}
            </p>
          </div>
        </CardContent>
      </Card>
    </aside>

    <!-- ============ 移动端底部固定摘要条 ============ -->
    <div class="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <div class="px-3 py-2.5 flex items-center gap-2.5">
        <div class="flex-1 min-w-0">
          <p class="text-[9px] uppercase tracking-wider text-muted-foreground">
            {{ t('customer.checkout.totalBoxes') }} · {{ t('customer.checkout.totalM2') }}
          </p>
          <p class="font-bold text-xs tabular-nums truncate">
            {{ totalBoxes }} ящ. · {{ fmtM2(totalM2) }}
          </p>
          <p
            v-if="isOnBehalf && selectedParent"
            class="text-[10px] text-amber-700 truncate font-mono"
          >
            代客 → {{ selectedParent.account_name }}
          </p>
          <p
            v-if="selectedSub"
            class="text-[10px] text-muted-foreground truncate font-mono"
          >
            → {{ selectedSub.account_name }}
          </p>
        </div>
        <Button
          class="h-10 px-4 shadow-md shadow-primary/20"
          size="lg"
          :disabled="!canSubmit || submitting"
          @click="onSubmit"
        >
          <Loader2 v-if="submitting" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          <CheckCircle2 v-else class="mr-1.5 h-3.5 w-3.5" />
          {{
            submitting
              ? t('customer.checkout.submitting')
              : t('customer.checkout.submit')
          }}
        </Button>
      </div>
    </div>
  </div>
</template>
<style scoped>
/* 附件 carousel 切换动画 */
.att-fade-enter-active,
.att-fade-leave-active {
  transition: opacity 0.18s ease;
}
.att-fade-enter-from,
.att-fade-leave-to {
  opacity: 0;
}
/* carousel 容器键盘焦点轮廓 (温和) */
[role='region']:focus-visible {
  outline: none;
}
[role='region']:focus-visible > :first-child {
  box-shadow: 0 0 0 2px var(--ring, hsl(var(--primary)));
}
</style>