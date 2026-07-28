<script setup lang="ts">
/**
 * Attachment —— shadcn-vue 风格的附件/图片卡片
 * 用法：包住 AttachmentMedia + AttachmentContent + AttachmentActions
 */
import { computed } from 'vue'
import { cn } from '@/lib/utils'

type State = 'idle' | 'uploading' | 'processing' | 'error' | 'done'
type Size = 'default' | 'sm' | 'xs'
type Orientation = 'horizontal' | 'vertical'

const props = withDefaults(defineProps<{
  state?: State
  size?: Size
  orientation?: Orientation
  class?: string
}>(), {
  state: 'done',
  size: 'default',
  orientation: 'horizontal',
})

const orientationClasses = computed(() =>
  props.orientation === 'vertical' ? 'flex-col' : 'flex-row items-center',
)

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'gap-2 p-2'
    case 'xs': return 'gap-1.5 p-1.5'
    default:  return 'gap-3 p-3'
  }
})

const stateClasses = computed(() => {
  switch (props.state) {
    case 'error':
      return 'border-destructive/50 bg-destructive/5'
    case 'uploading':
    case 'processing':
      return 'border-muted-foreground/30'
    case 'idle':
      return 'border-dashed bg-muted/30'
    default:
      return 'border-border bg-card'
  }
})
</script>

<template>
  <div
    role="group"
    :data-state="props.state"
    :data-size="props.size"
    :class="cn(
      'relative w-full overflow-hidden rounded-lg border shadow-sm transition-colors',
      orientationClasses,
      sizeClasses,
      stateClasses,
      props.class,
    )"
  >
    <slot />
  </div>
</template>
