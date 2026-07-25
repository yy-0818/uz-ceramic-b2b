<script setup lang="ts">
import { computed } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const variants = cva(
  'inline-flex items-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        active: 'bg-primary text-primary-foreground border-primary',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2',
        lg: 'h-10 px-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type V = VariantProps<typeof variants>
const props = withDefaults(defineProps<{ variant?: V['variant']; size?: V['size']; class?: string; active?: boolean }>(), {
  variant: 'default', size: 'default', active: false,
})

const cls = computed(() => cn(variants({ variant: props.active ? 'active' : props.variant, size: props.size }), props.class))
</script>

<template>
  <button type="button" :class="cls">
    <slot />
  </button>
</template>
