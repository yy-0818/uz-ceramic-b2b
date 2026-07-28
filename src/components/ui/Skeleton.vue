<script setup lang="ts">
/**
 * Skeleton —— shadcn-vue 风格的占位块
 * 用法：<Skeleton class="h-4 w-32" />
 *      <Skeleton variant="circle" class="h-10 w-10" />
 *      <Skeleton variant="text" />  → 默认 width=full, h=4
 */
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  variant?: 'rect' | 'text' | 'circle'
  class?: string
}>(), { variant: 'rect' })

const classes = computed(() => cn(
  'relative block overflow-hidden bg-muted',
  // 仅在用户无"减弱动效"时启用 pulse
  'motion-safe:animate-pulse',
  // pulse + 移动 shimmer
  'after:absolute after:inset-0 after:-translate-x-full',
  'after:bg-gradient-to-r after:from-transparent after:via-foreground/5 after:to-transparent',
  'after:animate-shimmer',
  props.variant === 'circle' && 'rounded-full',
  props.variant === 'text' && 'h-3 w-full rounded-md',
  props.variant === 'rect' && 'rounded-md',
  props.class,
))
</script>

<template>
  <span :class="classes" aria-hidden="true" />
</template>
