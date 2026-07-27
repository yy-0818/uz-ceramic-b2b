<!--
  LocaleMenu —— 语言切换下拉
  - 点击 Globe 按钮打开下拉，列出 ru / uz / zh
  - 当前选中项右侧 ✓
  - Esc / 外点关闭
  - 显示原生语言名（Русский / O'zbekcha / 中文）+ 短代码
  - z-index 用 z-50，菜单用 z-30；菜单容器 isolate 不够，
    这里直接给容器 z-50 让其浮于其他兄弟之上
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Globe, Check } from 'lucide-vue-next'
import { useI18n, setLocale, type Locale } from '@/lib/i18n'
import Button from '@/components/ui/Button.vue'

const { locale } = useI18n()

const options: Array<{ code: Locale; label: string; native: string }> = [
  { code: 'ru', label: 'RU', native: 'Русский' },
  { code: 'uz', label: 'UZ', native: "O'zbekcha" },
  { code: 'zh', label: 'ZH', native: '中文' },
]

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const toggle = () => { open.value = !open.value }
const close = () => { open.value = false }

const onPick = (code: Locale) => {
  setLocale(code)
  close()
}

const onDocClick = (e: MouseEvent) => {
  if (!open.value) return
  const target = e.target as HTMLElement
  if (root.value && !root.value.contains(target)) close()
}
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && open.value) close()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})

const current = computed(() =>
  options.find(o => o.code === locale.value) ?? options[0],
)
</script>

<template>
  <div ref="root" class="relative z-50" data-locale-menu>
    <Button
      size="sm"
      variant="ghost"
      class="h-9 px-2"
      :aria-expanded="open"
      :aria-haspopup="true"
      :title="`语言：${current.native}`"
      @click.stop="toggle"
    >
      <Globe class="h-4 w-4 sm:mr-1" />
      <span class="hidden sm:inline text-xs font-medium">{{ current.label }}</span>
    </Button>
    <div
      v-if="open"
      class="absolute right-0 top-full mt-1 w-44 bg-popover border rounded-lg shadow-lg z-50 py-1"
      role="menu"
    >
      <button
        v-for="o in options"
        :key="o.code"
        class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition text-left"
        :class="locale === o.code ? 'text-foreground font-medium' : 'text-muted-foreground'"
        role="menuitem"
        @click="onPick(o.code)"
      >
        <span class="w-7 text-xs font-mono opacity-70">{{ o.label }}</span>
        <span class="flex-1">{{ o.native }}</span>
        <Check v-if="locale === o.code" class="h-4 w-4 text-primary" />
      </button>
    </div>
  </div>
</template>