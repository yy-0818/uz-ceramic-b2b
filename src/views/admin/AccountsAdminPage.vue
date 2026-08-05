<!--
  src/views/admin/AccountsAdminPage.vue
  主账号（父）+ 子账户 管理：admin 视角
  - 树形：父 → 子
  - 父 CRUD + 状态切换
  - 子 CRUD + 标记主联系 + 状态切换
  - 父 → 库存分类（12J/12P/12F/12K...）分配
  - "上传档案库" 跳到导入页
  - 5 个对话框已抽到 ./accounts-admin/*.vue；本页只剩列表 + 控制器
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '@/lib/i18n'
import {
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Upload,
  Users,
  Tag,
  Star,
  Edit,
  Power,
  PowerOff,
  X,
  MoreHorizontal,
  Folder,
  Check,
  Mail,
  KeyRound,
  Copy,
  Database,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowLeft,
} from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import AccountRowSkeleton from '@/components/ui/AccountRowSkeleton.vue'

import { useAccounts, type Account, type AccountType } from '@/composables/useAccounts'
import { useStockGroups, type StockGroup } from '@/composables/useStockGroups'
import { useCustomerAuth } from '@/composables/useCustomerAuth'
import { useCustomerInvites } from '@/composables/useCustomerInvites'

// 拆出的对话框组件
import ParentEditDialog from './accounts-admin/ParentEditDialog.vue'
import SubEditDialog from './accounts-admin/SubEditDialog.vue'
import AssignStockDialog from './accounts-admin/AssignStockDialog.vue'
import InviteDialog from './accounts-admin/InviteDialog.vue'
import ResetPasswordDialog from './accounts-admin/ResetPasswordDialog.vue'

const { t } = useI18n()
const router = useRouter()
const acc = useAccounts()
const stockGroups = useStockGroups()
const customerAuth = useCustomerAuth()
const invMgr = useCustomerInvites()

// ============ 主列表状态 ============
const parents = ref<Account[]>([])
const subsByParent = ref<Record<string, Account[]>>({})
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const expanded = ref<Record<string, boolean>>({})
const typeFilter = ref<'all' | AccountType>('all')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')
const page = ref(1)
const PAGE_SIZE = 12

const selected = ref<Set<string>>(new Set())
const lastSelectedId = ref<string | null>(null)

// 行菜单
//
// 之前用 :ref + setTriggerRef 收集按钮 DOM 再 getBoundingClientRect(),
// 但 shadcn-vue 的 <Button> 组件 :ref 拿到的是组件实例, el.$el 在某些
// shadcn-vue 版本(以及 as-child slot 下)是不可靠的 — 容易拿到错位
// 的坐标, 出现"菜单跟着上一行"这种诡异现象。
//
// 现在的做法: 直接在 @click 里传 MouseEvent, 用 event.currentTarget
// 拿到的就是真实触发的 <button> DOM 节点, 不依赖 ref 透传。
const openMenuId = ref<string | null>(null)
const menuPos = ref({ top: 0, left: 0, width: 208 })
const menuEl = ref<HTMLElement | null>(null)
const MENU_WIDTH = 208
const MENU_GAP = 4
const VIEWPORT_PAD = 8

const measureMenu = (): number => {
  const h = menuEl.value?.getBoundingClientRect().height
  return typeof h === 'number' && h > 0 ? h : 6 * 36 + 8 // 估算回退
}

const computePos = (trigger: HTMLElement, menuHeight: number) => {
  const r = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = MENU_WIDTH

  // 横向: 右对齐按钮右缘, 留 viewport 边距
  let left = r.right - width
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD
  if (left + width > vw - VIEWPORT_PAD) left = vw - VIEWPORT_PAD - width

  // 纵向: 默认下方展开, 放不下则向上展开
  const spaceBelow = vh - r.bottom - VIEWPORT_PAD
  const spaceAbove = r.top - VIEWPORT_PAD
  let top: number
  if (menuHeight <= spaceBelow) {
    top = r.bottom + MENU_GAP
  } else if (menuHeight <= spaceAbove) {
    top = r.top - menuHeight - MENU_GAP
  } else {
    // 都不够, 选择空间较大一侧贴着边缘
    if (spaceBelow >= spaceAbove) {
      top = vh - VIEWPORT_PAD - menuHeight
    } else {
      top = VIEWPORT_PAD
    }
  }

  return { top, left, width }
}

const toggleMenu = (e: MouseEvent, id: string) => {
  if (openMenuId.value === id) {
    openMenuId.value = null
    return
  }
  openMenuId.value = id
  const trigger = e.currentTarget as HTMLElement
  if (!trigger) return
  // DOM 还没 flush, 等下一帧让菜单先渲染出真实高度再算位置
  requestAnimationFrame(() => {
    const h = measureMenu()
    menuPos.value = computePos(trigger, h)
  })
}

const closeMenu = () => {
  openMenuId.value = null
}
const currentMenuParent = computed(() =>
  openMenuId.value ? (pagedParents.value.find((p) => p.id === openMenuId.value) ?? null) : null,
)
const isMobileMenu = ref(false)
const mql = typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)') : null
const syncMobile = () => {
  isMobileMenu.value = !!mql?.matches
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeMenu()
}
const onDocClick = (e: MouseEvent) => {
  if (!openMenuId.value) return
  if ((e.target as HTMLElement).closest('[data-row-menu]')) return
  if (menuEl.value && menuEl.value.contains(e.target as Node)) return
  closeMenu()
}
// 滚动时重定位: 触发按钮跟着滚走后, 菜单要"贴着"按钮
const onScrollOrResize = () => {
  if (!openMenuId.value) return
  // 找当前 openMenuId 对应的 <button> — 重新查询 DOM
  const btn = document.querySelector<HTMLElement>(`[data-row-menu][data-row-id="${openMenuId.value}"] button`)
  if (!btn) return
  menuPos.value = computePos(btn, measureMenu())
}

// ============ Dialog 控制器状态 ============
const parentEditOpen = ref(false)
const parentEditTarget = ref<Account | null>(null)

const subEditOpen = ref(false)
const subEditTarget = ref<Account | null>(null)
const subEditDefaultParentId = ref('')
const subEditDefaultType = ref<AccountType>('1_public')

const assignOpen = ref(false)
const assignTarget = ref<Account | null>(null)
const assignInitialCodes = ref<string[]>([])
const assignBatchCount = ref(0)
const allStockGroups = ref<StockGroup[]>([])

const inviteOpen = ref(false)
const inviteTarget = ref<Account | null>(null)
const inviteResult = ref<{
  url: string
  loginEmail: string
  expiresAt: string
  token: string
} | null>(null)

const resetOpen = ref(false)
const resetTarget = ref<Account | null>(null)
const resetTempPassword = ref<string | null>(null)

// ============ 常量 ============
const accountTypes = computed<Array<{ value: AccountType; label: string; desc: string; class: string }>>(() => [
  {
    value: '1_public',
    label: t('admin.accounts.type1Public'),
    desc: t('admin.accounts.rev'),
    class: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  {
    value: '2_cash',
    label: t('admin.accounts.type2Cash'),
    desc: t('admin.accounts.cash'),
    class: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  {
    value: '3_export',
    label: t('admin.accounts.type3Export'),
    desc: t('admin.accounts.exp'),
    class: 'bg-violet-100 text-violet-800 border-violet-200',
  },
])
const typeClass = (t: AccountType) => accountTypes.value.find((x) => x.value === t)?.class ?? ''

// ============ 数据加载 ============
const load = async () => {
  loading.value = true
  error.value = null
  try {
    const { parents: ps, subs } = await acc.fetchTree()
    parents.value = ps
    const map: Record<string, Account[]> = {}
    for (const s of subs) {
      if (!map[s.parent_id!]) map[s.parent_id!] = []
      map[s.parent_id!].push(s)
    }
    subsByParent.value = map
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('admin.accounts.expanded') || '{}')
    expanded.value = saved
  } catch {}
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
  window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true })
  window.addEventListener('resize', onScrollOrResize)
  syncMobile()
  mql?.addEventListener('change', syncMobile)
  load()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
  mql?.removeEventListener('change', syncMobile)
})

watch(
  expanded,
  (v) => {
    try {
      localStorage.setItem('admin.accounts.expanded', JSON.stringify(v))
    } catch {}
  },
  { deep: true },
)

// ============ 过滤 & 分页 ============
const filteredParents = computed(() => {
  const q = search.value.trim().toLowerCase()
  return parents.value.filter((p) => {
    if (typeFilter.value !== 'all' && p.account_type !== typeFilter.value) return false
    if (statusFilter.value !== 'all' && p.status !== statusFilter.value) return false
    if (!q) return true
    if (p.account_name.toLowerCase().includes(q)) return true
    const subs = subsByParent.value[p.id] ?? []
    return subs.some((s) => s.account_name.toLowerCase().includes(q) || (s.inn && s.inn.toLowerCase().includes(q)))
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredParents.value.length / PAGE_SIZE)))
const pagedParents = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredParents.value.slice(start, start + PAGE_SIZE)
})

// 折叠模式中间页码：始终显示 page ± 1 + 边界
const pageRangeCollapsed = computed(() => {
  const p = page.value
  const total = totalPages.value
  const start = Math.max(2, p - 1)
  const end = Math.min(total - 1, p + 1)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
})

watch([search, typeFilter, statusFilter], () => {
  page.value = 1
})
watch(filteredParents, () => {
  page.value = 1
})

const summary = computed(() => {
  const totalSubs = Object.values(subsByParent.value).reduce((s, arr) => s + arr.length, 0)
  const activeParents = parents.value.filter((p) => p.status === 'active').length
  const inactiveSubs = Object.values(subsByParent.value)
    .flat()
    .filter((s) => s.status === 'inactive').length
  return { totalParents: parents.value.length, activeParents, totalSubs, inactiveSubs }
})

const toggleExpand = (id: string) => {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}
const expandAll = () => {
  const next: Record<string, boolean> = {}
  for (const p of filteredParents.value) next[p.id] = true
  expanded.value = next
}
const collapseAll = () => {
  expanded.value = {}
}
const allExpanded = computed(() => {
  const list = filteredParents.value
  return list.length > 0 && list.every((p) => expanded.value[p.id])
})
const toggleExpandAll = () => (allExpanded.value ? collapseAll() : expandAll())

// ============ 选择 ============
const toggleSelect = (id: string, shift: boolean) => {
  const s = new Set(selected.value)
  if (shift && lastSelectedId.value) {
    const ids = pagedParents.value.map((p) => p.id)
    const a = ids.indexOf(lastSelectedId.value)
    const b = ids.indexOf(id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) s.add(ids[i])
    }
  } else if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
  lastSelectedId.value = id
}
const toggleSelectPage = () => {
  const ids = pagedParents.value.map((p) => p.id)
  const all = ids.every((id) => selected.value.has(id))
  const s = new Set(selected.value)
  if (all) ids.forEach((id) => s.delete(id))
  else ids.forEach((id) => s.add(id))
  selected.value = s
}
const clearSelection = () => {
  selected.value = new Set()
  lastSelectedId.value = null
}

// ============ 父：open + submit ============
const openParentCreate = () => {
  parentEditTarget.value = null
  parentEditOpen.value = true
}
const openParentEdit = (p: Account) => {
  parentEditTarget.value = p
  openMenuId.value = null
  parentEditOpen.value = true
}
const submitParent = async ({
  form,
}: {
  form: { account_name: string; account_type: AccountType; login_email: string }
}) => {
  loading.value = true
  error.value = null
  try {
    if (parentEditTarget.value) {
      await acc.updateParent(parentEditTarget.value.id, {
        account_name: form.account_name,
        account_type: form.account_type,
        login_email: form.login_email || null,
      } as any)
    } else {
      await acc.createParent({
        account_name: form.account_name,
        account_type: form.account_type,
        login_email: form.login_email || null,
      } as any)
    }
    parentEditOpen.value = false
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}
const toggleParent = async (p: Account) => {
  openMenuId.value = null
  if (
    !confirm(
      t('admin.accounts.confirmToggleParent', {
        action: p.status === 'active' ? t('admin.accounts.disabled') : t('admin.accounts.enabled'),
        name: p.account_name,
      }),
    )
  )
    return
  loading.value = true
  try {
    await acc.updateParent(p.id, { status: p.status === 'active' ? 'inactive' : 'active' })
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// ============ 子：open + submit ============
const openSubCreate = (parent: Account) => {
  openMenuId.value = null
  subEditTarget.value = null
  subEditDefaultParentId.value = parent.id
  subEditDefaultType.value = parent.account_type
  subEditOpen.value = true
}
const openSubEdit = (parent: Account, sub: Account) => {
  subEditTarget.value = sub
  subEditDefaultParentId.value = parent.id
  subEditOpen.value = true
}
const submitSub = async ({
  form,
}: {
  form: {
    parent_id: string
    account_name: string
    account_type: AccountType
    inn: string
    is_main: boolean
    status: 'active' | 'inactive'
  }
}) => {
  loading.value = true
  error.value = null
  try {
    if (subEditTarget.value) {
      await acc.updateSub(subEditTarget.value.id, {
        account_name: form.account_name,
        account_type: form.account_type,
        inn: form.inn || '-',
        is_main: form.is_main,
        status: form.status,
      })
    } else {
      await acc.createSub({
        parent_id: form.parent_id,
        account_name: form.account_name,
        account_type: form.account_type,
        inn: form.inn || '-',
        is_main: form.is_main,
        status: form.status,
      })
    }
    subEditOpen.value = false
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}
const setMain = async (parentId: string, sub: Account) => {
  await acc.setMain(parentId, sub.id)
  await load()
}

// ============ 分配：open + submit ============
const openAssign = async (parent: Account) => {
  openMenuId.value = null
  assignTarget.value = parent
  loading.value = true
  try {
    if (allStockGroups.value.length === 0) {
      allStockGroups.value = await stockGroups.fetchAll()
    }
    assignInitialCodes.value = await stockGroups.fetchAssignedForParent(parent.id)
    assignOpen.value = true
  } finally {
    loading.value = false
  }
}
const batchAssign = async () => {
  const ids = Array.from(selected.value)
  if (ids.length === 0) return
  if (allStockGroups.value.length === 0) {
    allStockGroups.value = await stockGroups.fetchAll()
  }
  const first = ids[0]
  assignTarget.value = null
  assignInitialCodes.value = await stockGroups.fetchAssignedForParent(first)
  assignBatchCount.value = ids.length
  assignOpen.value = true
}
const submitAssign = async ({ codes }: { codes: string[] }) => {
  loading.value = true
  try {
    if (assignTarget.value) {
      await stockGroups.assignForParent(assignTarget.value.id, codes)
    } else {
      for (const id of selected.value) {
        await stockGroups.assignForParent(id, codes)
      }
      clearSelection()
    }
    assignOpen.value = false
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}
const batchToggle = async (to: 'active' | 'inactive') => {
  if (selected.value.size === 0) return
  if (
    !confirm(
      t('admin.accounts.confirmBatchToggle', {
        n: selected.value.size,
        state: to === 'active' ? t('admin.accounts.active') : t('admin.accounts.disabled'),
      }),
    )
  )
    return
  loading.value = true
  try {
    for (const id of selected.value) {
      await acc.updateParent(id, { status: to })
    }
    clearSelection()
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// ============ 邀请：open + submit ============
const openInvite = (parent: Account) => {
  openMenuId.value = null
  inviteTarget.value = parent
  inviteResult.value = null
  error.value = null
  invMgr.invites.value = []
  inviteOpen.value = true
}
const submitInvite = async () => {
  if (!inviteTarget.value) return
  try {
    const { url, loginEmail } = await customerAuth.createInvite(
      inviteTarget.value.id,
      inviteTarget.value.account_name,
      inviteTarget.value.id,
    )
    inviteResult.value = {
      url,
      loginEmail,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      token: url.split('token=')[1] ?? '',
    }
  } catch (e: any) {
    error.value = e.message ?? String(e)
  }
}
const fetchInviteHistory = async () => {
  invMgr.invites.value = []
  if (inviteTarget.value) {
    await invMgr.fetchForAccount(inviteTarget.value.id)
  }
}
const revokeInvite = async (id: string) => {
  await invMgr.revokeInvite(id)
  alert(t('admin.accounts.inviteRevoked'))
}

// ============ 重置密码：open + submit ============
const openReset = (parent: Account) => {
  openMenuId.value = null
  resetTarget.value = parent
  resetTempPassword.value = null
  resetOpen.value = true
}
const submitReset = async () => {
  if (!resetTarget.value) return
  loading.value = true
  try {
    resetTempPassword.value = await customerAuth.resetPassword(resetTarget.value.id)
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

const goImport = () => router.push('/admin/accounts/import')

const goBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/admin')
}
</script>

<template>
  <div class="space-y-4">
    <!-- ===================== 顶部 hero ===================== -->
    <header
      class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4 sm:py-5"
    >
      <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      <div class="pointer-events-none absolute -right-4 top-1/2 h-24 w-24 rounded-full bg-primary/5" />

      <div class="relative flex items-start gap-2 flex-wrap">
        <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0 -ml-1" @click="goBack">
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 flex-wrap">
            <h1 class="text-base sm:text-lg font-bold leading-tight">
              {{ t('admin.accounts.title') }}
            </h1>
            <span class="text-[10px] font-semibold tracking-wider text-primary uppercase">
              Parent · Subs · StockGroups
            </span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
            客户主账号 + 子账户 + 库存分类分配；支持新增 / 编辑 / 启停 / 邀请 / 重置密码。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" @click="load" :disabled="loading">
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
            <span class="hidden sm:inline ml-1">{{ t('admin.accounts.refresh') }}</span>
          </Button>
          <Button size="sm" variant="outline" @click="goImport">
            <Upload class="h-4 w-4" />
            <span class="hidden sm:inline ml-1">{{ t('admin.accounts.uploadArchive') }}</span>
          </Button>
          <Button size="sm" @click="openParentCreate" class="shadow-md shadow-primary/20">
            <Plus class="h-4 w-4" />
            <span class="hidden sm:inline ml-1">{{ t('admin.accounts.newParent') }}</span>
          </Button>
        </div>
      </div>
    </header>

    <!-- ===================== KPI（与新视觉一致：mini summary 卡） ===================== -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card class="overflow-hidden">
        <CardContent class="p-0">
          <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-3">
            <div class="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <Folder class="h-3.5 w-3.5 text-blue-600" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                {{ t('admin.accounts.kpiParents') }}
              </p>
              <p class="text-lg font-bold tabular-nums leading-tight mt-0.5">
                {{ summary.totalParents }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card class="overflow-hidden">
        <CardContent class="p-0">
          <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-3">
            <div class="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                {{ t('admin.accounts.kpiActiveParents') }}
              </p>
              <p class="text-lg font-bold tabular-nums leading-tight mt-0.5">
                {{ summary.activeParents }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card class="overflow-hidden">
        <CardContent class="p-0">
          <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-3">
            <div class="h-7 w-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
              <Users class="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                {{ t('admin.accounts.kpiSubs') }}
              </p>
              <p class="text-lg font-bold tabular-nums leading-tight mt-0.5">
                {{ summary.totalSubs }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card class="overflow-hidden">
        <CardContent class="p-0">
          <div class="px-4 py-3 border-b bg-muted/20 flex items-center gap-3">
            <div class="h-7 w-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
              <EyeOff class="h-3.5 w-3.5 text-gray-500" />
            </div>
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                {{ t('admin.accounts.kpiInactiveSubs') }}
              </p>
              <p class="text-lg font-bold tabular-nums leading-tight mt-0.5">
                {{ summary.inactiveSubs }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- ============ 搜索 + 展开折叠 + 过滤 ============ -->
    <Card>
      <CardContent class="py-3 space-y-3">
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input v-model="search" :placeholder="t('admin.accounts.searchPh')" class="pl-9 h-8 text-sm" />
          </div>
          <Button
            size="sm"
            variant="ghost"
            @click="toggleExpandAll"
            class="shrink-0"
            :title="allExpanded ? t('common.collapseAll') : t('common.expandAll')"
          >
            <ChevronDown v-if="!allExpanded" class="h-4 w-4" />
            <ChevronRight v-else class="h-4 w-4" />
          </Button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :class="typeFilter === 'all' ? 'border-primary text-primary' : ''"
            @click="typeFilter = 'all'"
          >
            {{ t('admin.accounts.typeAll') }}
          </Button>
          <Button
            v-for="t in accountTypes"
            :key="t.value"
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :class="typeFilter === t.value ? 'border-primary text-primary' : ''"
            @click="typeFilter = t.value"
          >
            {{ t.label }}
          </Button>
          <span class="w-px h-5 bg-border mx-1" />
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :class="statusFilter === 'all' ? 'border-primary text-primary' : ''"
            @click="statusFilter = 'all'"
          >
            {{ t('admin.accounts.statusAll') }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :class="statusFilter === 'active' ? 'border-primary text-primary' : ''"
            @click="statusFilter = 'active'"
          >
            {{ t('admin.accounts.active') }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :class="statusFilter === 'inactive' ? 'border-primary text-primary' : ''"
            @click="statusFilter = 'inactive'"
          >
            {{ t('admin.accounts.inactive') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- ============ 行菜单（Teleport → body） ============ -->
    <Teleport to="body">
      <div
        v-if="currentMenuParent"
        ref="menuEl"
        :style="{
          position: 'fixed',
          top: menuPos.top + 'px',
          left: menuPos.left + 'px',
          width: menuPos.width + 'px',
        }"
        class="bg-popover border rounded-lg shadow-xl py-1 z-[9999]"
        role="menu"
        @click.stop
      >
        <template v-if="isMobileMenu">
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
            @click="
              openAssign(currentMenuParent)
              closeMenu()
            "
          >
            <Tag class="h-4 w-4 text-muted-foreground" />
            {{ t('admin.accounts.menuAssign') }}
          </button>
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
            @click="
              openSubCreate(currentMenuParent)
              closeMenu()
            "
          >
            <Plus class="h-4 w-4 text-muted-foreground" />
            {{ t('admin.accounts.menuAddSub') }}
          </button>
          <div class="my-1 border-t" />
        </template>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
          @click="
            openParentEdit(currentMenuParent)
            closeMenu()
          "
        >
          <Edit class="h-4 w-4 text-muted-foreground" />
          {{ t('admin.accounts.menuEdit') }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
          @click="
            openInvite(currentMenuParent)
            closeMenu()
          "
        >
          <Mail class="h-4 w-4 text-muted-foreground" />
          {{ t('admin.accounts.menuInvite') }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
          @click="
            openReset(currentMenuParent)
            closeMenu()
          "
        >
          <KeyRound class="h-4 w-4 text-muted-foreground" />
          {{ t('admin.accounts.menuReset') }}
        </button>
        <div class="my-1 border-t" />
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-destructive/10 text-destructive flex items-center gap-2"
          @click="
            toggleParent(currentMenuParent)
            closeMenu()
          "
        >
          <PowerOff v-if="currentMenuParent.status === 'active'" class="h-4 w-4" />
          <Power v-else class="h-4 w-4" />
          {{ currentMenuParent.status === 'active' ? t('admin.accounts.disabled') : t('admin.accounts.enabled') }}
        </button>
      </div>
    </Teleport>

    <!-- ============ 批量操作条（粘性） ============ -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="selected.size > 0"
        class="sticky top-0 z-10 bg-primary text-primary-foreground rounded-lg shadow-lg px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap"
      >
        <div class="flex items-center gap-3">
          <div class="text-sm font-medium">
            {{ t('admin.accounts.selected') }}
            <span class="text-lg tabular-nums">{{ selected.size }}</span>
            {{ t('admin.accounts.parentsUnit') }}
          </div>
          <Button
            size="sm"
            variant="ghost"
            class="text-primary-foreground hover:bg-primary-foreground/10 h-7"
            @click="clearSelection"
          >
            <X class="h-3 w-3 mr-1" />
            {{ t('admin.accounts.clear') }}
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="secondary" @click="batchAssign">
            <Tag class="h-3.5 w-3.5 mr-1" />
            {{ t('admin.accounts.batchAssign') }}
          </Button>
          <Button size="sm" variant="secondary" @click="batchToggle('active')">
            <Power class="h-3.5 w-3.5 mr-1" />
            {{ t('admin.accounts.enabled') }}
          </Button>
          <Button size="sm" variant="secondary" @click="batchToggle('inactive')">
            <PowerOff class="h-3.5 w-3.5 mr-1" />
            {{ t('admin.accounts.disabled') }}
          </Button>
        </div>
      </div>
    </Transition>

    <!-- ============ 加载 / 空 ============ -->
    <div v-if="loading && parents.length === 0" class="space-y-2">
      <AccountRowSkeleton v-for="i in 5" :key="i" />
    </div>
    <div v-else-if="filteredParents.length === 0" class="text-center py-12 border border-dashed rounded-lg">
      <Database class="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
      <p class="text-sm text-muted-foreground mb-4">
        {{ parents.length === 0 ? t('admin.accounts.empty1') : t('admin.accounts.empty2') }}
      </p>
      <div class="flex justify-center gap-2">
        <Button v-if="parents.length === 0" size="sm" @click="goImport">
          <Upload class="h-4 w-4 mr-1" />
          {{ t('admin.accounts.uploadCta') }}
        </Button>
        <Button
          v-else
          size="sm"
          variant="outline"
          @click="
            search = ''
            typeFilter = 'all'
            statusFilter = 'all'
          "
        >
          {{ t('admin.accounts.clearFilter') }}
        </Button>
      </div>
    </div>

    <!-- ============ 树（分页） ============ -->
    <div v-else class="space-y-2">
      <div class="flex items-center justify-between text-xs text-muted-foreground px-1">
        <label class="flex items-center gap-2 cursor-pointer hover:text-foreground">
          <input
            type="checkbox"
            class="rounded"
            :checked="pagedParents.every((p) => selected.has(p.id)) && pagedParents.length > 0"
            @change="toggleSelectPage"
          />
          {{ t('admin.accounts.page', { p: page, total: totalPages, n: filteredParents.length }) }}
        </label>
        <span v-if="selected.size > 0" class="text-primary">
          {{ t('admin.accounts.pageSelected', { n: selected.size }) }}
        </span>
      </div>

      <Card v-for="p in pagedParents" :key="p.id" class="overflow-hidden">
        <div
          class="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition"
          :class="selected.has(p.id) ? 'bg-primary/5' : 'hover:bg-muted/40'"
        >
          <input
            type="checkbox"
            class="rounded shrink-0"
            :checked="selected.has(p.id)"
            @click.stop
            @change="toggleSelect(p.id, ($event as MouseEvent).shiftKey)"
          />
          <button class="shrink-0 p-1 -m-1 rounded hover:bg-muted" @click.stop="toggleExpand(p.id)">
            <component :is="expanded[p.id] ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
          </button>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold truncate">{{ p.account_name }}</span>
              <span
                class="text-xs inline-flex items-center px-1.5 py-0.5 rounded border font-medium"
                :class="typeClass(p.account_type)"
              >
                {{ accountTypes.find((x) => x.value === p.account_type)?.label }}
              </span>
              <span
                v-if="p.status === 'active'"
                class="text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {{ t('admin.accounts.active') }}
              </span>
              <span
                v-else
                class="text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-gray-400" />
                {{ t('admin.accounts.disabled') }}
              </span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ subsByParent[p.id]?.length ?? 0 }} {{ t('admin.accounts.subsUnit') }}
              <span v-if="subsByParent[p.id]?.length">
                · {{ (subsByParent[p.id] ?? []).filter((s) => s.status === 'active').length }}
                {{ t('admin.accounts.subsActiveSuffix') }}
              </span>
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="outline" @click.stop="openAssign(p)" class="h-8 hidden sm:inline-flex">
              <Tag class="h-3.5 w-3.5 sm:mr-1" />
              <span class="hidden md:inline">{{ t('admin.accounts.menuAssign') }}</span>
            </Button>
            <Button size="sm" variant="outline" @click.stop="openSubCreate(p)" class="h-8 hidden sm:inline-flex">
              <Plus class="h-3.5 w-3.5 sm:mr-1" />
              <span class="hidden md:inline">{{ t('admin.accounts.menuAddSub') }}</span>
            </Button>
            <div class="relative" data-row-menu :data-row-id="p.id">
              <Button size="sm" variant="ghost" class="h-8 w-8 p-0" @click.stop="toggleMenu($event, p.id)">
                <MoreHorizontal class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div v-show="expanded[p.id]" class="border-t bg-muted/20 px-4 py-3 space-y-2">
          <p class="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Users class="h-3 w-3" />
            {{ t('admin.accounts.sub') }} ({{ (subsByParent[p.id] ?? []).length }})
          </p>
          <div v-if="(subsByParent[p.id] ?? []).length === 0" class="text-xs text-muted-foreground py-2 text-center">
            {{ t('admin.accounts.noSubs') }}
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="s in subsByParent[p.id]"
              :key="s.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 transition"
            >
              <Star v-if="s.is_main" class="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <Users v-else class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span class="text-sm flex-1 truncate">{{ s.account_name }}</span>
              <span v-if="s.inn" class="text-xs text-muted-foreground font-mono hidden sm:inline">{{ s.inn }}</span>
              <span
                class="text-xs px-1.5 py-0.5 rounded"
                :class="s.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'"
              >
                {{ s.status === 'active' ? t('admin.accounts.subAvailable') : t('admin.accounts.disabled') }}
              </span>
              <Button
                v-if="!s.is_main"
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0"
                @click="setMain(p.id, s)"
                :title="t('admin.accounts.setMain')"
              >
                <Star class="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0"
                @click="openSubEdit(p, s)"
                :title="t('admin.accounts.menuEdit')"
              >
                <Edit class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <!-- ============ 分页 ============ -->
    <div
      v-if="filteredParents.length > PAGE_SIZE"
      class="flex flex-col sm:flex-row items-center justify-between gap-3 px-1"
    >
      <p class="text-xs text-muted-foreground tabular-nums">
        第
        <span class="font-medium text-foreground">{{ page }}</span>
        /
        <span class="font-medium text-foreground">{{ totalPages }}</span>
        页 · 共
        <span class="font-medium text-foreground">{{ filteredParents.length }}</span>
        个父账号 · 每页 {{ PAGE_SIZE }}
      </p>
      <div class="flex items-center gap-1">
        <Button size="sm" variant="outline" :disabled="page === 1" class="h-8 px-2" @click="page = 1">«</Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="page === 1"
          class="h-8 px-2"
          @click="page = Math.max(1, page - 1)"
          :title="t('common.prevPage') || '上一页'"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
        </Button>

        <!-- 页码 chips：总页数 ≤ 7 全部展示，否则折叠 -->
        <template v-if="totalPages <= 7">
          <Button
            v-for="n in totalPages"
            :key="n"
            size="sm"
            :variant="page === n ? 'default' : 'outline'"
            class="h-8 min-w-8 px-2 tabular-nums"
            @click="page = n"
          >
            {{ n }}
          </Button>
        </template>
        <template v-else>
          <Button
            size="sm"
            :variant="page === 1 ? 'default' : 'outline'"
            class="h-8 min-w-8 px-2 tabular-nums"
            @click="page = 1"
          >
            1
          </Button>
          <span v-if="page > 3" class="px-1 text-xs text-muted-foreground">…</span>
          <Button
            v-for="n in pageRangeCollapsed"
            :key="`mid-${n}`"
            size="sm"
            :variant="page === n ? 'default' : 'outline'"
            class="h-8 min-w-8 px-2 tabular-nums"
            @click="page = n"
          >
            {{ n }}
          </Button>
          <span v-if="page < totalPages - 2" class="px-1 text-xs text-muted-foreground">…</span>
          <Button
            size="sm"
            :variant="page === totalPages ? 'default' : 'outline'"
            class="h-8 min-w-8 px-2 tabular-nums"
            @click="page = totalPages"
          >
            {{ totalPages }}
          </Button>
        </template>

        <Button
          size="sm"
          variant="outline"
          :disabled="page === totalPages"
          class="h-8 px-2"
          @click="page = Math.min(totalPages, page + 1)"
          :title="t('common.nextPage') || '下一页'"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" :disabled="page === totalPages" class="h-8 px-2" @click="page = totalPages">
          »
        </Button>
      </div>
    </div>

    <!-- ============ 拆出的对话框 ============ -->
    <ParentEditDialog
      v-model:open="parentEditOpen"
      :target="parentEditTarget"
      :loading="loading"
      @submit="submitParent"
    />

    <SubEditDialog
      v-model:open="subEditOpen"
      :target="subEditTarget"
      :default-parent-id="subEditDefaultParentId"
      :default-account-type="subEditDefaultType"
      :loading="loading"
      @submit="submitSub"
    />

    <AssignStockDialog
      v-model:open="assignOpen"
      :target="assignTarget"
      :stock-groups="allStockGroups"
      :initial-codes="assignInitialCodes"
      :apply-count="assignBatchCount"
      :loading="loading"
      @submit="submitAssign"
    />

    <InviteDialog
      v-model:open="inviteOpen"
      :target="inviteTarget"
      :inv-mgr="invMgr"
      :invite-result="inviteResult"
      :loading="loading"
      @generate="submitInvite"
      @fetch-history="fetchInviteHistory"
      @revoke="revokeInvite"
    />

    <ResetPasswordDialog
      v-model:open="resetOpen"
      :target="resetTarget"
      :loading="loading"
      :temp-password="resetTempPassword"
      @generate="submitReset"
    />
  </div>
</template>

<style scoped>
input[type='checkbox'] {
  cursor: pointer;
}
</style>
