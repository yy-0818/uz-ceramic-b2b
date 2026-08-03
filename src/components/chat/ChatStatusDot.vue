<!--
  ChatStatusDot —— 在离线状态小圆点
-->
<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { ChatPresenceStatus } from '@/composables/useChat'

const props = defineProps<{
  status: ChatPresenceStatus
  size?: 'sm' | 'md'
}>()

const { t } = useI18n()
const size = computed(() => props.size ?? 'sm')
const color = computed(() => {
  switch (props.status) {
    case 'online': return 'bg-emerald-500'
    case 'away':   return 'bg-amber-500'
    default:       return 'bg-muted-foreground/40'
  }
})
const label = computed(() => t(`chat.${props.status}`))
</script>
<template>
  <span
    class="relative inline-flex"
    :title="label"
    :aria-label="label"
  >
    <span
      class="rounded-full ring-2 ring-background"
      :class="cn(color, size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2')"
    />
  </span>
</template>
