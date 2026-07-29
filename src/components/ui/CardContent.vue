<script setup lang="ts">
defineProps<{ class?: string }>()
</script>

<template>
  <div :class="['p-4 pt-0', $props.class]">
    <slot />
  </div>
</template>
