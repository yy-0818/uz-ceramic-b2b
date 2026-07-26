<!--
  src/views/admin/CustomerGroupMappingPage.vue
  客户组 → 主账号 映射管理

  - 列出系统中所有客户组（从最新一次导入的 CSV 缓存或历史映射）
  - 每个客户组可被分配到一个或多个主账号 (1_public/2_cash/3_export)
  - 支持：新增映射 / 删除映射 / 批量从 CSV 缓存导入
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Loader2, Link2, Unlink, Plus, Check } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Badge from '@/components/ui/Badge.vue'

import { useCustomerGroupMappings } from '@/composables/useCustomerGroupMappings'
import { supabase } from '@/lib/supabase'

const { t } = useI18n()
const mappings = useCustomerGroupMappings()

// 所有主账号
const accounts = ref<Array<{ id: string; account_name: string; account_type: string }>>([])
const loadingAccounts = ref(false)

const fetchAccounts = async () => {
  loadingAccounts.value = true
  const { data } = await supabase
    .from('accounts')
    .select('id, account_name, account_type')
    .order('account_type')
  accounts.value = (data ?? []) as any
  loadingAccounts.value = false
}

// 所有出现过的客户组（来自 stock_colors 关联的 customer_group_mappings
// 没有时为空 → 用 inventory_csv 缓存作 fallback）
const allCustomerGroups = computed(() => {
  const set = new Set<string>()
  mappings.items.value.forEach((m) => set.add(m.customer_group))
  // 简易：从 products 的 remark 中提取"同花色N"不可，这里只能从映射列表展示
  return Array.from(set).sort()
})

// 按客户组分组的映射（一个客户组可对应多个账户）
const grouped = computed(() => {
  const m = new Map<string, typeof mappings.items.value>()
  for (const it of mappings.items.value) {
    if (!m.has(it.customer_group)) m.set(it.customer_group, [])
    m.get(it.customer_group)!.push(it)
  }
  return m
})

// 新增映射的临时表单
const newGroup = ref('')
const newAccountId = ref('')
const saving = ref(false)
const errMsg = ref<string | null>(null)

const addMapping = async () => {
  if (!newGroup.value.trim() || !newAccountId.value) return
  saving.value = true
  errMsg.value = null
  try {
    await mappings.bulkUpsert([{
      customer_group: newGroup.value.trim(),
      account_id: newAccountId.value,
      is_active: true,
    }])
    newGroup.value = ''
    newAccountId.value = ''
    await mappings.fetchAll()
  } catch (e: any) {
    errMsg.value = e.message
  } finally {
    saving.value = false
  }
}

const removeMapping = async (id: string) => {
  try {
    await mappings.remove(id)
    await mappings.fetchAll()
  } catch (e: any) {
    errMsg.value = e.message
  }
}

onMounted(async () => {
  await Promise.all([mappings.fetchAll(), fetchAccounts()])
})
</script>

<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Link2 class="h-5 w-5" />
          {{ t('admin.groups.title') }}
        </CardTitle>
        <CardDescription>{{ t('admin.groups.desc') }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 新增映射表单 -->
        <div class="flex flex-wrap items-end gap-2 border rounded-md p-3 bg-muted/30">
          <div class="flex-1 min-w-[160px]">
            <label class="text-xs text-muted-foreground">{{ t('admin.groups.groupName') }}</label>
            <input
              v-model="newGroup"
              class="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm"
              :placeholder="t('admin.groups.groupNamePh')"
            />
          </div>
          <div class="flex-1 min-w-[200px]">
            <label class="text-xs text-muted-foreground">{{ t('admin.groups.account') }}</label>
            <select
              v-model="newAccountId"
              class="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm"
            >
              <option value="">{{ t('admin.groups.accountPh') }}</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">
                [{{ a.account_type }}] {{ a.account_name }}
              </option>
            </select>
          </div>
          <Button :disabled="!newGroup.trim() || !newAccountId || saving" @click="addMapping">
            <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
            <Plus v-else class="mr-2 h-4 w-4" />
            {{ t('admin.groups.addBtn') }}
          </Button>
        </div>

        <div v-if="errMsg" class="text-sm text-red-600">{{ errMsg }}</div>

        <!-- 现有映射列表 -->
        <div v-if="grouped.size === 0" class="py-6 text-center text-sm text-muted-foreground">
          {{ t('admin.groups.empty') }}
        </div>

        <table v-else class="w-full text-sm">
          <thead>
            <tr class="border-b text-xs text-muted-foreground">
              <th class="text-left py-2">{{ t('admin.groups.groupName') }}</th>
              <th class="text-left py-2">{{ t('admin.groups.accounts') }}</th>
              <th class="text-left py-2">{{ t('admin.groups.status') }}</th>
              <th class="text-right py-2">{{ t('admin.groups.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[group, list] in grouped" :key="group" class="border-b">
              <td class="py-2 font-medium font-mono">{{ group }}</td>
              <td class="py-2">
                <div class="flex flex-wrap gap-1">
                  <Badge
                    v-for="m in list"
                    :key="m.id"
                    variant="secondary"
                    class="font-mono"
                  >
                    [{{ m.account?.account_type }}] {{ m.account?.account_name }}
                  </Badge>
                </div>
              </td>
              <td class="py-2">
                <Badge v-if="list.some((m) => m.is_active)" class="bg-emerald-100 text-emerald-800">
                  <Check class="h-3 w-3 mr-1" />
                  {{ t('admin.groups.active') }}
                </Badge>
              </td>
              <td class="py-2 text-right">
                <Button
                  v-for="m in list"
                  :key="m.id"
                  size="sm"
                  variant="ghost"
                  @click="removeMapping(m.id)"
                >
                  <Unlink class="h-3 w-3" />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
</template>