<!--
  src/views/admin/product-import/ImportPreviewCard.vue
  步骤 2：库存预览（两层归纳：分类 → 色号前缀）
  父级：
    <ImportPreviewCard
      :categories="aggregatedCategories"
      :unmapped-count="N"
      :strategy="strategy"
      :importing="importing"
      :search="search"
      :empty="filtered.length === 0"
      @toggle-category="toggleCategory"
      @change-strategy="s => strategy = s"
      @update:search="v => search = v"
      @import="onImport"
    />
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Boxes, ChevronDown, ChevronRight, Eye, EyeOff, AlertTriangle, Loader2 } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

import { useI18n } from '@/lib/i18n'
import type { CategoryAgg } from '@/composables/useCategoryAggregate'

type Strategy = 'upsert' | 'skip_existing'

const props = defineProps<{
  categories: CategoryAgg[]
  expanded: Record<string, boolean>
  unmappedCount: number
  strategy: Strategy
  importing: boolean
  search: string
  empty: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-category', cat: string): void
  (e: 'change-strategy', s: Strategy): void
  (e: 'update:search', v: string): void
  (e: 'import'): void
  (e: 'show-unmapped'): void
  (e: 'go-assign'): void
}>()

const { t } = useI18n()

const isExpanded = (cat: string) => !!props.expanded[cat]
</script>

<template>
  <Card class="flex flex-col" style="height: calc(100vh - 220px); min-height: 480px;">
    <CardHeader class="shrink-0 pb-3">
      <div class="flex items-center justify-between gap-3">
        <CardTitle class="flex items-center gap-2">
          <Boxes class="h-5 w-5" />
          {{ t('admin.import.step2') }}
        </CardTitle>
        <div class="flex items-center gap-2 shrink-0">
          <Label class="text-xs">{{ t('admin.import.search') }}</Label>
          <Input
            :model-value="search"
            @update:model-value="emit('update:search', $event)"
            class="w-56"
            :placeholder="t('admin.import.searchPh')"
          />
        </div>
      </div>
    </CardHeader>

    <CardContent class="flex-1 min-h-0 p-0">
      <div class="h-full overflow-y-auto px-6 pb-3">
        <div v-for="agg in categories" :key="agg.category" class="mb-4 border rounded-lg overflow-hidden">
          <!-- 分类头 -->
          <button
            class="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition text-left"
            @click="emit('toggle-category', agg.category)"
          >
            <component :is="isExpanded(agg.category) ? ChevronDown : ChevronRight" class="h-4 w-4 text-muted-foreground" />
            <Badge>{{ agg.category }}</Badge>
            <span class="text-xs text-muted-foreground">
              {{ agg.models }} {{ t('admin.import.modelsUnit') }}
            </span>
            <span class="text-xs text-muted-foreground">·</span>
            <span class="text-xs text-emerald-700">L1 {{ agg.totalL1.toLocaleString() }}</span>
            <span class="text-xs text-muted-foreground">·</span>
            <span class="text-xs text-sky-700">L2 {{ agg.totalL2.toLocaleString() }}</span>
            <span class="text-xs text-muted-foreground">·</span>
            <span class="text-xs">
              <span
                v-for="pf in agg.prefixes" :key="pf.prefix"
                class="inline-flex items-center px-1.5 py-0.5 rounded bg-background border mr-1 font-mono text-[10px]"
              >
                {{ pf.prefix }}: {{ pf.boxes.toLocaleString() }}
              </span>
            </span>
          </button>

          <!-- 商品行 -->
          <div v-show="isExpanded(agg.category)" class="divide-y">
            <div v-for="p in agg.products" :key="p.model"
              class="px-4 py-2 grid grid-cols-12 gap-2 items-start text-sm">
              <div class="col-span-3">
                <div class="flex items-center gap-1">
                  <span class="font-mono font-medium truncate">{{ p.model }}</span>
                  <span v-if="p.isVisible" class="text-emerald-600"><Eye class="h-3 w-3" /></span>
                  <span v-else class="text-muted-foreground"><EyeOff class="h-3 w-3" /></span>
                </div>
                <p v-if="p.remark" class="text-xs text-muted-foreground truncate">{{ p.remark }}</p>
                <p class="text-xs text-muted-foreground">{{ p.conversionRate }} м²/ящ</p>
              </div>
              <div class="col-span-6 flex flex-wrap gap-1">
                <Badge v-for="c in p.colors" :key="c.colorCode + c.stockLevel"
                  variant="outline" class="font-mono">
                  {{ c.colorCode }}: {{ c.boxes }}
                </Badge>
                <span v-if="p.colors.length === 0" class="text-xs text-muted-foreground italic">
                  {{ t('admin.import.noColors') }}
                </span>
              </div>
              <div class="col-span-3 text-xs text-muted-foreground">
                <div>
                  L1: <span class="font-medium text-foreground">{{ p.totalLevel1 }}</span>
                  ·
                  L2: <span class="font-medium text-foreground">{{ p.totalLevel2 }}</span>
                </div>
                <div class="truncate" :title="p.customerGroups.join(', ')">
                  {{ t('admin.import.groups') }}: {{ p.customerGroups.length }}
                </div>
                <div>
                  <Badge v-if="p.existsInDb" class="bg-amber-100 text-amber-800 text-[10px] py-0">
                    {{ t('admin.import.exists') }}
                  </Badge>
                  <Badge v-else class="bg-emerald-100 text-emerald-800 text-[10px] py-0">
                    {{ t('admin.import.new') }}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="empty" class="py-10 text-center text-sm text-muted-foreground">
          {{ t('admin.import.empty') }}
        </div>
      </div>
    </CardContent>

    <!-- 底部操作条 -->
    <div class="shrink-0 border-t bg-card px-6 py-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 text-xs">
        <Button v-if="unmappedCount > 0" variant="outline" size="sm"
          class="text-amber-700 border-amber-200 hover:bg-amber-50"
          @click="emit('show-unmapped')">
          <AlertTriangle class="h-3 w-3 mr-1" />
          {{ t('admin.import.unmappedWarn', { n: unmappedCount }) }}
        </Button>
        <span v-else class="text-emerald-700">✓ {{ t('admin.import.allMapped') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center rounded-md border text-xs">
          <button class="px-3 py-1.5 transition"
            :class="strategy === 'upsert' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            @click="emit('change-strategy', 'upsert')">
            {{ t('admin.import.stratUpsert') }}
          </button>
          <button class="px-3 py-1.5 border-l transition"
            :class="strategy === 'skip_existing' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
            @click="emit('change-strategy', 'skip_existing')">
            {{ t('admin.import.stratSkip') }}
          </button>
        </div>
        <Button :disabled="importing" @click="emit('import')">
          <Loader2 v-if="importing" class="mr-2 h-4 w-4 animate-spin" />
          {{ t('admin.import.importBtn') }}
        </Button>
      </div>
    </div>
  </Card>
</template>