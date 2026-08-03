<!--
  ChatTyping —— "对方正在输入" 占位
  - props:
    - who?: string   对方姓名 (空 = 默认 "对方")
    - role?: 'customer' | 'staff'  头像来定
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()
const props = defineProps<{
  who?: string | null
  role?: 'customer' | 'staff'
}>()

const label = computed(() => {
  const name = props.who?.trim()
  if (name) return `${name} ${t('chat.typingSuffix')}`
  return props.role === 'customer'
    ? t('chat.typingCustomer')
    : t('chat.typingStaff')
})
</script>

<template>
  <div class="flex justify-start">
    <div class="bg-muted text-foreground rounded-2xl rounded-bl-md px-3 py-2 shadow-sm flex items-center gap-1.5">
      <span class="text-xs text-muted-foreground">
        {{ label }}
      </span>
      <span class="inline-flex gap-0.5 ml-0.5 align-middle">
        <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style="animation-delay: 0ms" />
        <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style="animation-delay: 120ms" />
        <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style="animation-delay: 240ms" />
      </span>
    </div>
  </div>
</template>
