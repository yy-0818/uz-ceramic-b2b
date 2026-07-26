<!--
  src/views/admin/AllProductsPage.vue
  admin 视角：所有商品 + 色号 明细表

  - 走 v_products_with_colors view（绕过 account_products 白名单）
  - 搜索 + 按分类 / 换算率筛选
  - 每行展示：型号、分类、换算率、1级总库存、2级总库存、色号 chip 列表
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, RefreshCw, Loader2, Box, Package } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'

import { useProducts, type ProductWithColors } from '@/composables/useProducts'

const { t } = useI18n()
const productsApi = useProducts()

const items = ref<ProductWithColors[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const categoryFilter = ref<string>('all')
const onlyWithStock = ref(false)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    items.value = await productsApi.fetchAllWithColors()
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const categories = computed(() => {
  const set = new Set<string>()
  items.value.forEach((p) => p.category && set.add(p.category))
  return ['all', ...Array.from(set).sort()]
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((p) => {
    if (categoryFilter.value !== 'all' && p.category !== categoryFilter.value) return false
    if (onlyWithStock.value && (p.total_boxes_level1 + p.total_boxes_level2) === 0) return false
    if (!q) return true
    return (
      p.model.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.remark || '').toLowerCase().includes(q) ||
      (p.colors ?? []).some((c) => c.color_code.toLowerCase().includes(q))
    )
  })
})

// 汇总
const summary = computed(() => {
  const total = filtered.value.length
  const totalL1 = filtered.value.reduce((s, p) => s + (p.total_boxes_level1 ?? 0), 0)
  const totalL2 = filtered.value.reduce((s, p) => s + (p.total_boxes_level2 ?? 0), 0)
  const totalColors = filtered.value.reduce((s, p) => s + (p.colors?.length ?? 0), 0)
  return { total, totalL1, totalL2, totalColors }
})

const fmtBoxes = (n: number) => n.toLocaleString()
</script>

<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle class="flex items-center gap-2">
              <Package class="h-5 w-5" />
              {{ t('admin.products.title') }}
            </CardTitle>
            <CardDescription>{{ t('admin.products.desc') }}</CardDescription>
          </div>
          <Button variant="outline" size="sm" @click="load" :disabled="loading">
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            <RefreshCw v-else class="mr-2 h-4 w-4" />
            {{ t('common.refresh') }}
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <!-- 汇总 -->
        <div class="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">
            {{ t('admin.products.statTotal', { n: summary.total }) }}
          </Badge>
          <Badge variant="secondary">
            {{ t('admin.products.statL1', { n: fmtBoxes(summary.totalL1) }) }}
          </Badge>
          <Badge variant="secondary">
            {{ t('admin.products.statL2', { n: fmtBoxes(summary.totalL2) }) }}
          </Badge>
          <Badge variant="secondary">
            {{ t('admin.products.statColors', { n: summary.totalColors }) }}
          </Badge>
        </div>

        <!-- 筛选 -->
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input v-model="search" :placeholder="t('admin.products.searchPh')" class="pl-9 h-9" />
          </div>
          <label class="flex items-center gap-2 text-xs">
            <input type="checkbox" v-model="onlyWithStock" class="rounded" />
            {{ t('admin.products.onlyWithStock') }}
          </label>
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <Button
            v-for="c in categories"
            :key="c"
            size="sm"
            :variant="categoryFilter === c ? 'default' : 'outline'"
            class="shrink-0"
            @click="categoryFilter = c"
          >
            {{ c === 'all' ? t('admin.products.allCategory') : c }}
          </Button>
        </div>

        <div v-if="error" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ error }}
        </div>
      </CardContent>
    </Card>

    <!-- 表格 -->
    <Card>
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-muted/40">
              <tr class="text-xs text-muted-foreground">
                <th class="text-left py-2 px-3">{{ t('admin.products.colModel') }}</th>
                <th class="text-left py-2 px-3">{{ t('admin.products.colCategory') }}</th>
                <th class="text-right py-2 px-3">{{ t('admin.products.colL1') }}</th>
                <th class="text-right py-2 px-3">{{ t('admin.products.colL2') }}</th>
                <th class="text-right py-2 px-3">{{ t('admin.products.colConv') }}</th>
                <th class="text-left py-2 px-3">{{ t('admin.products.colColors') }}</th>
                <th class="text-left py-2 px-3">{{ t('admin.products.colRemark') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in filtered"
                :key="p.product_id"
                class="border-t hover:bg-muted/30"
              >
                <td class="py-2 px-3 font-mono font-medium">{{ p.model }}</td>
                <td class="py-2 px-3">
                  <Badge variant="outline">{{ p.category }}</Badge>
                </td>
                <td class="py-2 px-3 text-right font-mono">{{ p.total_boxes_level1 }}</td>
                <td class="py-2 px-3 text-right font-mono">{{ p.total_boxes_level2 }}</td>
                <td class="py-2 px-3 text-right text-muted-foreground">{{ p.conversion_rate }}</td>
                <td class="py-2 px-3">
                  <div class="flex flex-wrap gap-1 max-w-md">
                    <Badge
                      v-for="c in (p.colors ?? [])"
                      :key="c.color_code + '_' + c.stock_level"
                      variant="secondary"
                      class="font-mono text-[10px]"
                    >
                      {{ c.color_code }}: {{ c.boxes }}
                    </Badge>
                    <span v-if="(p.colors ?? []).length === 0" class="text-xs text-muted-foreground italic">
                      —
                    </span>
                  </div>
                </td>
                <td class="py-2 px-3 text-xs text-muted-foreground">{{ p.remark || '—' }}</td>
              </tr>
              <tr v-if="filtered.length === 0 && !loading">
                <td colspan="7" class="py-8 text-center text-sm text-muted-foreground">
                  {{ t('admin.products.empty') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  </div>
</template>