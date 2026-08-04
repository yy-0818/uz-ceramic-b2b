<!--
  CheckoutAccountPicker — 账号选择器
  - 代客模式：双列（父客户 + 子账号）
  - 普通客户模式：单列（子账号）
-->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Loader2, Search, X, ChevronRight, AlertCircle, Check } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import type { Account } from '@/composables/useAccounts'
import Badge from '@/components/ui/Badge.vue'
import Label from '@/components/ui/Label.vue'

const props = defineProps<{
  isOnBehalf: boolean
  subs: Account[]
  subsLoaded: boolean
  loadingSubs: boolean
  parents: Account[]
  parentsLoaded: boolean
  loadingParents: boolean
  subId: string
  pickedParentId: string
  selectedParent: Account | undefined
}>()

const emit = defineEmits<{
  'update:subId': [id: string]
  'update:pickedParentId': [id: string]
  loadSubs: [parentId: string]
}>()

const { t } = useI18n()

const parentSearch = ref('')
const subSearch = ref('')

const norm = (s: string) => s.toLowerCase().trim()

const filteredParents = computed(() => {
  const q = norm(parentSearch.value)
  if (!q) return props.parents
  return props.parents.filter((p) => {
    return norm(p.account_name).includes(q)
      || norm(p.company_name ?? '').includes(q)
  })
})

const filteredSubs = computed(() => {
  const q = norm(subSearch.value)
  const list = !q ? props.subs : props.subs.filter((s) => {
    return norm(s.account_name).includes(q)
      || norm(s.inn ?? '').includes(q)
  })
  return [...list].sort((a, b) => Number(b.is_main) - Number(a.is_main))
})
</script>

<template>
  <section class="px-5 sm:px-6 py-5 border-b">
    <div class="flex items-center gap-2 mb-3">
      <span class="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
        2
      </span>
      <!-- 用动态 key 避免 Vue 复用 DOM -->
      <svg class="h-3.5 w-3.5 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
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

    <!-- 代客模式：双列 -->
    <div v-if="isOnBehalf" class="grid grid-cols-1 lg:grid-cols-12 gap-3">
      <!-- 左列 5/12：父客户 -->
      <div class="lg:col-span-5 relative rounded-lg border border-border/60 bg-muted/20 flex flex-col">
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
        <!-- 空 -->
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
        <div v-else class="relative">
          <div class="max-h-[480px] overflow-y-auto overscroll-contain p-2" data-testid="parent-account-list-scroll">
            <div class="space-y-1.5">
              <button
                v-for="p in filteredParents"
                :key="p.id"
                type="button"
                class="w-full text-left rounded-lg border-2 p-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :class="pickedParentId === p.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/60 hover:border-primary/40 hover:bg-muted/40'"
                @click="emit('update:pickedParentId', p.id)"
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
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-muted/60 to-transparent rounded-b-lg" aria-hidden="true" />
        </div>
      </div>

      <!-- 右列 7/12：子账号 -->
      <div class="lg:col-span-7 relative rounded-lg border border-border/60 bg-muted/20 flex flex-col">
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

        <!-- 占位 -->
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
        <!-- 空 -->
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
        <div v-else class="relative">
          <div class="max-h-[480px] overflow-y-auto overscroll-contain p-2" data-testid="sub-account-list-scroll">
            <div class="grid grid-cols-1 gap-2">
              <button
                v-for="s in filteredSubs"
                :key="s.id"
                type="button"
                class="w-full text-left rounded-lg border-2 p-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :class="subId === s.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/60 hover:border-primary/40 hover:bg-muted/40'"
                @click="emit('update:subId', s.id)"
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
                        <svg class="h-3 w-3 mr-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
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
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-muted/60 to-transparent rounded-b-lg" aria-hidden="true" />
        </div>
      </div>
    </div>

    <!-- 普通客户模式：单列 -->
    <div v-else>
      <div v-if="!subsLoaded" class="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        {{ t('customer.checkout.loadingSubs') }}
      </div>
      <div
        v-else-if="subs.length === 0"
        class="flex gap-2.5 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-2.5 text-xs"
      >
        <AlertCircle class="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <p class="leading-relaxed">{{ t('customer.checkout.noSubs') }}</p>
      </div>
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="s in subs"
          :key="s.id"
          type="button"
          class="text-left rounded-lg border-2 p-2.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="subId === s.id
            ? 'border-primary bg-primary/5 shadow-sm'
            : 'border-border/60 hover:border-primary/40 hover:bg-muted/40'"
          @click="emit('update:subId', s.id)"
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
                  <svg class="h-3 w-3 mr-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
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
</template>
