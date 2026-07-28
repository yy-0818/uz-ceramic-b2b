<script setup lang="ts">
import { cn } from '@/lib/utils'
defineProps<{ class?: string }>()
</script>
<template>
  <div :class="cn('flex min-w-0 flex-1 flex-col justify-center gap-0.5', $props.class)">
    <slot />
  </div>
</template>
