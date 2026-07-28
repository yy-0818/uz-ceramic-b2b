<!--
  src/views/admin/AccountsAdminPage.vue
  主账号（父）+ 子账户 管理：admin 视角
  - 树形：父 → 子
  - 父 CRUD + 状态切换
  - 子 CRUD + 标记主联系 + 状态切换
  - 父 → 库存分类（12J/12P/12F/12K...）分配
  - "上传档案库" 跳到导入页
  v2: 响应式更紧凑、KPI 卡片、分页、列对齐、暗色适配
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Loader2, Plus, RefreshCw, Search, ChevronRight, ChevronDown,
  Upload, Users, Tag, Star, Edit, Power, PowerOff, X,
  MoreHorizontal, Folder, Check, Mail, KeyRound, Copy,
  Database, CheckCircle2, Eye, EyeOff, Filter,
} from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Dialog from '@/components/ui/Dialog.vue'

import { useAccounts, type Account, type AccountType } from '@/composables/useAccounts'
import { useStockGroups, type StockGroup } from '@/composables/useStockGroups'
import { useCustomerAuth } from '@/composables/useCustomerAuth'
import { useCustomerInvites } from '@/composables/useCustomerInvites'
import { useI18n } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n'

const router = useRouter()
const acc = useAccounts()
const stockGroups = useStockGroups()
const customerAuth = useCustomerAuth()
const invMgr = useCustomerInvites()
const { t, locale, tForLocale } = useI18n()

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

// 选择（批量操作用）
const selected = ref<Set<string>>(new Set())
const lastSelectedId = ref<string | null>(null)

// 菜单面板（"更多"下拉）
const openMenuId = ref<string | null>(null)
// 菜单 fixed 定位坐标：基于 ⋯ 按钮的 getBoundingClientRect
const menuPos = ref({ top: 0, left: 0, width: 208 }) // 208 = w-52

const triggerRefs = ref<Record<string, HTMLElement | null>>({})
const setTriggerRef = (id: string, el: any) => {
  // el 可能为 component instance → 用 $el
  triggerRefs.value[id] = el?.$el ?? el
}

const toggleMenu = (id: string) => {
  if (openMenuId.value === id) {
    openMenuId.value = null
    return
  }
  openMenuId.value = id
  // 计算 fixed 坐标：放在按钮下方、右对齐
  const btn = triggerRefs.value[id]
  if (btn) {
    const r = btn.getBoundingClientRect()
    menuPos.value = {
      top: r.bottom + 4,         // mt-1
      left: r.right - 208,       // right-0
      width: 208,
    }
  }
}
const closeMenu = () => { openMenuId.value = null }

// 当前打开菜单对应的主账号行（给 Teleport 菜单渲染用）
const currentMenuParent = computed(() =>
  openMenuId.value ? pagedParents.value.find(p => p.id === openMenuId.value) ?? null : null,
)

// 移动端判断：< 640px（sm 断点）把行内按钮折叠进 ···
const isMobileMenu = ref(false)
const mql = typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)') : null
const syncMobile = () => { isMobileMenu.value = !!mql?.matches }

// 全局：Esc 关闭 + 外点关闭 + 滚动/resize 重算坐标
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeMenu()
}
const onDocClick = (e: MouseEvent) => {
  if (!openMenuId.value) return
  const target = e.target as HTMLElement
  // 点击下拉触发按钮或菜单本体时由 @click.stop 拦截
  if (target.closest('[data-row-menu]')) return
  closeMenu()
}
const reposition = () => {
  if (!openMenuId.value) return
  const btn = triggerRefs.value[openMenuId.value]
  if (!btn) return
  const r = btn.getBoundingClientRect()
  menuPos.value = {
    top: r.bottom + 4,
    left: r.right - 208,
    width: 208,
  }
}

// dialogs
const parentEditOpen = ref(false)
const parentEditTarget = ref<Account | null>(null)
const subEditOpen = ref(false)
const subEditTarget = ref<Account | null>(null)
const assignOpen = ref(false)
const assignTarget = ref<Account | null>(null)
const assignCategoriesState = ref<string[]>([])
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

const accountTypes: Array<{ value: AccountType; label: string; desc: string; class: string }> = [
  { value: '1_public', label: '1 公户', desc: '对公大客户', class: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: '2_cash',   label: '2 现金', desc: '现金客户',     class: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: '3_export', label: '3 出口', desc: '出口客户',     class: 'bg-violet-100 text-violet-800 border-violet-200' },
]
const typeClass = (t: AccountType) => accountTypes.find((x) => x.value === t)?.class ?? ''

const parentForm = ref({
  account_name: '',
  account_type: '1_public' as AccountType,
  login_email: '',
})
const subForm = ref({
  parent_id: '',
  account_name: '',
  account_type: '1_public' as AccountType,
  inn: '',
  is_main: false,
  status: 'active' as 'active' | 'inactive',
})

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
  // 恢复展开状态
  try {
    const saved = JSON.parse(localStorage.getItem('admin.accounts.expanded') || '{}')
    expanded.value = saved
  } catch {}
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
  syncMobile()
  mql?.addEventListener('change', syncMobile)
  load()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
  mql?.removeEventListener('change', syncMobile)
})

watch(expanded, (v) => {
  try { localStorage.setItem('admin.accounts.expanded', JSON.stringify(v)) } catch {}
}, { deep: true })

// ============ 过滤 & 分页 ============
const filteredParents = computed(() => {
  const q = search.value.trim().toLowerCase()
  return parents.value.filter((p) => {
    if (typeFilter.value !== 'all' && p.account_type !== typeFilter.value) return false
    if (statusFilter.value !== 'all' && p.status !== statusFilter.value) return false
    if (!q) return true
    if (p.account_name.toLowerCase().includes(q)) return true
    const subs = subsByParent.value[p.id] ?? []
    return subs.some((s) =>
      s.account_name.toLowerCase().includes(q) ||
      (s.inn && s.inn.toLowerCase().includes(q)),
    )
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredParents.value.length / PAGE_SIZE)))
const pagedParents = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredParents.value.slice(start, start + PAGE_SIZE)
})

watch([search, typeFilter, statusFilter], () => { page.value = 1 })

const summary = computed(() => {
  const totalSubs = Object.values(subsByParent.value).reduce((s, arr) => s + arr.length, 0)
  const activeParents = parents.value.filter((p) => p.status === 'active').length
  const inactiveSubs = Object.values(subsByParent.value).flat().filter((s) => s.status === 'inactive').length
  return {
    totalParents: parents.value.length,
    activeParents,
    totalSubs,
    inactiveSubs,
  }
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

// ============ 选择 ============
const toggleSelect = (id: string, shift: boolean) => {
  const s = new Set(selected.value)
  if (shift && lastSelectedId.value) {
    // 范围选择
    const ids = pagedParents.value.map((p) => p.id)
    const a = ids.indexOf(lastSelectedId.value)
    const b = ids.indexOf(id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) s.add(ids[i])
    }
  } else if (s.has(id)) {
    s.delete(id)
  } else {
    s.add(id)
  }
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

// ============ 父 CRUD ============
const openParentCreate = () => {
  parentEditTarget.value = null
  parentForm.value = { account_name: '', account_type: '1_public', login_email: '' }
  parentEditOpen.value = true
}
const openParentEdit = (p: Account) => {
  parentEditTarget.value = p
  parentForm.value = {
    account_name: p.account_name,
    account_type: p.account_type,
    login_email: (p as any).login_email ?? '',
  }
  openMenuId.value = null
  parentEditOpen.value = true
}
const submitParent = async () => {
  if (!parentForm.value.account_name) {
    error.value = '请填写主账号名'
    return
  }
  if (parentForm.value.login_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentForm.value.login_email)) {
    error.value = '登录邮箱格式不正确'
    return
  }
  loading.value = true
  try {
    if (parentEditTarget.value) {
      await acc.updateParent(parentEditTarget.value.id, {
        account_name: parentForm.value.account_name,
        account_type: parentForm.value.account_type,
        login_email: parentForm.value.login_email || null,
      } as any)
    } else {
      await acc.createParent({
        account_name: parentForm.value.account_name,
        account_type: parentForm.value.account_type,
        login_email: parentForm.value.login_email || null,
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
  if (!confirm(`${p.status === 'active' ? '停用' : '启用'} 主账号 "${p.account_name}"？\n所有子账号会被同步停用。`)) return
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

// ============ 子 CRUD ============
const openSubCreate = (parent: Account) => {
  openMenuId.value = null
  subEditTarget.value = null
  subForm.value = {
    parent_id: parent.id,
    account_name: '',
    account_type: parent.account_type,
    inn: '',
    is_main: false,
    status: 'active',
  }
  subEditOpen.value = true
}
const openSubEdit = (parent: Account, sub: Account) => {
  subEditTarget.value = sub
  subForm.value = {
    parent_id: parent.id,
    account_name: sub.account_name,
    account_type: sub.account_type,
    inn: sub.inn,
    is_main: sub.is_main,
    status: sub.status,
  }
  subEditOpen.value = true
}
const submitSub = async () => {
  if (!subForm.value.account_name) {
    error.value = '请填写子账号名'
    return
  }
  loading.value = true
  try {
    if (subEditTarget.value) {
      await acc.updateSub(subEditTarget.value.id, {
        account_name: subForm.value.account_name,
        account_type: subForm.value.account_type,
        inn: subForm.value.inn || '-',
        is_main: subForm.value.is_main,
        status: subForm.value.status,
      })
    } else {
      await acc.createSub({
        parent_id: subForm.value.parent_id,
        account_name: subForm.value.account_name,
        account_type: subForm.value.account_type,
        inn: subForm.value.inn || '-',
        is_main: subForm.value.is_main,
        status: subForm.value.status,
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

// ============ 分配库存组 ============
const openAssign = async (parent: Account) => {
  openMenuId.value = null
  assignTarget.value = parent
  loading.value = true
  try {
    if (allStockGroups.value.length === 0) {
      allStockGroups.value = await stockGroups.fetchAll()
    }
    assignCategoriesState.value = await stockGroups.fetchAssignedForParent(parent.id)
    assignOpen.value = true
  } finally {
    loading.value = false
  }
}
const submitAssign = async () => {
  if (!assignTarget.value) return
  loading.value = true
  try {
    await stockGroups.assignForParent(assignTarget.value.id, assignCategoriesState.value)
    assignOpen.value = false
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}
const toggleCategory = (cat: string) => {
  if (assignCategoriesState.value.includes(cat)) {
    assignCategoriesState.value = assignCategoriesState.value.filter((c) => c !== cat)
  } else {
    assignCategoriesState.value = [...assignCategoriesState.value, cat]
  }
}
const selectAllAssigned = () => {
  assignCategoriesState.value = allStockGroups.value.map((g) => g.code)
}
const selectNoneAssigned = () => {
  assignCategoriesState.value = []
}

// ============ 邀请 / 重置密码 ============
// Tab 状态
const inviteTab = ref<'send' | 'history'>('send')
const inviteTplLang = ref<'ru' | 'uz' | 'zh'>('ru')

const inviteTabs = computed((): { key: 'send' | 'history'; label: string }[] => [
  { key: 'send', label: t('admin.invites.tabSend') },
  { key: 'history', label: t('admin.invites.tabHistory') },
])

const switchInviteTab = async (key: 'send' | 'history') => {
  inviteTab.value = key
  if (key === 'history') {
    invMgr.invites.value = []   // 清旧数据，避免残留
    if (inviteTarget.value) {
      await invMgr.fetchForAccount(inviteTarget.value.id)
    }
  }
}

// 多语言模板（用 inviteTplLang 选语言，tForLocale 查对应语言文案）
const inviteTemplate = (result: NonNullable<typeof inviteResult.value>) => {
  const accountName = inviteTarget.value?.account_name ?? ''
  const greeting = inviteTplLang.value === 'zh' ? '您好' : inviteTplLang.value === 'uz' ? 'Assalomu alaykum' : 'Здравствуйте'
  const brand = inviteTplLang.value === 'zh' ? '陶瓷 · B2B' : inviteTplLang.value === 'uz' ? 'Keramika · B2B' : 'Керамика · B2B'
  return tForLocale(inviteTplLang.value, 'admin.invites.templateBody', {
    greeting,
    accountName,
    expiresDays: 7,
    url: result.url,
    loginEmail: result.loginEmail,
    brand,
  })
}

// 统计 badge
const inviteStats = computed(() => [
  { key: 'pending', label: t('admin.invites.statPending'), count: invMgr.stats.value.pending, cls: 'bg-blue-400' },
  { key: 'used', label: t('admin.invites.statUsed'), count: invMgr.stats.value.used, cls: 'bg-green-400' },
  { key: 'expired', label: t('admin.invites.statExpired'), count: invMgr.stats.value.expired, cls: 'bg-gray-400' },
  { key: 'revoked', label: t('admin.invites.statRevoked'), count: invMgr.stats.value.revoked, cls: 'bg-red-400' },
])

const inviteStatusLabel = (s: string) => {
  const map: Record<string, string> = {
    pending: t('admin.invites.statusPending'),
    used: t('admin.invites.statusUsed'),
    expired: t('admin.invites.statusExpired'),
    revoked: t('admin.invites.statusRevoked'),
  }
  return map[s] ?? s
}

const copyInviteUrlFor = async (inv: (typeof invMgr.invites.value)[number]) => {
  const url = `${window.location.origin}/customer-invite?token=${inv.token}`
  await navigator.clipboard.writeText(url)
  alert(t('admin.invites.copied'))
}

const handleRevoke = async (inv: (typeof invMgr.invites.value)[number]) => {
  if (!confirm(t('admin.invites.revokeConfirm'))) return
  await invMgr.revokeInvite(inv.id)
  alert(t('admin.invites.revokeDone'))
}

const openInvite = (parent: Account) => {
  openMenuId.value = null
  inviteTarget.value = parent
  inviteResult.value = null
  error.value = null
  inviteTab.value = 'send'
  invMgr.invites.value = []   // 清历史，避免切账号时残留旧数据
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
const copyInviteUrl = async () => {
  if (!inviteResult.value) return
  try {
    await navigator.clipboard.writeText(inviteResult.value.url)
    alert(t('admin.invites.copied'))
  } catch {
    prompt('复制这一行：', inviteResult.value.url)
  }
}
const copyLoginEmail = async () => {
  if (!inviteResult.value) return
  try {
    await navigator.clipboard.writeText(inviteResult.value.loginEmail)
    alert(t('admin.invites.copied'))
  } catch {
    prompt('复制这一行：', inviteResult.value.loginEmail)
  }
}

const copyTempPassword = async () => {
  if (!resetTempPassword.value) return
  try {
    await navigator.clipboard.writeText(resetTempPassword.value)
    alert('已复制临时密码')
  } catch {
    prompt('复制这一行：', resetTempPassword.value)
  }
}

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

// ============ 批量操作 ============
const batchAssign = async () => {
  const ids = Array.from(selected.value)
  if (ids.length === 0) return
  if (allStockGroups.value.length === 0) {
    allStockGroups.value = await stockGroups.fetchAll()
  }
  // 用第一个选中做初始值
  const first = ids[0]
  assignCategoriesState.value = await stockGroups.fetchAssignedForParent(first)
  assignTarget.value = null
  assignOpen.value = true
}
const submitBatchAssign = async () => {
  loading.value = true
  try {
    for (const id of selected.value) {
      await stockGroups.assignForParent(id, assignCategoriesState.value)
    }
    assignOpen.value = false
    clearSelection()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}
const batchToggle = async (to: 'active' | 'inactive') => {
  if (selected.value.size === 0) return
  if (!confirm(`将 ${selected.value.size} 个主账号设为「${to === 'active' ? '活跃' : '停用'}」？`)) return
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

const goImport = () => router.push('/admin/accounts/import')
</script>

<template>
  <div class="space-y-4">
    <!-- ============ 顶部标题 + 操作 ============ -->
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold flex items-center gap-2">
          <Users class="h-5 w-5" />
          账号管理
        </h1>
        <p class="text-xs text-muted-foreground mt-1">
          主账号 = 客户分类；子账号 = 该分类下的具体客户。下单时主账号登录后选择子账号。
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" @click="load" :disabled="loading">
          <RefreshCw class="h-4 w-4 sm:mr-1" :class="{ 'animate-spin': loading, 'hidden sm:inline': true }" />
          <span class="hidden sm:inline">刷新</span>
        </Button>
        <Button size="sm" variant="outline" @click="goImport">
          <Upload class="h-4 w-4 sm:mr-1" />
          <span class="hidden sm:inline">上传档案库</span>
        </Button>
        <Button size="sm" @click="openParentCreate">
          <Plus class="h-4 w-4 sm:mr-1" />
          <span class="hidden sm:inline">新建主账号</span>
        </Button>
      </div>
    </div>

    <!-- ============ KPI 卡片 ============ -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card>
        <CardContent class="py-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-muted-foreground">主账号</p>
              <p class="text-2xl font-semibold tabular-nums">{{ summary.totalParents }}</p>
            </div>
            <Folder class="h-7 w-7 text-blue-500" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="py-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-muted-foreground">活跃主账号</p>
              <p class="text-2xl font-semibold tabular-nums">{{ summary.activeParents }}</p>
            </div>
            <CheckCircle2 class="h-7 w-7 text-emerald-500" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="py-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-muted-foreground">子账号总数</p>
              <p class="text-2xl font-semibold tabular-nums">{{ summary.totalSubs }}</p>
            </div>
            <Users class="h-7 w-7 text-violet-500" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="py-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-muted-foreground">已停用子账号</p>
              <p class="text-2xl font-semibold tabular-nums">{{ summary.inactiveSubs }}</p>
            </div>
            <EyeOff class="h-7 w-7 text-gray-400" />
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- ============ 搜索 + 过滤 ============ -->
    <Card>
      <CardContent class="py-3 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-[160px] sm:min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input v-model="search" placeholder="搜索主账号 / 子账号 / 税号" class="pl-9 h-9" />
          </div>
          <Button size="sm" variant="ghost" @click="expandAll" class="text-xs px-2 sm:px-3" title="展开全部">
            <ChevronDown class="h-3 w-3 sm:mr-1" />
            <span class="hidden sm:inline">展开</span>
          </Button>
          <Button size="sm" variant="ghost" @click="collapseAll" class="text-xs px-2 sm:px-3" title="折叠全部">
            <ChevronRight class="h-3 w-3 sm:mr-1" />
            <span class="hidden sm:inline">折叠</span>
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter class="h-3 w-3" />类型
          </div>
          <div class="flex gap-1">
            <Button v-for="t in ['all','1_public','2_cash','3_export']" :key="t"
              size="sm" :variant="typeFilter === t ? 'default' : 'outline'" @click="typeFilter = t as any"
              class="h-7 text-xs">
              {{ t === 'all' ? '全部' : accountTypes.find(x => x.value === t)?.label }}
            </Button>
          </div>
          <div class="w-px h-4 bg-border mx-1" />
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter class="h-3 w-3" />状态
          </div>
          <div class="flex gap-1">
            <Button v-for="s in ['all','active','inactive'] as const" :key="s"
              size="sm" :variant="statusFilter === s ? 'default' : 'outline'" @click="statusFilter = s"
              class="h-7 text-xs">
              {{ s === 'all' ? '全部' : s === 'active' ? '活跃' : '停用' }}
            </Button>
          </div>
        </div>
        <div v-if="error" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ error }}
        </div>
      </CardContent>
    </Card>

    <!-- ============ 行菜单（Teleport → body） ============ -->
    <Teleport to="body">
      <div
        v-if="currentMenuParent"
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
        <!-- 手机额外：分配分类 / 加子账号 -->
        <template v-if="isMobileMenu">
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
            @click="openAssign(currentMenuParent); closeMenu()">
            <Tag class="h-4 w-4 text-muted-foreground" />分配分类
          </button>
          <button
            class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
            @click="openSubCreate(currentMenuParent); closeMenu()">
            <Plus class="h-4 w-4 text-muted-foreground" />加子账号
          </button>
          <div class="my-1 border-t" />
        </template>
        <!-- 账号管理 -->
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
          @click="openParentEdit(currentMenuParent); closeMenu()">
          <Edit class="h-4 w-4 text-muted-foreground" />编辑
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
          @click="openInvite(currentMenuParent); closeMenu()">
          <Mail class="h-4 w-4 text-muted-foreground" />邀请客户登录
        </button>
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
          @click="openReset(currentMenuParent); closeMenu()">
          <KeyRound class="h-4 w-4 text-muted-foreground" />重置密码
        </button>
        <div class="my-1 border-t" />
        <button
          class="w-full text-left px-3 py-2 text-sm hover:bg-destructive/10 text-destructive flex items-center gap-2"
          @click="toggleParent(currentMenuParent); closeMenu()">
          <PowerOff v-if="currentMenuParent.status === 'active'" class="h-4 w-4" />
          <Power v-else class="h-4 w-4" />
          {{ currentMenuParent.status === 'active' ? '停用' : '启用' }}
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
      <div v-if="selected.size > 0"
        class="sticky top-0 z-10 bg-primary text-primary-foreground rounded-lg shadow-lg px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-3">
          <div class="text-sm font-medium">
            已选 <span class="text-lg tabular-nums">{{ selected.size }}</span> 个主账号
          </div>
          <Button size="sm" variant="ghost" class="text-primary-foreground hover:bg-primary-foreground/10 h-7"
            @click="clearSelection">
            <X class="h-3 w-3 mr-1" />清除
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="secondary" @click="batchAssign">
            <Tag class="h-3.5 w-3.5 mr-1" />批量分配分类
          </Button>
          <Button size="sm" variant="secondary" @click="batchToggle('active')">
            <Power class="h-3.5 w-3.5 mr-1" />启用
          </Button>
          <Button size="sm" variant="secondary" @click="batchToggle('inactive')">
            <PowerOff class="h-3.5 w-3.5 mr-1" />停用
          </Button>
        </div>
      </div>
    </Transition>

    <!-- ============ 加载 / 空 ============ -->
    <div v-if="loading && parents.length === 0" class="text-center text-sm text-muted-foreground py-10">
      <Loader2 class="h-5 w-5 mx-auto mb-2 animate-spin" />加载中...
    </div>
    <div v-else-if="filteredParents.length === 0" class="text-center py-12 border border-dashed rounded-lg">
      <Database class="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
      <p class="text-sm text-muted-foreground mb-4">
        {{ parents.length === 0 ? '还没有主账号' : '没有匹配的主账号' }}
      </p>
      <div class="flex justify-center gap-2">
        <Button v-if="parents.length === 0" size="sm" @click="goImport">
          <Upload class="h-4 w-4 mr-1" />上传客户档案库
        </Button>
        <Button v-else size="sm" variant="outline" @click="search = ''; typeFilter = 'all'; statusFilter = 'all'">
          清除筛选
        </Button>
      </div>
    </div>

    <!-- ============ 树（分页） ============ -->
    <div v-else class="space-y-2">
      <!-- 当前页全选 -->
      <div class="flex items-center justify-between text-xs text-muted-foreground px-1">
        <label class="flex items-center gap-2 cursor-pointer hover:text-foreground">
          <input
            type="checkbox"
            class="rounded"
            :checked="pagedParents.every(p => selected.has(p.id)) && pagedParents.length > 0"
            @change="toggleSelectPage"
          />
          第 {{ page }} / {{ totalPages }} 页 · {{ filteredParents.length }} 个主账号
        </label>
        <span v-if="selected.size > 0" class="text-primary">已选 {{ selected.size }} 个</span>
      </div>

      <Card v-for="p in pagedParents" :key="p.id" class="overflow-hidden">
        <!-- 父头 -->
        <div
          class="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition"
          :class="selected.has(p.id) ? 'bg-primary/5' : 'hover:bg-muted/40'"
        >
          <!-- checkbox -->
          <input
            type="checkbox"
            class="rounded shrink-0"
            :checked="selected.has(p.id)"
            @click.stop
            @change="toggleSelect(p.id, ($event as MouseEvent).shiftKey)"
          />
          <!-- 展开：▶ 唯一入口 -->
          <button
            class="shrink-0 p-1 -m-1 rounded hover:bg-muted"
            @click.stop="toggleExpand(p.id)"
          >
            <component :is="expanded[p.id] ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
          </button>
          <!-- 名称 + meta -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold truncate">{{ p.account_name }}</span>
              <span class="text-xs inline-flex items-center px-1.5 py-0.5 rounded border font-medium"
                :class="typeClass(p.account_type)">
                {{ accountTypes.find(x => x.value === p.account_type)?.label }}
              </span>
              <span v-if="p.status === 'active'"
                class="text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />活跃
              </span>
              <span v-else
                class="text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                <span class="w-1.5 h-1.5 rounded-full bg-gray-400" />停用
              </span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              {{ subsByParent[p.id]?.length ?? 0 }} 个子账号
              <span v-if="subsByParent[p.id]?.length">
                · {{ (subsByParent[p.id] ?? []).filter(s => s.status === 'active').length }} 活跃
              </span>
            </p>
          </div>
          <!-- 操作 -->
          <div class="flex items-center gap-1 shrink-0">
            <!-- ≥sm 才显示文字按钮；手机端折叠进 ··· -->
            <Button size="sm" variant="outline" @click.stop="openAssign(p)" class="h-8 hidden sm:inline-flex">
              <Tag class="h-3.5 w-3.5 sm:mr-1" />
              <span class="hidden md:inline">分配分类</span>
            </Button>
            <Button size="sm" variant="outline" @click.stop="openSubCreate(p)" class="h-8 hidden sm:inline-flex">
              <Plus class="h-3.5 w-3.5 sm:mr-1" />
              <span class="hidden md:inline">加子账号</span>
            </Button>
            <div class="relative" data-row-menu>
              <Button
                size="sm"
                variant="ghost"
                class="h-8 w-8 p-0"
                :ref="el => setTriggerRef(p.id, el)"
                @click.stop="toggleMenu(p.id)"
              >
                <MoreHorizontal class="h-4 w-4" />
              </Button>
              <!-- 菜单通过 Teleport 挂在 body 上，单例渲染 -->
            </div>
          </div>
        </div>

        <!-- 子 -->
        <div v-show="expanded[p.id]" class="border-t bg-muted/20 px-4 py-3 space-y-2">
          <p class="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Users class="h-3 w-3" />
            子账号 ({{ (subsByParent[p.id] ?? []).length }})
          </p>
          <div v-if="(subsByParent[p.id] ?? []).length === 0"
            class="text-xs text-muted-foreground italic px-2 py-3 border border-dashed rounded-md">
            暂无子账号 —— 点右上角"加子账号"创建
          </div>
          <ul v-else class="space-y-1">
            <li
              v-for="s in subsByParent[p.id]"
              :key="s.id"
              class="flex items-center justify-between gap-2 bg-background rounded-md border px-3 py-2 text-sm hover:border-primary/30 transition"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <button
                  class="shrink-0 text-amber-500 hover:scale-110 transition"
                  :title="s.is_main ? '已设为主联系' : '设为主联系'"
                  @click="!s.is_main && setMain(p.id, s)"
                  :disabled="s.is_main"
                >
                  <Star class="h-3.5 w-3.5" :class="{ 'fill-current': s.is_main, 'opacity-30': !s.is_main }" />
                </button>
                <span class="font-mono truncate">{{ s.account_name }}</span>
                <span class="text-xs inline-flex items-center px-1.5 py-0.5 rounded border shrink-0"
                  :class="typeClass(s.account_type)">
                  {{ s.account_type }}
                </span>
                <span v-if="s.inn && s.inn !== '-'" class="text-xs text-muted-foreground font-mono truncate shrink-0">
                  INN {{ s.inn }}
                </span>
                <span v-if="s.status === 'inactive'"
                  class="text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 shrink-0">
                  停用
                </span>
              </div>
              <Button size="sm" variant="ghost" class="h-7 w-7 p-0" @click="openSubEdit(p, s)">
                <Edit class="h-3 w-3" />
              </Button>
            </li>
          </ul>
        </div>
      </Card>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex items-center justify-between pt-2">
        <p class="text-xs text-muted-foreground">
          共 {{ filteredParents.length }} 条 · 第 {{ page }} / {{ totalPages }} 页
        </p>
        <div class="flex items-center gap-1">
          <Button size="sm" variant="outline" :disabled="page === 1" @click="page = 1">首页</Button>
          <Button size="sm" variant="outline" :disabled="page === 1" @click="page--">上一页</Button>
          <span class="px-3 text-sm tabular-nums">{{ page }} / {{ totalPages }}</span>
          <Button size="sm" variant="outline" :disabled="page === totalPages" @click="page++">下一页</Button>
          <Button size="sm" variant="outline" :disabled="page === totalPages" @click="page = totalPages">末页</Button>
        </div>
      </div>
    </div>

    <!-- ============ 父账号 表单 ============ -->
    <Dialog v-model:open="parentEditOpen"
      :title="parentEditTarget ? `编辑主账号：${parentEditTarget.account_name}` : '新建主账号'">
      <form class="space-y-3" @submit.prevent="submitParent">
        <div>
          <Label>主账号名 *</Label>
          <Input v-model="parentForm.account_name" placeholder="例如：贾汉 / I客户 / W客户" class="h-9" />
        </div>
        <div>
          <Label>客户登录邮箱 <span class="text-xs text-muted-foreground">（邀请时使用，留空自动生成占位邮箱）</span></Label>
          <Input v-model="parentForm.login_email" type="email" placeholder="customer@example.com" class="h-9" />
        </div>
        <div>
          <Label>类型</Label>
          <div class="grid grid-cols-3 gap-2 mt-1">
            <button v-for="t in accountTypes" :key="t.value"
              type="button"
              class="border rounded-md px-2 py-2 text-sm transition text-left"
              :class="parentForm.account_type === t.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'"
              @click="parentForm.account_type = t.value">
              <p class="font-medium">{{ t.label }}</p>
              <p class="text-xs text-muted-foreground">{{ t.desc }}</p>
            </button>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" @click="parentEditOpen = false">取消</Button>
          <Button type="submit" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            {{ parentEditTarget ? '保存' : '创建' }}
          </Button>
        </div>
      </form>
    </Dialog>

    <!-- ============ 子账号 表单 ============ -->
    <Dialog v-model:open="subEditOpen"
      :title="subEditTarget ? `编辑子账号：${subEditTarget.account_name}` : '新建子账号'">
      <form class="space-y-3" @submit.prevent="submitSub">
        <div>
          <Label>子账号名 *</Label>
          <Input v-model="subForm.account_name" placeholder="例如：1账户 贾汉 ASM" class="h-9" />
        </div>
        <div>
          <Label>类型</Label>
          <div class="grid grid-cols-3 gap-2 mt-1">
            <button v-for="t in accountTypes" :key="t.value"
              type="button"
              class="border rounded-md px-2 py-2 text-sm transition text-left"
              :class="subForm.account_type === t.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'"
              @click="subForm.account_type = t.value">
              <p class="font-medium">{{ t.label }}</p>
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>税号</Label>
            <Input v-model="subForm.inn" placeholder="可空" class="h-9" />
          </div>
          <div>
            <Label>状态</Label>
            <select v-model="subForm.status" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option value="active">可用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" v-model="subForm.is_main" class="rounded" />
          <Star class="h-3.5 w-3.5 text-amber-500" />
          设为主联系（默认显示）
        </label>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" @click="subEditOpen = false">取消</Button>
          <Button type="submit" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            {{ subEditTarget ? '保存' : '创建' }}
          </Button>
        </div>
      </form>
    </Dialog>

    <!-- ============ 分配库存组 ============ -->
    <Dialog v-model:open="assignOpen"
      :title="assignTarget ? `分配库存组：${assignTarget.account_name}` : '批量分配库存组'">
      <div v-if="allStockGroups.length === 0" class="text-sm text-muted-foreground">
        还没有库存组 —— 请先在"库存表上传"页面导入库存表
      </div>
      <div v-else class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">
            已分配: <strong>{{ assignCategoriesState.length }}</strong> / {{ allStockGroups.length }}
            <span class="ml-2">触及 SKU 总数: <strong>{{ assignCategoriesState.reduce((s, c) => s + (allStockGroups.find(g => g.code === c)?.sku_count ?? 0), 0) }}</strong></span>
          </p>
          <div class="flex gap-1">
            <Button size="sm" variant="ghost" class="h-7 text-xs" @click="selectAllAssigned">全选</Button>
            <Button size="sm" variant="ghost" class="h-7 text-xs" @click="selectNoneAssigned">清空</Button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 max-h-80 overflow-y-auto border rounded-md p-3">
          <button v-for="g in allStockGroups" :key="g.id"
            type="button"
            class="text-sm px-2.5 py-1 rounded-md border transition"
            :class="assignCategoriesState.includes(g.code)
              ? 'bg-primary text-primary-foreground border-primary'
              : 'hover:bg-muted hover:border-muted-foreground/30'"
            @click="toggleCategory(g.code)">
            <span class="inline-flex items-center gap-1">
              <Check v-if="assignCategoriesState.includes(g.code)" class="h-3 w-3" />
              {{ g.code }}
              <span class="text-xs opacity-70">·{{ g.sku_count }} SKU</span>
            </span>
          </button>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="assignOpen = false">取消</Button>
          <Button @click="assignTarget ? submitAssign() : submitBatchAssign()" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            {{ assignTarget ? '保存' : `应用到 ${selected.size} 个主账号` }}
          </Button>
        </div>
      </div>
    </Dialog>

    <!-- ============ 邀请链接 ============ -->
    <Dialog v-model:open="inviteOpen"
      :title="`${t('admin.invites.title')}：${inviteTarget?.account_name ?? ''}`"
      class="lg:!max-w-2xl">
      <div class="space-y-3">

        <!-- Tab 切换：移动端更大点击区域 -->
        <div class="flex border-b -mx-4 px-1">
          <button
            v-for="tab in inviteTabs"
            :key="tab.key"
            class="flex-1 px-2 py-2.5 text-sm border-b-2 -mb-px transition-colors text-center"
            :class="inviteTab === tab.key
              ? 'border-primary text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'"
            @click="switchInviteTab(tab.key)"
          >{{ tab.label }}</button>
        </div>

        <!-- ---------- Tab：发链接 ---------- -->
        <div v-if="inviteTab === 'send'" class="space-y-3">
          <div v-if="!inviteResult" class="space-y-2">
            <div class="text-xs text-muted-foreground space-y-1">
              <p>{{ t('admin.invites.sendHint1') }}</p>
              <p>{{ t('admin.invites.sendHint2') }}</p>
            </div>
            <div v-if="!inviteTarget?.login_email?.trim()" class="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
              ✗ {{ t('admin.invites.noEmail') }}
            </div>
            <div v-else class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
              {{ t('admin.invites.willUseEmail') }}：<span class="font-mono">{{ inviteTarget.login_email }}</span>
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <Button variant="outline" @click="inviteOpen = false">{{ t('common.cancel') }}</Button>
              <Button @click="submitInvite" :disabled="invMgr.loading.value || !inviteTarget?.login_email?.trim()">
                <Loader2 v-if="invMgr.loading.value" class="mr-2 h-4 w-4 animate-spin" />
                <Mail class="mr-2 h-4 w-4" />
                {{ t('admin.invites.generateBtn') }}
              </Button>
            </div>
          </div>

          <!-- 成功：显示链接 + 模板 -->
          <div v-else class="space-y-3">
            <div class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
              {{ t('admin.invites.generated') }}
              {{ t('admin.invites.expiresAt', { d: new Date(inviteResult.expiresAt).toLocaleDateString(locale) }) }}
            </div>

            <!-- 邀请链接 -->
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('admin.invites.colUrl') }}</Label>
              <div class="flex items-center gap-2 mt-1">
                <Input :value="inviteResult.url" readonly class="font-mono text-xs h-9" />
                <Button size="sm" variant="outline" @click="copyInviteUrl">
                  <Copy class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <!-- 登录邮箱 -->
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('admin.invites.colLoginEmail') }}</Label>
              <div class="flex items-center gap-2 mt-1">
                <Input :value="inviteResult.loginEmail" readonly class="font-mono text-xs h-9" />
                <Button size="sm" variant="outline" @click="copyLoginEmail">
                  <Copy class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <!-- 多语言发送模板 -->
            <div>
              <Label class="text-xs text-muted-foreground mb-1 block">{{ t('admin.invites.template') }}</Label>
              <div class="flex flex-wrap gap-1 mb-2">
                <button
                  v-for="lang in [{ code: 'ru', label: 'Русский' }, { code: 'uz', label: 'Oʻzbek' }, { code: 'zh', label: '中文' }]"
                  :key="lang.code"
                  class="px-2 py-0.5 text-xs rounded border transition-colors"
                  :class="inviteTplLang === lang.code
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'"
                  @click="inviteTplLang = lang.code as 'ru' | 'uz' | 'zh'"
                >{{ lang.label }}</button>
              </div>
              <div class="p-3 bg-muted rounded-md font-mono text-xs whitespace-pre-wrap">
                {{ inviteTemplate(inviteResult) }}
              </div>
            </div>

            <div class="flex justify-end gap-2 pt-2">
              <Button variant="outline" @click="inviteResult = null">
                <RefreshCw class="h-3.5 w-3.5 mr-1" />{{ t('admin.invites.generateAnother') }}
              </Button>
              <Button @click="inviteOpen = false">{{ t('common.confirm') }}</Button>
            </div>
          </div>
        </div>

        <!-- ---------- Tab：历史记录 ---------- -->
        <div v-if="inviteTab === 'history'">

          <!-- 加载中骨架：移动端友好，不依赖 table 列 -->
          <div v-if="invMgr.loading.value" class="space-y-3 py-2">
            <div v-for="i in 4" :key="i" class="border rounded-md p-3 space-y-2 animate-pulse">
              <div class="flex justify-between">
                <div class="h-3 bg-muted rounded w-24"></div>
                <div class="h-5 bg-muted rounded w-16"></div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="h-3 bg-muted rounded w-16"></div>
                <div class="h-3 bg-muted rounded w-16"></div>
                <div class="h-3 bg-muted rounded w-16"></div>
                <div class="h-3 bg-muted rounded w-16"></div>
              </div>
            </div>
          </div>

          <!-- 有数据：统计 + 列表 -->
          <template v-else>

            <!-- 统计 bar：移动端换行 -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
              <span v-for="s in inviteStats" :key="s.key" class="flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" :class="s.cls"></span>
                <span class="whitespace-nowrap">{{ s.label }}：<strong>{{ s.count }}</strong></span>
              </span>
            </div>

            <!-- 空状态 -->
            <div v-if="!invMgr.invites.value.length" class="text-center text-xs text-muted-foreground py-8">
              {{ t('admin.invites.empty') }}
            </div>

            <!-- 列表：桌面=表格，移动=卡片 -->
            <div v-else class="space-y-2 overflow-y-auto max-h-[55vh] sm:max-h-none">

              <!-- 桌面端：表格 -->
              <div class="hidden sm:block border rounded-md overflow-hidden">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="bg-muted/50 border-b">
                      <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colCreatedAt') }}</th>
                      <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colCreatedBy') }}</th>
                      <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colExpiresAt') }}</th>
                      <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colUsedAt') }}</th>
                      <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colStatus') }}</th>
                      <th class="px-2 py-1.5 text-right font-medium text-muted-foreground">{{ t('admin.invites.colActions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="inv in invMgr.invites.value"
                      :key="inv.id"
                      class="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td class="px-2 py-2">{{ new Date(inv.created_at).toLocaleDateString(locale) }}</td>
                      <td class="px-2 py-2">{{ inv.created_by_name ?? '—' }}</td>
                      <td class="px-2 py-2">{{ new Date(inv.expires_at).toLocaleDateString(locale) }}</td>
                      <td class="px-2 py-2">{{ inv.used_at ? new Date(inv.used_at).toLocaleDateString(locale) : '—' }}</td>
                      <td class="px-2 py-2">
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium"
                          :class="{
                            'bg-blue-50 text-blue-700': inv.status === 'pending',
                            'bg-green-50 text-green-700': inv.status === 'used',
                            'bg-gray-100 text-gray-500': inv.status === 'expired',
                            'bg-red-50 text-red-700': inv.status === 'revoked',
                          }"
                        >{{ inviteStatusLabel(inv.status) }}</span>
                      </td>
                      <td class="px-2 py-2 text-right">
                        <Button
                          v-if="inv.status === 'pending'"
                          size="sm" variant="ghost" class="h-6 px-1.5"
                          @click="copyInviteUrlFor(inv)"
                          :title="t('admin.invites.copyLink')"
                        >
                          <Copy class="h-3 w-3" />
                        </Button>
                        <Button
                          v-if="inv.status === 'pending'"
                          size="sm" variant="ghost" class="h-6 px-1.5 text-amber-600 hover:text-amber-700"
                          @click="handleRevoke(inv)"
                          :title="t('admin.invites.revoke')"
                        >
                          <X class="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- 移动端：卡片列表 -->
              <div class="sm:hidden space-y-2">
                <div
                  v-for="inv in invMgr.invites.value"
                  :key="inv.id"
                  class="border rounded-md p-3"
                >
                  <!-- 顶栏：创建时间 + 状态 -->
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs text-muted-foreground">
                      {{ new Date(inv.created_at).toLocaleDateString(locale) }}
                    </span>
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                      :class="{
                        'bg-blue-50 text-blue-700': inv.status === 'pending',
                        'bg-green-50 text-green-700': inv.status === 'used',
                        'bg-gray-100 text-gray-500': inv.status === 'expired',
                        'bg-red-50 text-red-700': inv.status === 'revoked',
                      }"
                    >{{ inviteStatusLabel(inv.status) }}</span>
                  </div>
                  <!-- 详情行 -->
                  <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <span class="text-muted-foreground">{{ t('admin.invites.colCreatedBy') }}</span>
                      <div class="font-medium">{{ inv.created_by_name ?? '—' }}</div>
                    </div>
                    <div>
                      <span class="text-muted-foreground">{{ t('admin.invites.colExpiresAt') }}</span>
                      <div>{{ new Date(inv.expires_at).toLocaleDateString(locale) }}</div>
                    </div>
                    <div>
                      <span class="text-muted-foreground">{{ t('admin.invites.colUsedAt') }}</span>
                      <div>{{ inv.used_at ? new Date(inv.used_at).toLocaleDateString(locale) : '—' }}</div>
                    </div>
                  </div>
                  <!-- 操作按钮 -->
                  <div v-if="inv.status === 'pending'" class="flex gap-2 mt-2 pt-2 border-t">
                    <Button size="sm" variant="outline" class="flex-1 text-xs h-7" @click="copyInviteUrlFor(inv)">
                      <Copy class="h-3 w-3 mr-1" />{{ t('admin.invites.copyLink') }}
                    </Button>
                    <Button size="sm" variant="outline" class="flex-1 text-xs h-7 text-amber-600 border-amber-200 hover:bg-amber-50" @click="handleRevoke(inv)">
                      <X class="h-3 w-3 mr-1" />{{ t('admin.invites.revoke') }}
                    </Button>
                  </div>
                </div>
              </div>

            </div>
          </template>
        </div>
      </div>
    </Dialog>

    <!-- ============ 重置密码 ============ -->
    <Dialog v-model:open="resetOpen"
      :title="`重置密码：${resetTarget?.account_name ?? ''}`">
      <div class="space-y-3">
        <div v-if="!resetTempPassword" class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="resetOpen = false">取消</Button>
          <Button @click="submitReset" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            <KeyRound class="mr-2 h-4 w-4" />
            生成临时密码
          </Button>
        </div>
        <div v-else class="space-y-2">
          <div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            临时密码已生成。请复制后告知客户。
          </div>
          <div class="flex items-center gap-2">
            <Input :value="resetTempPassword" readonly class="font-mono text-sm h-9" />
            <Button size="sm" variant="outline" @click="copyTempPassword">
              <Copy class="h-3.5 w-3.5" />
            </Button>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button @click="resetOpen = false">完成</Button>
          </div>
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
input[type="checkbox"] {
  cursor: pointer;
}
</style>