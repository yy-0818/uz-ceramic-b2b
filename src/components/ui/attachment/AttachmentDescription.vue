<script setup lang="ts">
import { cn } from '@/lib/utils'
defineProps<{ class?: string }>()
</script>
<template>
  <span :class="cn('truncate text-xs text-muted-foreground', $props.class)">
    <slot />
  </span>
</template>
