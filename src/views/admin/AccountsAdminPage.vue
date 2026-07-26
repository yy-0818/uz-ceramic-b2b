<!--
  src/views/admin/AccountsAdminPage.vue
  主账号（父）+ 子账户 管理：admin 视角
  - 树形：父 → 子
  - 父 CRUD + 状态切换
  - 子 CRUD + 标记主联系 + 状态切换
  - 父 → 库存分类（12J/12P/12F/12K...）分配
  - "上传档案库" 跳到导入页
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Loader2, Plus, RefreshCw, Search, ChevronRight, ChevronDown,
  Upload, Users, Tag, Star, Edit, Power, PowerOff, X,
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

const router = useRouter()
const acc = useAccounts()

const parents = ref<Account[]>([])
const subsByParent = ref<Record<string, Account[]>>({})
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const expanded = ref<Record<string, boolean>>({})
const typeFilter = ref<'all' | AccountType>('all')

// dialogs
const parentEditOpen = ref(false)
const parentEditTarget = ref<Account | null>(null)
const subEditOpen = ref(false)
const subEditTarget = ref<Account | null>(null)
const assignOpen = ref(false)
const assignTarget = ref<Account | null>(null)
const assignCategoriesState = ref<string[]>([])
const allProductCategories = ref<string[]>([])

const accountTypes: Array<{ value: AccountType; label: string; desc: string }> = [
  { value: '1_public', label: '1_public', desc: '对公大客户' },
  { value: '2_cash', label: '2_cash', desc: '现金客户' },
  { value: '3_export', label: '3_export', desc: '出口客户' },
]

// ---- 表单 ----
const parentForm = ref({
  account_name: '',
  account_type: '1_public' as AccountType,
})
const subForm = ref({
  parent_id: '',
  account_name: '',
  account_type: '1_public' as AccountType,
  inn: '',
  is_main: false,
  status: 'active' as 'active' | 'inactive',
})

// ---- 数据加载 ----
const load = async () => {
  loading.value = true
  error.value = null
  try {
    const { parents: ps, subs } = await acc.fetchTree()
    parents.value = ps
    // 按 parent 聚合
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

onMounted(load)

const filteredParents = computed(() => {
  const q = search.value.trim().toLowerCase()
  return parents.value.filter((p) => {
    if (typeFilter.value !== 'all' && p.account_type !== typeFilter.value) return false
    if (!q) return true
    if (p.account_name.toLowerCase().includes(q)) return true
    const subs = subsByParent.value[p.id] ?? []
    return subs.some((s) =>
      s.account_name.toLowerCase().includes(q) ||
      s.inn.toLowerCase().includes(q),
    )
  })
})

const summary = computed(() => {
  const totalSubs = Object.values(subsByParent.value).reduce((s, arr) => s + arr.length, 0)
  const activeParents = parents.value.filter((p) => p.status === 'active').length
  return { totalParents: parents.value.length, totalSubs, activeParents }
})

const toggleExpand = async (id: string) => {
  expanded.value[id] = !expanded.value[id]
}

// ---- 父 CRUD ----
const openParentCreate = () => {
  parentEditTarget.value = null
  parentForm.value = { account_name: '', account_type: '1_public' }
  parentEditOpen.value = true
}
const openParentEdit = (p: Account) => {
  parentEditTarget.value = p
  parentForm.value = { account_name: p.account_name, account_type: p.account_type }
  parentEditOpen.value = true
}
const submitParent = async () => {
  if (!parentForm.value.account_name) {
    error.value = '请填写父账号名'
    return
  }
  loading.value = true
  try {
    if (parentEditTarget.value) {
      await acc.updateParent(parentEditTarget.value.id, {
        account_name: parentForm.value.account_name,
        account_type: parentForm.value.account_type,
      })
    } else {
      await acc.createParent({
        account_name: parentForm.value.account_name,
        account_type: parentForm.value.account_type,
      })
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
  if (!confirm(`${p.status === 'active' ? '停用' : '启用'} 父账号 "${p.account_name}"？\n所有子账号会被同步停用。`)) return
  loading.value = true
  try {
    await acc.updateParent(p.id, {
      status: p.status === 'active' ? 'inactive' : 'active',
    })
    await load()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// ---- 子 CRUD ----
const openSubCreate = (parent: Account) => {
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

// ---- 分配库存分类 ----
const openAssign = async (parent: Account) => {
  assignTarget.value = parent
  loading.value = true
  try {
    if (allProductCategories.value.length === 0) {
      allProductCategories.value = await acc.fetchProductCategories()
    }
    assignCategoriesState.value = await acc.fetchAssignedCategories(parent.id)
    assignOpen.value = true
  } finally {
    loading.value = false
  }
}
const submitAssign = async () => {
  if (!assignTarget.value) return
  loading.value = true
  try {
    await acc.assignCategories(assignTarget.value.id, assignCategoriesState.value)
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

const goImport = () => router.push('/admin/accounts/import')
</script>

<template>
  <div class="space-y-4">
    <!-- 顶部 -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Users class="h-5 w-5" />
              账号 / 用户管理
            </CardTitle>
            <CardDescription>主账号（父）= 客户分类；子账号 = 该分类下的具体客户。下单时主账号登录后选择子账号。</CardDescription>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" @click="load" :disabled="loading">
              <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
              <RefreshCw v-else class="mr-2 h-4 w-4" />刷新
            </Button>
            <Button size="sm" variant="outline" @click="goImport">
              <Upload class="mr-2 h-4 w-4" />上传档案库
            </Button>
            <Button size="sm" @click="openParentCreate">
              <Plus class="mr-2 h-4 w-4" />新建主账号
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">主账号: {{ summary.totalParents }}</Badge>
          <Badge variant="secondary">活跃主账号: {{ summary.activeParents }}</Badge>
          <Badge variant="secondary">子账号总数: {{ summary.totalSubs }}</Badge>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input v-model="search" placeholder="搜索主账号名 / 子账号名 / 税号" class="pl-9 h-9" />
          </div>
          <div class="flex gap-1">
            <Button v-for="t in ['all','1_public','2_cash','3_export']" :key="t"
              size="sm" :variant="typeFilter === t ? 'default' : 'outline'" @click="typeFilter = t as any">
              {{ t === 'all' ? '全部' : t }}
            </Button>
          </div>
        </div>
        <div v-if="error" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ error }}
        </div>
      </CardContent>
    </Card>

    <!-- 加载 / 空 -->
    <div v-if="loading && parents.length === 0" class="text-center text-sm text-muted-foreground py-10">
      <Loader2 class="h-5 w-5 mx-auto mb-2 animate-spin" />加载中...
    </div>
    <div v-else-if="filteredParents.length === 0" class="text-center text-sm text-muted-foreground py-10 border rounded-md">
      没有匹配的主账号
    </div>

    <!-- 树 -->
    <div v-else class="space-y-2">
      <Card v-for="p in filteredParents" :key="p.id" class="overflow-hidden">
        <!-- 父头 -->
        <div
          class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition"
          @click="toggleExpand(p.id)"
        >
          <div class="flex items-center gap-3 min-w-0">
            <component :is="expanded[p.id] ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground shrink-0" />
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium truncate">{{ p.account_name }}</span>
                <Badge variant="outline" class="shrink-0">{{ p.account_type }}</Badge>
                <Badge v-if="p.status === 'active'" class="bg-emerald-100 text-emerald-800 shrink-0">活跃</Badge>
                <Badge v-else class="bg-gray-200 text-gray-700 shrink-0">停用</Badge>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ subsByParent[p.id]?.length ?? 0 }} 个子账号
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0" @click.stop>
            <Button size="sm" variant="outline" @click="openAssign(p)">
              <Tag class="mr-1 h-3 w-3" />分配分类
            </Button>
            <Button size="sm" variant="outline" @click="openSubCreate(p)">
              <Plus class="mr-1 h-3 w-3" />加子账号
            </Button>
            <Button size="sm" variant="ghost" @click="openParentEdit(p)"><Edit class="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" @click="toggleParent(p)">
              <PowerOff v-if="p.status === 'active'" class="h-3.5 w-3.5" />
              <Power v-else class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <!-- 子 -->
        <div v-show="expanded[p.id]" class="border-t bg-muted/20 px-4 py-3 space-y-2">
          <p class="text-xs font-medium text-muted-foreground">子账号</p>
          <div v-if="(subsByParent[p.id] ?? []).length === 0" class="text-xs text-muted-foreground italic">
            暂无子账号
          </div>
          <ul v-else class="space-y-1">
            <li
              v-for="s in subsByParent[p.id]"
              :key="s.id"
              class="flex items-center justify-between gap-2 bg-background rounded-md border px-3 py-2 text-sm"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <Star v-if="s.is_main" class="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span v-else class="w-3.5 shrink-0" />
                <span class="font-mono truncate">{{ s.account_name }}</span>
                <Badge variant="outline" class="shrink-0 text-[10px]">{{ s.account_type }}</Badge>
                <span v-if="s.inn && s.inn !== '-'" class="text-xs text-muted-foreground font-mono truncate">INN: {{ s.inn }}</span>
                <Badge v-if="s.status === 'inactive'" class="bg-gray-200 text-gray-700 shrink-0 text-[10px]">停用</Badge>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <Button v-if="!s.is_main" size="sm" variant="ghost" @click="setMain(p.id, s)">
                  <Star class="mr-1 h-3 w-3" />设为主联系
                </Button>
                <Button size="sm" variant="ghost" @click="openSubEdit(p, s)">
                  <Edit class="h-3 w-3" />
                </Button>
              </div>
            </li>
          </ul>
        </div>
      </Card>
    </div>

    <!-- 父账号 表单 -->
    <Dialog v-model:open="parentEditOpen"
      :title="parentEditTarget ? `编辑主账号：${parentEditTarget.account_name}` : '新建主账号'"
      description="主账号对应客户分类，所有子账号共享此主账号的白名单">
      <form class="space-y-3" @submit.prevent="submitParent">
        <div>
          <Label>主账号名 *</Label>
          <Input v-model="parentForm.account_name" placeholder="例如：贾汉 / I客户 / W客户" class="h-9" />
        </div>
        <div>
          <Label>类型</Label>
          <select v-model="parentForm.account_type" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
            <option v-for="t in accountTypes" :key="t.value" :value="t.value">
              {{ t.label }} — {{ t.desc }}
            </option>
          </select>
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

    <!-- 子账号 表单 -->
    <Dialog v-model:open="subEditOpen"
      :title="subEditTarget ? `编辑子账号：${subEditTarget.account_name}` : '新建子账号'">
      <form class="space-y-3" @submit.prevent="submitSub">
        <div>
          <Label>子账号名 *</Label>
          <Input v-model="subForm.account_name" placeholder="例如：1账户 贾汉 ASM" class="h-9" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>类型</Label>
            <select v-model="subForm.account_type" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option v-for="t in accountTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div>
            <Label>税号</Label>
            <Input v-model="subForm.inn" placeholder="可空" class="h-9" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="subForm.is_main" />
            设为主联系（默认显示）
          </label>
          <div>
            <Label>状态</Label>
            <select v-model="subForm.status" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
              <option value="active">可用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" @click="subEditOpen = false">取消</Button>
          <Button type="submit" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            {{ subEditTarget ? '保存' : '创建' }}
          </Button>
        </div>
      </form>
    </Dialog>

    <!-- 分配库存分类 -->
    <Dialog v-model:open="assignOpen"
      :title="`分配库存分类：${assignTarget?.account_name}`"
      description="勾选该主账号能看到的商品分类（12J / 12P / 12F / 12K 等）">
      <div v-if="allProductCategories.length === 0" class="text-sm text-muted-foreground">
        库里还没有任何商品，无法分配
      </div>
      <div v-else class="space-y-2">
        <p class="text-xs text-muted-foreground">
          已分配: <strong>{{ assignCategoriesState.length }}</strong> / {{ allProductCategories.length }}
        </p>
        <div class="flex flex-wrap gap-2 max-h-80 overflow-y-auto border rounded-md p-3">
          <Button
            v-for="cat in allProductCategories"
            :key="cat"
            size="sm"
            :variant="assignCategoriesState.includes(cat) ? 'default' : 'outline'"
            @click="toggleCategory(cat)"
          >
            {{ cat }}
          </Button>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="assignOpen = false">取消</Button>
          <Button @click="submitAssign" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />保存分配
          </Button>
        </div>
      </div>
    </Dialog>
  </div>
</template>