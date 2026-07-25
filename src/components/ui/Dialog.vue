<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{ open: boolean; title?: string; description?: string; class?: string }>()
const emit = defineEmits<{ 'update:open': [v: boolean] }>()

const close = () => emit('update:open', false)

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

watch(() => props.open, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
})
</script>

<template>
  <Teleport to="body">
    <transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" @click="close" />
    </transition>
    <transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        :class="cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-[92vw] max-w-md rounded-lg border bg-background p-6 shadow-lg',
          $props.class,
        )"
        role="dialog"
        aria-modal="true"
      >
        <button
          class="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
          @click="close"
        >
          <X class="h-4 w-4" />
        </button>
        <div v-if="title || description" class="mb-4">
          <h3 v-if="title" class="text-lg font-semibold leading-none tracking-tight">{{ title }}</h3>
          <p v-if="description" class="mt-1.5 text-sm text-muted-foreground">{{ description }}</p>
        </div>
        <slot />
      </div>
    </transition>
  </Teleport>
</template>
