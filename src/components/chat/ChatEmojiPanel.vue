<!--
  ChatEmojiPanel —— 轻量 emoji 选择面板
  - 常用 (最近用过 + 高频)
  - 表情
  - 符号
  不引入 emoji-mart / @emoji-mart/vue, 自己分类内置.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()

const RECENT_KEY = 'chat:emoji-recent'
const RECENT_MAX = 24

const recent = ref<string[]>([])

const loadRecent = () => {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw) recent.value = JSON.parse(raw) ?? []
  } catch { recent.value = [] }
}

const addRecent = (emoji: string) => {
  const next = [emoji, ...recent.value.filter((e) => e !== emoji)].slice(0, RECENT_MAX)
  recent.value = next
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

if (typeof window !== 'undefined') loadRecent()

const emit = defineEmits<{
  pick: [emoji: string]
  close: []
}>()

const onPick = (emoji: string) => {
  addRecent(emoji)
  emit('pick', emoji)
}

// 内置分类 (Unicode emoji)
const CATS: Array<{ id: 'recent' | 'smile' | 'hand' | 'symbol' | 'object'; label: string; list: string[] }> = [
  {
    id: 'smile',
    label: '😀',
    list: [
      '😀','😁','😂','🤣','😊','😍','🥰','😘','😎','😉',
      '😋','😜','🤪','🤩','🥳','🤔','🤨','😐','😶','🙄',
      '😏','😬','😮','😴','😪','🤤','😢','😭','😱','😡',
      '😤','🤯','🥺','😇','🤓','🧐','😈','👻','💀','🤡',
    ],
  },
  {
    id: 'hand',
    label: '👍',
    list: [
      '👍','👎','👏','🙌','🙏','🤝','💪','✌️','🤞','👌',
      '🤘','🤙','👈','👉','👆','👇','✋','🖐️','🖖','👋',
      '🤚','🫶','🫰','🫵','🤲','💅','💃','🕺','🤳','💁',
    ],
  },
  {
    id: 'symbol',
    label: '❤',
    list: [
      '❤','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '✨','⭐','🌟','💫','🔥','💥','💢','💯','💤','💨',
      '🎉','🎊','🎁','🎂','🍾','🍻','☕','🍕','🚀','✅',
      '❌','⚠','❓','❗','💬','📌','📎','🔔','🔕','📞',
    ],
  },
  {
    id: 'object',
    label: '📦',
    list: [
      '📦','📋','📄','📊','📈','📉','💰','💵','💴','💶',
      '💷','💳','🏷','🛒','🛍','🧾','📅','⏰','⏳','🔒',
      '🔓','🔑','🗝','⚙','🛠','🧰','🔧','🔨','📱','💻',
    ],
  },
]

const cat = ref<'recent' | 'smile' | 'hand' | 'symbol' | 'object'>('smile')

const list = computed<string[]>(() => {
  if (cat.value === 'recent') return recent.value
  return CATS.find((c) => c.id === cat.value)?.list ?? []
})

// 检测在外点击关闭
const rootRef = ref<HTMLElement | null>(null)
const onDocClick = (e: MouseEvent) => {
  if (!rootRef.value) return
  if (!rootRef.value.contains(e.target as Node)) emit('close')
}
watch(() => rootRef.value, (el) => {
  if (!el || typeof window === 'undefined') return
  // 下一帧挂载
  setTimeout(() => document.addEventListener('mousedown', onDocClick), 0)
  return () => document.removeEventListener('mousedown', onDocClick)
}, { flush: 'post' })
</script>

<template>
  <div
    ref="rootRef"
    class="absolute bottom-full mb-1 left-0 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-card shadow-xl overflow-hidden"
  >
    <div class="flex items-center gap-1 p-1 border-b bg-muted/40">
      <button
        type="button"
        class="flex-1 h-7 rounded-md text-xs transition flex items-center justify-center"
        :class="cat === 'recent' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
        :disabled="recent.length === 0"
        @click="cat = 'recent'"
      >
        🕘
      </button>
      <button
        v-for="c in CATS"
        :key="c.id"
        type="button"
        class="flex-1 h-7 rounded-md text-xs transition flex items-center justify-center"
        :class="cat === c.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
        @click="cat = c.id"
      >
        {{ c.label }}
      </button>
    </div>
    <div class="p-2 h-48 overflow-y-auto">
      <div v-if="list.length === 0" class="text-xs text-muted-foreground text-center py-6">
        {{ t('chat.emojiEmpty') }}
      </div>
      <div v-else class="grid grid-cols-8 gap-0.5">
        <button
          v-for="(e, i) in list"
          :key="`${cat}-${i}-${e}`"
          type="button"
          class="h-8 w-8 rounded-md text-lg hover:bg-muted transition flex items-center justify-center"
          @click="onPick(e)"
        >
          {{ e }}
        </button>
      </div>
    </div>
  </div>
</template>