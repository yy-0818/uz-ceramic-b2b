<!--
  ThemeToggle —— 浅色/深色切换按钮
  按 shadcn-vue 风格：IconButton + Sun/Moon 切换 + tooltip
  24/24 button，不带文字标签，节省 chrome 空间
-->
<script setup lang="ts">
import { Sun, Moon } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'
import Button from '@/components/ui/Button.vue'

const { isDark, toggle } = useTheme()
</script>

<template>
  <Button
    size="sm"
    variant="ghost"
    class="h-9 w-9 p-0"
    :title="isDark ? '切换到浅色' : '切换到深色'"
    :aria-label="isDark ? '切换到浅色' : '切换到深色'"
    @click="toggle"
  >
    <Sun v-if="isDark" class="h-4 w-4" />
    <Moon v-else class="h-4 w-4" />
  </Button>
</template>