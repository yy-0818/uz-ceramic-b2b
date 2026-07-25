<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
const classes = computed(() =>
  cn('[&_tr]:border-b transition-colors hover:bg-muted/50', props.class),
)
</script>

<template>
  <tr :class="classes">
    <slot />
  </tr>
</template>
