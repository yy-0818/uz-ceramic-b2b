<!--
  src/views/admin/AccountsAdminPage.vue
  账号 / 用户管理（admin 视角）

  - 列出所有 accounts + 关联的 users
  - 新建 account（直接 insert 表 OK；auth.users 需要在 Supabase Dashboard 创建）
  - 给出「在 Supabase Dashboard 创建用户 → 在 SQL 里绑定」的 SQL 片段
  - 切换账户状态 active/inactive
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Loader2, Users, Plus, RefreshCw, Search, Eye, EyeOff, ChevronDown, ChevronRight, Copy, CheckCircle2, AlertTriangle } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

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

const { t } = useI18n()

interface Account {
  id: string
  account_name: string
  company_name: string
  account_type: '1_public' | '2_cash' | '3_export'
  parent_id: string | null
  address: string
  director: string
  inn: string
  status: 'active' | 'inactive'
  created_at: string
}

interface AppUser {
  id: string
  account_id: string
  role: 'admin' | 'customer' | 'checker' | 'finance' | 'warehouse'
  full_name: string | null
  phone: string | null
  is_main: boolean
  created_at: string
  email?: string
}

const accounts = ref<Account[]>([])
const users = ref<AppUser[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const expanded = ref<Record<string, boolean>>({})
const typeFilter = ref<'all' | Account['account_type']>('all')

const createOpen = ref(false)
const editOpen = ref(false)
const editTarget = ref<Account | null>(null)

// 表单字段
const form = ref({
  account_name: '',
  company_name: '',
  account_type: '3_export' as Account['account_type'],
  address: '',
  director: '',
  inn: '',
  bank: '',
  bank_account: '',
  mfo: '',
})

// 新用户引导 SQL（由表单生成，让 admin 拷贝到 Supabase Dashboard SQL 编辑器）
const newUserGuidanceOpen = ref(false)
const guidance = ref<{
  accountId: string
  accountName: string
  email: string
  role: string
} | null>(null)

const accountTypes: Array<{ value: Account['account_type']; label: string; desc: string }> = [
  { value: '1_public', label: '1_public', desc: '对公大客户' },
  { value: '2_cash',   label: '2_cash',   desc: '现金客户' },
  { value: '3_export', label: '3_export', desc: '出口客户' },
]

const roles: AppUser['role'][] = ['customer', 'admin', 'checker', 'finance', 'warehouse']

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const [accRes, usrRes] = await Promise.all([
      supabase.from('accounts').select('*').order('created_at', { ascending: false }),
      supabase.from('users').select('*').order('created_at', { ascending: false }),
    ])
    if (accRes.error) throw accRes.error
    if (usrRes.error) throw usrRes.error
    accounts.value = (accRes.data ?? []) as Account[]
    users.value = (usrRes.data ?? []) as AppUser[]
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const usersByAccount = computed(() => {
  const map = new Map<string, AppUser[]>()
  for (const u of users.value) {
    if (!map.has(u.account_id)) map.set(u.account_id, [])
    map.get(u.account_id)!.push(u)
  }
  return map
})

const filteredAccounts = computed(() => {
  const q = search.value.trim().toLowerCase()
  return accounts.value.filter((a) => {
    if (typeFilter.value !== 'all' && a.account_type !== typeFilter.value) return false
    if (!q) return true
    return (
      a.account_name.toLowerCase().includes(q) ||
      a.company_name.toLowerCase().includes(q) ||
      a.director.toLowerCase().includes(q) ||
      a.inn.toLowerCase().includes(q)
    )
  })
})

const summary = computed(() => {
  const totalAcc = accounts.value.length
  const activeAcc = accounts.value.filter((a) => a.status === 'active').length
  const totalUsers = users.value.length
  const customers = users.value.filter((u) => u.role === 'customer').length
  return { totalAcc, activeAcc, totalUsers, customers }
})

const openCreate = () => {
  form.value = {
    account_name: '',
    company_name: '',
    account_type: '3_export',
    address: '',
    director: '',
    inn: '',
    bank: '',
    bank_account: '',
    mfo: '',
  }
  createOpen.value = true
}

const submitCreate = async () => {
  if (!form.value.account_name || !form.value.company_name) {
    error.value = '请填写账号名称和公司名'
    return
  }
  loading.value = true
  error.value = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: e } = await (supabase
      .from('accounts') as any)
      .insert({
        account_name: form.value.account_name.trim(),
        company_name: form.value.company_name.trim(),
        account_type: form.value.account_type,
        address: form.value.address.trim() || '-',
        director: form.value.director.trim() || '-',
        inn: form.value.inn.trim() || '-',
        bank: form.value.bank.trim() || '-',
        bank_account: form.value.bank_account.trim() || '-',
        mfo: form.value.mfo.trim() || '-',
      })
      .select('*')
      .single()
    if (e) throw e
    createOpen.value = false
    await load()
    if (data) {
      expanded.value[data.id] = true
    }
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

const openEdit = (acc: Account) => {
  editTarget.value = acc
  form.value = {
    account_name: acc.account_name,
    company_name: acc.company_name,
    account_type: acc.account_type,
    address: acc.address,
    director: acc.director,
    inn: acc.inn,
    bank: (acc as any).bank ?? '',
    bank_account: (acc as any).bank_account ?? '',
    mfo: (acc as any).mfo ?? '',
  }
  editOpen.value = true
}

const submitEdit = async () => {
  if (!editTarget.value) return
  loading.value = true
  error.value = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase
      .from('accounts') as any)
      .update({
        account_name: form.value.account_name.trim(),
        company_name: form.value.company_name.trim(),
        account_type: form.value.account_type,
        address: form.value.address.trim(),
        director: form.value.director.trim(),
        inn: form.value.inn.trim(),
        bank: form.value.bank.trim(),
        bank_account: form.value.bank_account.trim(),
        mfo: form.value.mfo.trim(),
      })
      .eq('id', editTarget.value.id)
    if (e) throw e
    editOpen.value = false
    editTarget.value = null
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

const toggleStatus = async (acc: Account) => {
  const next = acc.status === 'active' ? 'inactive' : 'active'
  if (!confirm(`${next === 'inactive' ? '停用' : '启用'} ${acc.account_name} ？`)) return
  loading.value = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase
      .from('accounts') as any)
      .update({ status: next })
      .eq('id', acc.id)
    if (e) throw e
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// 给某个账号新增用户的指引（不能在浏览器侧调用 admin.createUser）
const openAddUserGuidance = (acc: Account, role: AppUser['role'] = 'customer') => {
  guidance.value = {
    accountId: acc.id,
    accountName: acc.account_name,
    email: '',
    role,
  }
  newUserGuidanceOpen.value = true
}

const buildGuidanceSql = computed(() => {
  if (!guidance.value) return ''
  return [
    `-- 1. 在 Supabase Dashboard → Authentication → Users → Add user`,
    `--    email: ${guidance.value.email || '(请填写)'}`,
    `--    password: (客户自行设置 / 你临时给一个)`,
    `--    Auto Confirm User: 勾上`,
    `--    创建后点开新用户，复制其 UUID（形如 a1b2c3d4-...）粘贴到下面 ↓`,
    '',
    '-- 2. 把 user 绑到 account + 设 role',
    `insert into public.users (id, account_id, role, is_main, full_name)`,
    `values (`,
    `  'PASTE_USER_UUID_HERE',         -- ← 从 auth.users 拷贝`,
    `  '${guidance.value.accountId}',   -- ${guidance.value.accountName}`,
    `  '${guidance.value.role}',`,
    `  true,                            -- 主联系人`,
    `  '${guidance.value.accountName} 主联系人'`,
    `);`,
    '',
    '-- 3. （可选）批量给该账号加白名单：导入一次 CSV 时系统会自动按客户组映射写入',
    '--    手动也行：',
    `-- insert into public.account_products (account_id, product_id, is_visible, stock_level_1, stock_level_2)`,
    `-- select '${guidance.value.accountId}', p.id, true, 0, 0 from public.products p where p.category = '12J';`,
  ].join('\n')
})

const copied = ref(false)
const copySql = async () => {
  try {
    await navigator.clipboard.writeText(buildGuidanceSql.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // ignore
  }
}

const toggleExpand = (id: string) => {
  expanded.value[id] = !expanded.value[id]
}

const fmt = (s: string) => new Date(s).toLocaleString()
</script>

<template>
  <div class="space-y-4">
    <!-- 顶部统计 + 操作 -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Users class="h-5 w-5" />
              账号 / 用户管理
            </CardTitle>
            <CardDescription>维护多主体账号（客户 / 内部角色）及关联登录用户</CardDescription>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" @click="load" :disabled="loading">
              <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
              <RefreshCw v-else class="mr-2 h-4 w-4" />
              刷新
            </Button>
            <Button size="sm" @click="openCreate">
              <Plus class="mr-2 h-4 w-4" />
              新建账号
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">账号总数: {{ summary.totalAcc }}</Badge>
          <Badge variant="secondary">活跃: {{ summary.activeAcc }}</Badge>
          <Badge variant="secondary">登录用户: {{ summary.totalUsers }}</Badge>
          <Badge variant="secondary">客户: {{ summary.customers }}</Badge>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input v-model="search" placeholder="搜索账号名 / 公司 / 法人 / INN" class="pl-9 h-9" />
          </div>
          <div class="flex gap-1">
            <Button
              v-for="t in ['all', ...accountTypes.map((a) => a.value)]"
              :key="t"
              size="sm"
              :variant="typeFilter === t ? 'default' : 'outline'"
              @click="typeFilter = t as any"
            >
              {{ t === 'all' ? '全部' : t }}
            </Button>
          </div>
        </div>

        <div v-if="error" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ error }}
        </div>
      </CardContent>
    </Card>

    <!-- 账号列表 -->
    <div v-if="loading && accounts.length === 0" class="text-center text-sm text-muted-foreground py-10">
      <Loader2 class="h-5 w-5 mx-auto mb-2 animate-spin" />
      加载中...
    </div>

    <div v-else-if="filteredAccounts.length === 0" class="text-center text-sm text-muted-foreground py-10 border rounded-md">
      没有匹配的账号
    </div>

    <div v-else class="space-y-2">
      <Card v-for="acc in filteredAccounts" :key="acc.id" class="overflow-hidden">
        <!-- 账号头 -->
        <div
          class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition"
          @click="toggleExpand(acc.id)"
        >
          <div class="flex items-center gap-3 min-w-0">
            <component :is="expanded[acc.id] ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground shrink-0" />
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium truncate">{{ acc.account_name }}</span>
                <Badge variant="outline" class="shrink-0">{{ acc.account_type }}</Badge>
                <Badge v-if="acc.status === 'active'" class="bg-emerald-100 text-emerald-800 shrink-0">活跃</Badge>
                <Badge v-else class="bg-gray-200 text-gray-700 shrink-0">停用</Badge>
              </div>
              <p class="text-xs text-muted-foreground truncate">
                {{ acc.company_name }} · {{ acc.director }} · INN: {{ acc.inn }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0" @click.stop>
            <Button size="sm" variant="outline" @click="openAddUserGuidance(acc)">
              <Plus class="mr-1 h-3 w-3" />
              添加用户
            </Button>
            <Button size="sm" variant="ghost" @click="openEdit(acc)">编辑</Button>
            <Button size="sm" variant="ghost" @click="toggleStatus(acc)">
              {{ acc.status === 'active' ? '停用' : '启用' }}
            </Button>
          </div>
        </div>

        <!-- 展开：用户列表 -->
        <div v-show="expanded[acc.id]" class="border-t bg-muted/20 px-4 py-3">
          <p class="text-xs font-medium text-muted-foreground mb-2">
            登录用户 ({{ usersByAccount.get(acc.id)?.length ?? 0 }})
          </p>
          <div v-if="(usersByAccount.get(acc.id) ?? []).length === 0" class="text-xs text-muted-foreground italic">
            该账号暂无登录用户
          </div>
          <ul v-else class="space-y-1">
            <li
              v-for="u in usersByAccount.get(acc.id)"
              :key="u.id"
              class="flex items-center justify-between gap-2 bg-background rounded-md border px-3 py-2 text-sm"
            >
              <div class="flex items-center gap-2 min-w-0">
                <Badge variant="outline" class="shrink-0">{{ u.role }}</Badge>
                <span class="truncate">{{ u.full_name || '(无姓名)' }}</span>
                <span v-if="u.is_main" class="text-[10px] text-emerald-600">主联系人</span>
              </div>
              <span class="text-xs text-muted-foreground">{{ fmt(u.created_at) }}</span>
            </li>
          </ul>
          <div class="mt-2 text-xs text-muted-foreground">
            创建时间: {{ fmt(acc.created_at) }}
          </div>
        </div>
      </Card>
    </div>

    <!-- 新建账号表单 -->
    <Dialog v-model:open="createOpen" title="新建账号" description="填完后系统会向 public.accounts 插入一条记录">
      <form class="space-y-3" @submit.prevent="submitCreate">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>账号名 *</Label>
            <Input v-model="form.account_name" placeholder="客户A" class="h-9" />
          </div>
          <div>
            <Label>类型</Label>
            <select v-model="form.account_type" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option v-for="t in accountTypes" :key="t.value" :value="t.value">
                {{ t.label }} — {{ t.desc }}
              </option>
            </select>
          </div>
        </div>
        <div>
          <Label>公司名 *</Label>
          <Input v-model="form.company_name" placeholder="OOO Ромашка" class="h-9" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>法人</Label>
            <Input v-model="form.director" class="h-9" />
          </div>
          <div>
            <Label>INN</Label>
            <Input v-model="form.inn" class="h-9" />
          </div>
        </div>
        <div>
          <Label>地址</Label>
          <Input v-model="form.address" class="h-9" />
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <Label>银行</Label>
            <Input v-model="form.bank" class="h-9" />
          </div>
          <div>
            <Label>账号</Label>
            <Input v-model="form.bank_account" class="h-9" />
          </div>
          <div>
            <Label>MFO</Label>
            <Input v-model="form.mfo" class="h-9" />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" @click="createOpen = false">取消</Button>
          <Button type="submit" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            创建
          </Button>
        </div>
      </form>
    </Dialog>

    <!-- 编辑账号表单 -->
    <Dialog v-model:open="editOpen" :title="`编辑：${editTarget?.account_name}`">
      <form class="space-y-3" @submit.prevent="submitEdit">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>账号名 *</Label>
            <Input v-model="form.account_name" class="h-9" />
          </div>
          <div>
            <Label>类型</Label>
            <select v-model="form.account_type" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option v-for="t in accountTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
        </div>
        <div>
          <Label>公司名 *</Label>
          <Input v-model="form.company_name" class="h-9" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>法人</Label>
            <Input v-model="form.director" class="h-9" />
          </div>
          <div>
            <Label>INN</Label>
            <Input v-model="form.inn" class="h-9" />
          </div>
        </div>
        <div>
          <Label>地址</Label>
          <Input v-model="form.address" class="h-9" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" @click="editOpen = false">取消</Button>
          <Button type="submit" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            保存
          </Button>
        </div>
      </form>
    </Dialog>

    <!-- 添加用户指引 -->
    <Dialog
      v-model:open="newUserGuidanceOpen"
      title="添加登录用户"
      description="浏览器侧没有 admin API（service_role key 不能放前端），需要 1 步 Dashboard 操作 + 1 步 SQL"
    >
      <div v-if="guidance" class="space-y-3">
        <div class="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p class="font-medium">操作流程</p>
            <ol class="list-decimal list-inside text-xs mt-1 space-y-0.5">
              <li>Supabase Dashboard → Authentication → Add user（记下 UUID）</li>
              <li>复制下方 SQL，<strong>把 PASTE_USER_UUID_HERE 替换成实际 UUID</strong>，到 SQL 编辑器执行</li>
            </ol>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>账号</Label>
            <Input :model-value="guidance.accountName" disabled class="h-9 bg-muted" />
          </div>
          <div>
            <Label>角色</Label>
            <select v-model="guidance.role" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
        </div>
        <div>
          <Label>客户邮箱（参考用）</Label>
          <Input v-model="guidance.email" placeholder="customer@example.com" class="h-9" />
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <Label>SQL 片段</Label>
            <Button size="sm" variant="outline" @click="copySql">
              <CheckCircle2 v-if="copied" class="mr-1 h-3 w-3 text-emerald-600" />
              <Copy v-else class="mr-1 h-3 w-3" />
              {{ copied ? '已复制' : '复制' }}
            </Button>
          </div>
          <pre class="text-xs bg-muted/60 border rounded-md p-3 overflow-x-auto whitespace-pre font-mono">{{ buildGuidanceSql }}</pre>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="newUserGuidanceOpen = false">关闭</Button>
        </div>
      </div>
    </Dialog>
  </div>
</template>