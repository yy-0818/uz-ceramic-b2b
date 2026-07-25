<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue?: boolean
  disabled?: boolean
  id?: string
  class?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const classes = computed(() =>
  cn(
    'peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    props.modelValue
      ? 'bg-primary text-primary-foreground'
      : 'bg-background',
    props.class,
  ),
)

const toggle = () => {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="modelValue"
    :id="id"
    :disabled="disabled"
    :class="classes"
    @click="toggle"
  >
    <Check v-if="modelValue" class="h-3.5 w-3.5" />
  </button>
</template>
