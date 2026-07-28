<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/components/ui/Button.vue'
import { cn } from '@/lib/utils'

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  class?: string
}>(), {
  variant: 'ghost',
  size: 'icon',
})

const classes = computed(() => cn('h-7 w-7 rounded-md', props.class))
</script>

<template>
  <Button
    :variant="props.variant"
    :size="props.size"
    :class="classes"
    type="button"
  >
    <slot />
  </Button>
</template>
