<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
const classes = computed(() =>
  cn('h-12 px-4 text-left align-middle font-medium text-muted-foreground', props.class),
)
</script>

<template>
  <th :class="classes">
    <slot />
  </th>
</template>
