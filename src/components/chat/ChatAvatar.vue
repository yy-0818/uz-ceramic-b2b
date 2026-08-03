<!--
  ChatAvatar —— 用户头像 (Phase 1: 首字母 + 颜色)
  Phase 2 可接入 auth.users.avatar_url
-->
<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  name: string
  role?: 'customer' | 'staff' | string
  size?: 'sm' | 'md'
}>()

const size = computed(() => props.size ?? 'sm')

const initial = computed(() => {
  const s = (props.name ?? '').trim()
  return (s[0] ?? '?').toUpperCase()
})

const hue = computed(() => {
  let h = 0
  const s = props.name ?? ''
  for (let i = 0; i < Math.min(s.length, 8); i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
})

const tone = computed(() =>
  props.role === 'customer' ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary',
)
</script>
<template>
  <div
    class="rounded-full flex items-center justify-center font-semibold"
    :class="cn(
      tone,
      size === 'md' ? 'h-10 w-10 text-sm' : 'h-7 w-7 text-[11px]',
    )"
  >
    <span :style="{ color: role === 'staff' ? `hsl(${hue}, 60%, 35%)` : undefined }">
      {{ initial }}
    </span>
  </div>
</template>
