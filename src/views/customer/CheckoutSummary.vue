<!--
  CheckoutSummary — 结算面板
  - 显示订单汇总（件数、体积）
  - 选中账号信息
  - 提交按钮
-->
<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Loader2, Receipt, Star } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import type { Account } from '@/composables/useAccounts'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'

const props = defineProps<{
  totalBoxes: number
  totalM2: number
  fmtM2: (n: number) => string
  isOnBehalf: boolean
  selectedParent: Account | undefined
  selectedSub: Account | undefined
  canSubmit: boolean
  submitting: boolean
}>()

const emit = defineEmits<{
  submit: []
}>()

const { t } = useI18n()
</script>

<template>
  <aside class="lg:sticky lg:top-4 lg:self-start space-y-3">
    <Card class="overflow-hidden">
      <CardContent class="p-0">
        <!-- header -->
        <div class="px-5 py-3.5 border-b bg-gradient-to-br from-primary/[0.06] via-primary/[0.02] to-transparent">
          <div class="flex items-center gap-2">
            <div class="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Receipt class="h-3.5 w-3.5 text-primary" />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold leading-tight">
                {{ t('customer.checkout.summaryTitle') }}
              </p>
              <p class="text-[10px] text-muted-foreground leading-snug">
                {{ t('customer.checkout.summarySubtitle') }}
              </p>
            </div>
          </div>
        </div>

        <!-- 数据汇总 -->
        <div class="px-5 py-4 space-y-2 text-xs">
          <div class="flex justify-between items-baseline">
            <span class="text-muted-foreground">{{ t('customer.checkout.totalBoxes') }}</span>
            <span class="font-semibold tabular-nums text-sm">{{ totalBoxes }} ящ.</span>
          </div>
          <div class="flex justify-between items-baseline">
            <span class="text-muted-foreground">{{ t('customer.checkout.totalM2') }}</span>
            <span class="font-semibold tabular-nums text-sm">{{ fmtM2(totalM2) }}</span>
          </div>
          <div class="border-t pt-2.5 mt-2 flex justify-between items-baseline">
            <span class="text-muted-foreground text-[10px]">
              {{ t('customer.checkout.totalAmount') }}
            </span>
            <Badge variant="secondary" class="text-[9px]">
              {{ t('customer.checkout.pendingAmount') }}
            </Badge>
          </div>
        </div>

        <!-- 选中状态 -->
        <div v-if="isOnBehalf || selectedSub" class="px-5 pb-4 space-y-2">
          <!-- 代客父客户 -->
          <div
            v-if="isOnBehalf && selectedParent"
            class="rounded-md border bg-amber-50 border-amber-200/80 p-2.5"
          >
            <p class="text-[9px] uppercase tracking-wider text-amber-700 mb-1 font-semibold">
              代客下单 · 父客户
            </p>
            <p class="font-mono text-xs font-semibold text-amber-900 truncate">
              {{ selectedParent.account_name }}
            </p>
          </div>

          <!-- 收货子账号 -->
          <div
            v-if="selectedSub"
            class="rounded-md border bg-muted/40 p-2.5"
          >
            <p class="text-[9px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
              {{ t('customer.checkout.subAccountLabel') }}
            </p>
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-xs font-semibold truncate">
                {{ selectedSub.account_name }}
              </span>
              <Star
                v-if="selectedSub.is_main"
                class="h-3 w-3 text-amber-500 fill-current shrink-0"
              />
            </div>
          </div>

          <!-- 提示 -->
          <div
            v-if="isOnBehalf && !selectedParent"
            class="rounded-md border border-dashed bg-muted/30 p-2.5 text-[11px] text-muted-foreground"
          >
            请先在上方选择父客户
          </div>
          <div
            v-else-if="!selectedSub"
            class="rounded-md border border-dashed bg-muted/30 p-2.5 text-[11px] text-muted-foreground"
          >
            请在上方选择收货子账号
          </div>
        </div>

        <!-- 提交按钮 -->
        <div class="px-5 pb-5">
          <Button
            class="w-full h-11 text-sm font-semibold shadow-md shadow-primary/20"
            size="lg"
            :disabled="!canSubmit || submitting"
            @click="emit('submit')"
          >
            <Loader2 v-if="submitting" class="mr-1.5 h-4 w-4 animate-spin" />
            <CheckCircle2 v-else class="mr-1.5 h-4 w-4" />
            {{
              submitting
                ? t('customer.checkout.submitting')
                : t('customer.checkout.submit')
            }}
          </Button>
          <p class="text-[10px] text-muted-foreground text-center leading-relaxed mt-1.5">
            {{ t('customer.checkout.submitHint') }}
          </p>
        </div>
      </CardContent>
    </Card>
  </aside>
</template>
