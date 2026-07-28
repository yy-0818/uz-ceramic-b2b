<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  // 上传/处理中 shimmer 效果（与文档同步行为）
  shimmer?: boolean
  class?: string
}>(), { shimmer: false })

const classes = computed(() => cn(
  'block truncate text-sm font-medium text-foreground',
  props.shimmer && 'animate-pulse text-muted-foreground',
  props.class,
))
</script>
<template>
  <span :class="classes">
    <slot />
  </span>
</template>
