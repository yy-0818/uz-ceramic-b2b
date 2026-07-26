<!--
  src/views/admin/AssignStockPage.vue
  后台：库存白名单分配
  流程：
    1. 选商品（多选）
    2. 选账户（多选）
    3. 自动汇总每个 (account, product) 的最大库存（来自 CSV 客户组∈账户映射）
    4. 一键 upsert 到 account_products
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { CheckCircle2, AlertTriangle, Filter } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import Badge from '@/components/ui/Badge.vue'
import Table from '@/components/ui/Table.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableRow from '@/components/ui/TableRow.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableEmpty from '@/components/ui/TableEmpty.vue'

import { useInventoryCsv } from '@/composables/useInventoryCsv'
import { useProducts } from '@/composables/useProducts'
import { useAccounts } from '@/composables/useAccounts'
import { useAccountProducts } from '@/composables/useAccountProducts'

const { t } = useI18n()
const csv = useInventoryCsv()
const products = useProducts()
const accounts = useAccounts()
const ap = useAccountProducts()

// 客户组 → 账户映射（手填，最简单方案；后续可改成 csv_group_to_account 表）
const groupToAccount = ref<Record<string, string>>({})
const selectedAccountIds = ref<Set<string>>(new Set())
const selectedProductIds = ref<Set<string>>(new Set())
const defaultVisible = ref(true)
const submitting = ref(false)
const result = ref<{ count: number } | null>(null)

const filteredProducts = computed(() => {
  const q = searchProduct.value.trim().toLowerCase()
  if (!q) return products.items.value
  return products.items.value.filter((p) =>
    p.model.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
  )
})

const searchProduct = ref('')
const searchAccount = ref('')

const filteredAccounts = computed(() => {
  const q = searchAccount.value.trim().toLowerCase()
  const parents = accounts.items.value.filter((a) => a.parent_id === null)
  if (!q) return parents
  return parents.filter((a) =>
    a.account_name.toLowerCase().includes(q) ||
    a.company_name.toLowerCase().includes(q),
  )
})

const onInit = async () => {
  await products.fetchAll()
  await accounts.fetchTree()  // 填好 items.value（包含父 + 子）
}

const toggleAccount = (id: string) => {
  const s = new Set(selectedAccountIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedAccountIds.value = s
}

const toggleProduct = (id: string) => {
  const s = new Set(selectedProductIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedProductIds.value = s
}

const toggleAllAccounts = (checked: boolean) => {
  selectedAccountIds.value = checked
    ? new Set(filteredAccounts.value.map((a) => a.id))
    : new Set()
}

const toggleAllProducts = (checked: boolean) => {
  selectedProductIds.value = checked
    ? new Set(filteredProducts.value.map((p) => p.id))
    : new Set()
}

/**
 * 关键计算：根据 (productId, accountId) 推断库存
 * 逻辑：找出 csv.candidates 中该 product 对应的所有客户组，
 *      再看在 groupToAccount 中这些组映射到哪些账户，取该账户下所有组库存之和
 *      如果该账户没有任何客户组映射，则库存为 0
 */
const buildAssignments = () => {
  const out: Array<{
    account_id: string
    product_id: string
    is_visible: boolean
    stock_level_1: number
    stock_level_2: number
  }> = []

  for (const accountId of selectedAccountIds.value) {
    for (const productId of selectedProductIds.value) {
      const product = products.items.value.find((p) => p.id === productId)
      if (!product) continue

      const candidate = csv.products.value.find((c) => c.model === product.model)
      if (!candidate) {
        out.push({
          account_id: accountId, product_id: productId,
          is_visible: defaultVisible.value, stock_level_1: 0, stock_level_2: 0,
        })
        continue
      }

      let l1 = 0, l2 = 0
      for (const g of candidate.customerGroups) {
        if (groupToAccount.value[g] === accountId) {
          l1 += candidate.totalLevel1
          l2 += candidate.totalLevel2
          break
        }
      }
      out.push({
        account_id: accountId, product_id: productId,
        is_visible: defaultVisible.value, stock_level_1: l1, stock_level_2: l2,
      })
    }
  }
  return out
}

const previewRows = computed(() => buildAssignments())

const onSubmit = async () => {
  if (previewRows.value.length === 0) return
  submitting.value = true
  try {
    const count = await ap.bulkAssign(previewRows.value)
    result.value = { count }
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : '提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6" @vue:mounted="onInit">
    <!-- 1. 客户组 → 账户 映射 -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Filter class="h-5 w-5" />
          {{ t('admin.assign.step1') }}
        </CardTitle>
        <CardDescription>{{ t('admin.assign.step1Desc') }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="csv.customerGroups.value.length === 0" class="text-sm text-muted-foreground">
          {{ t('admin.assign.noCsv') }}
        </div>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            v-for="g in csv.customerGroups.value"
            :key="g"
            class="flex items-center gap-3 border rounded-md p-2"
          >
            <Label class="w-40 truncate">{{ g }}</Label>
            <select
              v-model="groupToAccount[g]"
              class="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{{ t('admin.assign.unmapped') }}</option>
              <option v-for="a in accounts.items.value" :key="a.id" :value="a.id">
                {{ a.account_name }} · {{ a.account_type }}
              </option>
            </select>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 2. 选账户 -->
    <Card>
      <CardHeader>
        <CardTitle>{{ t('admin.assign.step2') }}</CardTitle>
        <Input v-model="searchAccount" :placeholder="t('admin.assign.searchAccount')" class="max-w-md" />
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-2 mb-3">
          <Checkbox
            :model-value="filteredAccounts.length > 0 && selectedAccountIds.size === filteredAccounts.length"
            @update:modelValue="toggleAllAccounts"
          />
          <Label>{{ t('admin.assign.selectAll') }} ({{ selectedAccountIds.size }}/{{ filteredAccounts.length }})</Label>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-auto">
          <label
            v-for="a in filteredAccounts"
            :key="a.id"
            class="flex items-center gap-2 border rounded-md p-2 cursor-pointer hover:bg-muted/50"
          >
            <Checkbox
              :model-value="selectedAccountIds.has(a.id)"
              @update:modelValue="toggleAccount(a.id)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ a.account_name }}</p>
              <p class="text-xs text-muted-foreground truncate">
                <Badge variant="secondary">{{ a.account_type }}</Badge>
                {{ a.company_name }}
              </p>
            </div>
          </label>
        </div>
      </CardContent>
    </Card>

    <!-- 3. 选商品 -->
    <Card>
      <CardHeader>
        <CardTitle>{{ t('admin.assign.step3') }}</CardTitle>
        <Input v-model="searchProduct" :placeholder="t('admin.assign.searchProduct')" class="max-w-md" />
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-2 mb-3">
          <Checkbox
            :model-value="filteredProducts.length > 0 && selectedProductIds.size === filteredProducts.length"
            @update:modelValue="toggleAllProducts"
          />
          <Label>{{ t('admin.assign.selectAll') }} ({{ selectedProductIds.size }}/{{ filteredProducts.length }})</Label>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-auto">
          <label
            v-for="p in filteredProducts"
            :key="p.id"
            class="flex items-center gap-2 border rounded-md p-2 cursor-pointer hover:bg-muted/50"
          >
            <Checkbox
              :model-value="selectedProductIds.has(p.id)"
              @update:modelValue="toggleProduct(p.id)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-mono font-medium truncate">{{ p.model }}</p>
              <p class="text-xs text-muted-foreground">
                <Badge variant="secondary">{{ p.category }}</Badge>
                · {{ p.conversion_rate }}
              </p>
            </div>
          </label>
        </div>
      </CardContent>
    </Card>

    <!-- 4. 预览 + 提交 -->
    <Card>
      <CardHeader>
        <CardTitle>{{ t('admin.assign.step4') }}</CardTitle>
        <CardDescription>{{ t('admin.assign.step4Desc', { n: previewRows.length }) }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center gap-2">
          <Checkbox v-model="defaultVisible" />
          <Label>{{ t('admin.assign.defaultVisible') }}</Label>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('admin.assign.colAccount') }}</TableHead>
              <TableHead>{{ t('admin.assign.colProduct') }}</TableHead>
              <TableHead>{{ t('admin.assign.colCategory') }}</TableHead>
              <TableHead>{{ t('admin.assign.colL1') }}</TableHead>
              <TableHead>{{ t('admin.assign.colL2') }}</TableHead>
              <TableHead>{{ t('admin.assign.colVisible') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in previewRows" :key="r.account_id + r.product_id">
              <TableCell class="text-sm">
                {{ accounts.items.value.find(a => a.id === r.account_id)?.account_name }}
              </TableCell>
              <TableCell class="font-mono text-sm">
                {{ products.items.value.find(p => p.id === r.product_id)?.model }}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {{ products.items.value.find(p => p.id === r.product_id)?.category }}
                </Badge>
              </TableCell>
              <TableCell>{{ r.stock_level_1 }}</TableCell>
              <TableCell>{{ r.stock_level_2 }}</TableCell>
              <TableCell>
                <Badge v-if="r.is_visible" class="bg-emerald-100 text-emerald-800">
                  {{ t('admin.assign.visible') }}
                </Badge>
                <Badge v-else variant="secondary">{{ t('admin.assign.hidden') }}</Badge>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="previewRows.length === 0">
              {{ t('admin.assign.empty') }}
            </TableEmpty>
          </TableBody>
        </Table>

        <div class="flex flex-wrap gap-2">
          <Button :disabled="submitting || previewRows.length === 0" @click="onSubmit">
            {{ t('admin.assign.submitBtn') }}
          </Button>
        </div>

        <div
          v-if="result"
          class="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm"
        >
          <CheckCircle2 class="h-5 w-5 text-emerald-600 mt-0.5" />
          <p class="text-emerald-800">{{ t('admin.assign.success', { n: result.count }) }}</p>
        </div>

        <div
          v-if="ap.error.value"
          class="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm"
        >
          <AlertTriangle class="h-5 w-5 text-red-600 mt-0.5" />
          <p class="text-red-800">{{ ap.error.value }}</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
