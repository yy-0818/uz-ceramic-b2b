<!--
  ChatEditBar — 编辑消息的内联编辑条
  - 显示正在编辑的消息
  - 保存/取消按钮
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '@/lib/i18n'
import type { ChatMessage } from '@/composables/useChat'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  editingMessage: ChatMessage | null
  editDraft: string
  editSubmitting: boolean
}>()

const emit = defineEmits<{
  'update:editDraft': [value: string]
  submitEdit: []
  cancelEdit: []
}>()

const { t } = useI18n()

const canSubmit = computed(() => props.editDraft.trim().length > 0)
</script>

<template>
  <div
    v-if="editingMessage"
    class="border-t bg-muted/40 px-3 py-2 flex items-end gap-2"
  >
    <div class="flex-1 min-w-0">
      <p class="text-[10px] text-muted-foreground mb-1">
        {{ t('chat.editingMessage') }}
      </p>
      <textarea
        :value="editDraft"
        rows="2"
        class="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @input="emit('update:editDraft', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
    <div class="flex flex-col gap-1">
      <Button size="sm" :disabled="editSubmitting || !canSubmit" @click="emit('submitEdit')">
        {{ t('chat.save') }}
      </Button>
      <Button size="sm" variant="ghost" :disabled="editSubmitting" @click="emit('cancelEdit')">
        {{ t('chat.cancelEdit') }}
      </Button>
    </div>
  </div>
</template>
