<!--
  ChatComposer —— 消息输入 + 发送
  - text: Enter 发送, Shift+Enter 换行
  - 多图预览 + 上传按钮 + emoji 选择器
  - Phase 8: 草稿自动保存 (per conversation)
-->
<script setup lang="ts">
import { ref, nextTick, computed, watch, onBeforeUnmount } from 'vue'
import { Send, Loader2, ImagePlus, Smile, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import ChatEmojiPanel from './ChatEmojiPanel.vue'
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()

export interface PendingImage {
  /** local object URL */
  localUrl: string
  /** raw File 引用 */
  file: File
  /** 客户端占位 message id (uuid) */
  clientMessageId: string
}

const text = ref('')
const sending = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const emojiOpen = ref(false)

const props = defineProps<{
  /** 当前正在上传的图片 (uploadImage 已返回的列表) */
  uploading?: PendingImage[]
  /** 草稿键 — 用 conversationId, 切会话时不串草稿 */
  draftKey?: string
}>()

const emit = defineEmits<{
  send: [body: string]
  pickImage: [file: File, clientMessageId: string]
  removeImage: [clientMessageId: string]
  typing: []
}>()

// Phase 8: 草稿持久化 (per-conversation localStorage)
const draftStorageKey = computed(() => `chat:draft:${props.draftKey ?? '_'}`)

const loadDraft = () => {
  if (typeof window === 'undefined') return
  try { text.value = localStorage.getItem(draftStorageKey.value) ?? '' } catch { text.value = '' }
}

let draftTimer: number | undefined
const autoResize = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}
const saveDraft = () => {
  if (typeof window === 'undefined') return
  if (draftTimer) window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    try {
      if (text.value) localStorage.setItem(draftStorageKey.value, text.value)
      else localStorage.removeItem(draftStorageKey.value)
    } catch { /* ignore */ }
  }, 300)
}

watch(() => props.draftKey, () => { loadDraft(); nextTick(autoResize) }, { immediate: true })
watch(text, () => { saveDraft(); autoResize() })

const onBeforeUnmountClearDraft = () => {
  if (draftTimer) window.clearTimeout(draftTimer)
}
onBeforeUnmount(onBeforeUnmountClearDraft)

const onPickClick = () => {
  fileInputRef.value?.click()
}

const onFileChange = (e: Event) => {
  const files = (e.target as HTMLInputElement).files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    const cid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    emit('pickImage', file, cid)
  }
  if (fileInputRef.value) fileInputRef.value.value = ''
}

const submit = async () => {
  const v = text.value.trim()
  if (!v || sending.value) return
  sending.value = true
  try {
    emit('send', v)
    text.value = ''
    if (typeof window !== 'undefined' && props.draftKey) {
      try { localStorage.removeItem(draftStorageKey.value) } catch { /* ignore */ }
    }
    await nextTick()
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
  } finally {
    setTimeout(() => { sending.value = false }, 250)
  }
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

const onInput = (e: Event) => {
  const el = e.target as HTMLTextAreaElement
  text.value = el.value
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  emit('typing')
}

// Phase 8: emoji 选择器 - 在光标位置插入
const insertAtCursor = (emoji: string) => {
  const el = textareaRef.value
  if (!el) {
    text.value = text.value + emoji
    return
  }
  const start = el.selectionStart ?? text.value.length
  const end = el.selectionEnd ?? text.value.length
  text.value = text.value.slice(0, start) + emoji + text.value.slice(end)
  nextTick(() => {
    el.focus()
    const pos = start + emoji.length
    el.setSelectionRange(pos, pos)
  })
}

const onPickEmoji = () => {
  emojiOpen.value = !emojiOpen.value
}

const onEmojiPick = (emoji: string) => {
  insertAtCursor(emoji)
  emojiOpen.value = false
}

const onPaste = (e: ClipboardEvent) => {
  if (!e.clipboardData) return
  const items = Array.from(e.clipboardData.items)
  const images = items
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  if (images.length === 0) return
  e.preventDefault()
  for (const file of images) {
    const cid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    emit('pickImage', file, cid)
  }
}

const hasPendingImage = computed(() => (props.uploading?.length ?? 0) > 0)
</script>

<template>
  <div class="border-t bg-background p-2 sm:p-3">
    <!-- 待上传图预览条 -->
    <div
      v-if="hasPendingImage"
      class="flex items-center gap-2 mb-2 overflow-x-auto py-1"
    >
      <div
        v-for="img in uploading"
        :key="img.clientMessageId"
        class="relative shrink-0 h-16 w-16 rounded-md overflow-hidden border bg-muted"
      >
        <img :src="img.localUrl" alt="" class="w-full h-full object-cover" />
        <button
          type="button"
          class="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-background/90 text-foreground inline-flex items-center justify-center hover:bg-background"
          @click="emit('removeImage', img.clientMessageId)"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
    </div>

    <div class="flex items-end gap-1.5">
      <Button
        size="icon"
        variant="ghost"
        :title="t('chat.attachImage')"
        @click="onPickClick"
      >
        <ImagePlus class="h-4 w-4" />
      </Button>
      <div class="relative">
        <Button
          size="icon"
          variant="ghost"
          :title="t('chat.attachEmoji')"
          :class="emojiOpen ? 'bg-muted' : ''"
          @click="onPickEmoji"
        >
          <Smile class="h-4 w-4" />
        </Button>
        <ChatEmojiPanel
          v-if="emojiOpen"
          @pick="onEmojiPick"
          @close="emojiOpen = false"
        />
      </div>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        class="hidden"
        @change="onFileChange"
      />
      <textarea
        ref="textareaRef"
        data-chat-composer
        :value="text"
        :placeholder="t('chat.inputPh')"
        :disabled="sending"
        rows="1"
        class="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          disabled:opacity-60"
        :title="t('chat.enterToSend')"
        @input="onInput"
        @keydown="onKeyDown"
        @paste="onPaste"
      />
      <Button
        size="icon"
        :disabled="!text.trim() || sending"
        :title="t('chat.send')"
        @click="submit"
      >
        <Loader2 v-if="sending" class="h-4 w-4 animate-spin" />
        <Send v-else class="h-4 w-4" />
      </Button>
    </div>
  </div>
</template>
