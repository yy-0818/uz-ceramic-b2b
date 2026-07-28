<script setup lang="ts">
import { cn } from '@/lib/utils'
defineProps<{ class?: string }>()
</script>
<template>
  <!--
    横向滚动 + 边缘 fade：
    [scroll-fade from=end] 距右端 < 0.05 时附加 fade-mask-right
  -->
  <div
    role="group"
    :class="cn(
      'flex w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-1',
      $props.class,
    )"
  >
    <slot />
  </div>
</template>
