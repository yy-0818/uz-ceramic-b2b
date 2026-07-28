<script setup lang="ts">
/**
 * AttachmentMedia —— 图标 / 图片两种 variant
 * - variant="icon"（默认）：居中显示一个 lucide 图标
 * - variant="image"：填满式图片预览
 */
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  variant?: 'icon' | 'image'
  class?: string
}>(), { variant: 'icon' })

const classes = computed(() => cn(
  'relative flex shrink-0 items-center justify-center overflow-hidden',
  props.variant === 'image'
    ? 'aspect-square w-full bg-muted'
    : 'h-10 w-10 rounded-md bg-muted text-muted-foreground',
  props.class,
))
</script>

<template>
  <div :class="classes" :data-variant="props.variant">
    <slot />
  </div>
</template>
