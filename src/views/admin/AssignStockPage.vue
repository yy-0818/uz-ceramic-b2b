<!--
  src/views/admin/AssignStockPage.vue
  后台：库存白名单分配（精简版）
  流程：
    1. 选客户组（多选组 = 整组入库白名单；组内可排除个别型号做精细控制）
    2. 点击「提交」即可：按"已勾客户组 × 该组已绑主账号"自动派生账户，无需手工选账户也无需预览
    3. （组头可多绑主账号 → 写入 customer_group_mappings）
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { CheckCircle2, AlertTriangle, Send, Loader2, Layers, X, Link2, Edit3, Boxes } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Badge from '@/components/ui/Badge.vue'

import { useProducts } from '@/composables/useProducts'
import { useAccounts } from '@/composables/useAccounts'
import { useAccountProducts } from '@/composables/useAccountProducts'
import { useCustomerGroupMappings } from '@/composables/useCustomerGroupMappings'
import { supabase } from '@/lib/supabase'

import BindAccountsDialog from './assign-stock/BindAccountsDialog.vue'

// 每个 product 的 L1 / L2 总箱数（来自 stock_colors 实时聚合）
const productStockSums = ref<Map<string, { l1: number; l2: number }>>(new Map())

const { t } = useI18n()
const products = useProducts()
const accounts = useAccounts()
const ap = useAccountProducts()
const mappings = useCustomerGroupMappings()

/**
 * 客户组 → 主账号 映射。
 * 数据源：DB 的 customer_group_mappings 表。
 */
const groupToAccount = computed<Record<string, string[]>>(() => {
  const m: Record<string, string[]> = {}
  for (const it of mappings.items.value) {
    if (!it.is_active) continue
    if (!m[it.customer_group]) m[it.customer_group] = []
    if (!m[it.customer_group].includes(it.account_id)) m[it.customer_group].push(it.account_id)
  }
  return m
})

/**
 * 状态：
 * - selectedGroupNames: 勾选的客户组名
 * - defaultVisible: 写入 account_products 时默认可见性
 */
const selectedGroupNames = ref<Set<string>>(new Set())
const defaultVisible = ref(true)
const submitting = ref(false)
const result = ref<{ rows: number; accounts: number; groups: number } | null>(null)

interface ProductGroupBucket {
  group: string
  productModels: Array<{ id: string; model: string; category: string }>
}

const groupedByCustomerGroup = computed<ProductGroupBucket[]>(() => {
  const byGroup = new Map<string, ProductGroupBucket>()
  for (const p of products.items.value) {
    const g = p.stock_group ?? '未分组'
    let bucket = byGroup.get(g)
    if (!bucket) {
      bucket = { group: g, productModels: [] }
      byGroup.set(g, bucket)
    }
    if (!bucket.productModels.some((m) => m.id === p.id)) {
      bucket.productModels.push({ id: p.id, model: p.model, category: p.category })
    }
  }
  return Array.from(byGroup.values()).sort((a, b) => {
    if (a.group === t('admin.assignPage.unbucketed')) return 1
    if (b.group === t('admin.assignPage.unbucketed')) return -1
    return a.group.localeCompare(b.group)
  })
})

const allGroups = computed(() => groupedByCustomerGroup.value)

const isGroupSelected = (g: ProductGroupBucket) =>
  selectedGroupNames.value.has(g.group)

const toggleGroup = (g: ProductGroupBucket) => {
  const s = new Set(selectedGroupNames.value)
  if (s.has(g.group)) s.delete(g.group)
  else s.add(g.group)
  selectedGroupNames.value = s
}

const selectAllGroups = () => {
  selectedGroupNames.value = new Set(allGroups.value.map((g) => g.group))
}
const deselectAllGroups = () => {
  selectedGroupNames.value = new Set()
}

const allParents = computed(() =>
  accounts.items.value.filter((a) => a.parent_id === null),
)

/** 出现在商品里但还没配主账号的客户组 */
const unmappedGroups = computed<string[]>(() => {
  const mapped = new Set(mappings.items.value.filter((m) => m.is_active).map((m) => m.customer_group))
  const all = new Set<string>()
  for (const g of groupedByCustomerGroup.value) {
    if (g.group !== '未分组') all.add(g.group)
  }
  return Array.from(all).filter((g) => !mapped.has(g)).sort()
})

/** 已勾客户组中、未绑账户的（会预警） */
const selectedUnmappedGroups = computed<string[]>(() =>
  selectedGroupNames.value.size === 0
    ? []
    : Array.from(selectedGroupNames.value).filter((g) => (groupToAccount.value[g]?.length ?? 0) === 0).sort(),
)

/** 预计提交的行数 / 账户数（仅作顶部提示用） */
const expectedSummary = computed(() => {
  const groups = Array.from(selectedGroupNames.value)
  let rows = 0
  const accSet = new Set<string>()
  for (const g of groups) {
    const aids = groupToAccount.value[g] ?? []
    const bucket = groupedByCustomerGroup.value.find((x) => x.group === g)
    if (!bucket) continue
    rows += aids.length * bucket.productModels.length
    for (const a of aids) accSet.add(a)
  }
  return { rows, accounts: accSet.size, groups: groups.length }
})

const onInit = async () => {
  await Promise.all([
    products.fetchAll(),
    accounts.fetchTree(),
    mappings.fetchAll(),
  ])
  const { data, error } = await supabase
    .from('stock_colors')
    .select('product_id, stock_level, boxes')
  if (!error && data) {
    const m = new Map<string, { l1: number; l2: number }>()
    for (const r of data as Array<{ product_id: string; stock_level: number; boxes: number }>) {
      const cur = m.get(r.product_id) ?? { l1: 0, l2: 0 }
      if (r.stock_level === 1) cur.l1 += r.boxes
      else if (r.stock_level === 2) cur.l2 += r.boxes
      m.set(r.product_id, cur)
    }
    productStockSums.value = m
  }
}

onMounted(onInit)

/**
 * 客户组 → 主账号 绑定（多选 modal）。
 * 业务逻辑在父级；UI 状态由 BindAccountsDialog 自管理。
 */
const bindDialogOpen = ref(false)
const bindGroup = ref<string | null>(null)
const bindInitialSelection = ref<string[]>([])
const savingBind = ref(false)

const getAccountName = (id: string) => {
  const a = accounts.items.value.find((x) => x.id === id)
  return a?.account_name ?? '(未知账户)'
}

const openBindModal = (group: string) => {
  bindGroup.value = group
  bindInitialSelection.value = [...(groupToAccount.value[group] ?? [])]
  bindDialogOpen.value = true
}

const onSubmitBindSelection = async ({ group, selection }: { group: string; selection: string[] }) => {
  savingBind.value = true
  try {
    const wanted = new Set(selection)
    const existing = mappings.items.value.filter((m) => m.customer_group === group && m.is_active)
    const existingIds = new Set(existing.map((m) => m.account_id))

    const toUpsert = Array.from(wanted).filter((id) => !existingIds.has(id))
    if (toUpsert.length > 0) {
      await mappings.bulkUpsert(toUpsert.map((account_id) => ({
        customer_group: group,
        account_id,
        is_active: true,
      })))
    }
    const toRemove = existing.filter((m) => !wanted.has(m.account_id))
    for (const it of toRemove) await mappings.remove(it.id)

    await mappings.fetchAll()
    bindDialogOpen.value = false
  } catch (e) {
    alert(e instanceof Error ? e.message : t('admin.assignPage.saveFail'))
  } finally {
    savingBind.value = false
  }
}

/**
 * 提交：即时构建"已勾组 × 绑定的账户 × 组内型号"，写库。
 */
const onSubmit = async () => {
  if (expectedSummary.value.rows === 0) return
  if (!confirm(
    t('admin.assignPage.targetSummary', {
      accounts: expectedSummary.value.accounts,
      rows: expectedSummary.value.rows,
      groups: expectedSummary.value.groups,
    }),
  )) return
  submitting.value = true
  try {
    const rows: Array<{
      account_id: string
      product_id: string
      is_visible: boolean
      stock_level_1: number
      stock_level_2: number
    }> = []

    const productStockMap = new Map<string, { totalL1: number; totalL2: number }>()
    for (const p of products.items.value) {
      const sums = productStockSums.value.get(p.id) ?? { l1: 0, l2: 0 }
      productStockMap.set(p.id, { totalL1: sums.l1, totalL2: sums.l2 })
    }

    for (const g of selectedGroupNames.value) {
      const aids = groupToAccount.value[g] ?? []
      if (aids.length === 0) continue
      const bucket = groupedByCustomerGroup.value.find((x) => x.group === g)
      if (!bucket) continue
      const models = bucket.productModels
      for (const aid of aids) {
        for (const m of models) {
          const info = productStockMap.get(m.id)
          if (!info) continue
          rows.push({
            account_id: aid,
            product_id: m.id,
            is_visible: defaultVisible.value,
            stock_level_1: info.totalL1,
            stock_level_2: info.totalL2,
          })
        }
      }
    }

    const count = await ap.bulkAssign(rows)
    result.value = {
      rows: count,
      accounts: expectedSummary.value.accounts,
      groups: expectedSummary.value.groups,
    }
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : t('admin.assignPage.submitFail'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- 顶部：渐变标题区 -->
    <div class="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/5 via-background to-emerald-50/40 px-5 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            <Layers class="h-5 w-5" />
          </div>
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{{ t('admin.assignPage.title') }}</h1>
            <p class="text-xs text-muted-foreground">
              {{ t('admin.assignPage.subtitle') }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="deselectAllGroups" :disabled="selectedGroupNames.size === 0">
            <X :class="`mr-1 h-3.5 w-3.5`" />
            {{ t('admin.assignPage.clearSelection') }}
          </Button>
          <Button
            size="sm"
            class="shadow-sm shadow-primary/20"
            @click="onSubmit"
            :disabled="submitting || expectedSummary.rows === 0"
          >
            <Loader2 v-if="submitting" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
            <Send v-else class="mr-1.5 h-3.5 w-3.5" />
            一键写入 · {{ expectedSummary.rows }} 行
          </Button>
        </div>
      </div>
      <!-- 默认可见开关 -->
      <div v-if="selectedGroupNames.size > 0" class="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <Checkbox v-model="defaultVisible" id="default-visible-toggle" />
        <label for="default-visible-toggle" class="cursor-pointer">{{ t('admin.assignPage.defaultVisible') }}</label>
        <span class="ml-auto inline-flex items-center gap-1 text-[11px]">
          <span class="inline-block h-1.5 w-1.5 rounded-full" :class="defaultVisible ? 'bg-emerald-500' : 'bg-muted-foreground/50'" />
          {{ defaultVisible ? t('admin.assignPage.toggleOn') : t('admin.assignPage.toggleOff') }}
        </span>
      </div>
    </div>

    <!-- 警告：未绑客户组（已勾） -->
    <div
      v-if="selectedUnmappedGroups.length > 0"
      class="flex items-start gap-3 overflow-hidden rounded-lg border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-xs text-amber-900"
    >
      <div class="absolute inset-y-0 left-0 w-1 bg-amber-400" />
      <div class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle class="h-4 w-4" />
      </div>
      <div class="leading-relaxed">
        {{ t('admin.assignPage.warningUnbound', { n: selectedUnmappedGroups.length }) }}主账号（提交时这些组将被跳过）：
        <span class="font-mono">{{ selectedUnmappedGroups.slice(0, 6).join('、') }}</span>
        <span v-if="selectedUnmappedGroups.length > 6"> 等</span>
        {{ t('admin.assignPage.warningHint') }}
      </div>
    </div>

    <!-- 全局提示：尚未绑定的客户组 -->
    <div
      v-if="unmappedGroups.length > 0 && selectedGroupNames.size === 0"
      class="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        {{ unmappedGroups.length }} 个客户组尚未绑定主账号：
        <span class="font-mono">{{ unmappedGroups.slice(0, 6).join('、') }}</span>
        <span v-if="unmappedGroups.length > 6"> 等</span>
        {{ t('admin.assignPage.globalHint') }}
      </div>
    </div>

    <!-- 客户组列表 -->
    <Card class="overflow-hidden">
      <CardHeader class="flex flex-row items-center justify-between gap-2 space-y-0 border-b bg-muted/20 px-4 py-3">
        <div class="flex items-center gap-2">
          <Layers class="h-4 w-4 text-muted-foreground" />
          <CardTitle class="text-sm">{{ t('admin.assignPage.grpList') }}</CardTitle>
          <span class="text-[11px] text-muted-foreground">· {{ allGroups.length }} 个</span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <button
            class="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="selectAllGroups"
          >{{ t('admin.assignPage.selectAll') }}</button>
          <span class="text-muted-foreground/40">|</span>
          <button
            class="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="deselectAllGroups"
          >{{ t('admin.assignPage.clear') }}</button>
        </div>
      </CardHeader>
      <CardContent class="p-3">
        <div v-if="allGroups.length === 0" class="py-10 text-center text-sm text-muted-foreground">
          <Boxes class="mx-auto mb-2 h-8 w-8 opacity-40" />
          {{ t('admin.assignPage.emptyGrp') }}
        </div>

        <div class="max-h-[68vh] overflow-auto pr-1 space-y-2">
          <div
            v-for="g in allGroups"
            :key="g.group"
            class="group relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-lg border bg-card px-3 py-2.5 transition-all hover:shadow-sm"
            :class="isGroupSelected(g)
              ? 'border-primary/40 bg-primary/5 shadow-sm shadow-primary/5'
              : 'border-border hover:border-foreground/20'"
          >
            <!-- 已勾左侧色条 -->
            <span
              v-if="isGroupSelected(g)"
              class="absolute inset-y-0 left-0 w-0.5 bg-primary"
              aria-hidden="true"
            />

            <Checkbox
              :model-value="isGroupSelected(g)"
              @update:modelValue="toggleGroup(g)"
            />
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <span
                class="truncate font-mono text-sm font-semibold"
                :class="isGroupSelected(g) ? 'text-foreground' : 'text-foreground/80'"
              >
                {{ g.group }}
              </span>
              <Badge
                :variant="isGroupSelected(g) ? 'default' : 'secondary'"
                class="shrink-0 text-[10px]"
              >
                {{ g.productModels.length }} 型号
              </Badge>
            </div>

            <!-- 已绑主账号 chips + 绑定按钮 -->
            <div class="flex flex-wrap items-center gap-1.5">
              <template v-if="(groupToAccount[g.group]?.length ?? 0) > 0">
                <div class="hidden text-[11px] text-muted-foreground md:inline">{{ t('admin.assignPage.bound') }}</div>
                <Badge
                  v-for="aid in groupToAccount[g.group]"
                  :key="aid"
                  class="border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 hover:bg-emerald-100"
                  :title="getAccountName(aid)"
                >
                  {{ getAccountName(aid) }}
                </Badge>
              </template>
              <span
                v-else
                class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {{ t('admin.assignPage.unbound') }}
              </span>
              <Button
                size="sm"
                variant="outline"
                class="h-7 gap-1 px-2 text-[11px]"
                @click="openBindModal(g.group)"
              >
                <Edit3 v-if="(groupToAccount[g.group]?.length ?? 0) > 0" class="h-3 w-3" />
                <Link2 v-else class="h-3 w-3" />
                {{ (groupToAccount[g.group]?.length ?? 0) > 0 ? t('admin.assignPage.bindAction') : t('admin.assignPage.bindAction') }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 结果提示 -->
    <div
      v-if="result"
      class="flex items-start gap-3 overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm"
    >
      <div class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 class="h-4 w-4" />
      </div>
      <div class="text-emerald-900">
        {{ t('admin.assignPage.resultBound') }} <b class="font-semibold">{{ result.rows }}</b> {{ t('admin.assignPage.resultUnit') }}
        <span class="text-emerald-700/80">（{{ result.accounts }} 账户 × {{ result.groups }} 客户组）</span>
      </div>
    </div>

    <div
      v-if="ap.error.value"
      class="flex items-start gap-3 overflow-hidden rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm"
    >
      <div class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-100 text-red-700">
        <AlertTriangle class="h-4 w-4" />
      </div>
      <p class="text-red-800">{{ ap.error.value }}</p>
    </div>

    <!-- 绑定主账号 dialog -->
    <BindAccountsDialog
      v-model:open="bindDialogOpen"
      :group="bindGroup"
      :initial-selection="bindInitialSelection"
      :all-parents="allParents"
      :saving="savingBind"
      @submit="onSubmitBindSelection"
    />
  </div>
</template>
