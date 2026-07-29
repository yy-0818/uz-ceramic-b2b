<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue?: string
  placeholder?: string
  class?: string
  rows?: number
  id?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const classes = computed(() =>
  cn(
    'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
    'ring-offset-background placeholder:text-muted-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    props.class,
  ),
)

const onInput = (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
</script>

<template>
  <textarea
    :id="id"
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows ?? 3"
    :disabled="disabled"
    :class="classes"
    @input="onInput"
  />
</template>
