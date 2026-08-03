<!--
  ChatDateDivider —— 日期分隔
  "今天 / 昨天 / 2026-08-02"
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/lib/i18n'
const { t } = useI18n()

const props = defineProps<{ iso: string }>()

const label = computed(() => {
  const d = new Date(props.iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return t('chat.today')
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return t('chat.yesterday')
  return d.toLocaleDateString()
})
</script>
<template>
  <div class="flex items-center justify-center my-2">
    <span class="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      {{ label }}
    </span>
  </div>
</template>
