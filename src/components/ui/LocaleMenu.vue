<!--
  LocaleMenu —— 语言切换下拉

  修复：原实现使用 `absolute right-0 top-full` 挂在 wrapper 内，
  会受三个层叠上下文父级干扰：
    1. <header class="sticky top-0 z-10 h-14"> 的 sticky 上下文
       把 z-50 限制在 header 之内，画布层级被卡死
    2. backdrop-blur 触发单独 stacking context，进一步干扰
    3. v-if 导致的菜单 DOM 可能在 button 视觉位置之外

  新实现：
    - 菜单用 position: fixed，方向跟随 trigger 元素
    - 用 getBoundingClientRect() 算坐标，不依赖任何父级布局
    - 视口空间不足时自动翻转（向上/向左/向右）
    - 滚动或 resize 时保持位置不变（fixed 天然跟随），
      关闭菜单避免视觉错位
    - z-index 用 z-[60]，确保凌驾 header(z-10)、Drawer(z-50)
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
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
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const MENU_W = 176 // 与 class="w-44" 保持一致 (tailwind w-44 = 11rem = 176px)

// fixed 定位坐标（left/top 写入 style）
const menuStyle = ref<Record<string, string>>({})

const current = computed(() =>
  options.find(o => o.code === locale.value) ?? options[0],
)

const recompute = async () => {
  if (!trigger.value) return
  await nextTick()
  const r = trigger.value.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 用菜单实测高度（首次测量为 0 用估算）
  const mh = menu.value?.offsetHeight ?? 140

  // 水平：右对齐到 trigger 右边，留 8px 距离
  // 若 trigger 离右边 8px 内放不下 176px 宽，则改为左对齐
  const gap = 8
  let left = r.right - MENU_W
  if (left < 8) left = r.left // 右放不下时贴左边
  // 还放不下就压到视口里
  if (left + MENU_W > vw - 8) left = Math.max(8, vw - MENU_W - 8)

  // 垂直：默认在 trigger 下方 8px；若下方空间不足就翻到上方
  let top = r.bottom + gap
  const below = vh - r.bottom
  const above = r.top
  if (below < mh + 16 && above > below) {
    // 上方空间更大 → 翻到 trigger 上方
    top = r.top - mh - gap
  }

  menuStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${MENU_W}px`,
  }
}

const toggle = async () => {
  open.value = !open.value
  if (open.value) await recompute()
}
const close = () => {
  open.value = false
}

const onPick = (code: Locale) => {
  setLocale(code)
  close()
}

const onDocClick = (e: MouseEvent) => {
  if (!open.value) return
  const target = e.target as Node | null
  if (!target) return
  // 菜单内或 trigger 内点击忽略；其它都关闭
  if (root.value?.contains(target)) return
  if (menu.value?.contains(target)) return
  close()
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && open.value) close()
}

// 滚动 / resize 时直接关菜单——fixed 跟随视口，菜单的坐标要重算，
// 但重算的成本 vs. 用户感知错位 → 简单关闭更可靠
const onScrollOrResize = () => { if (open.value) close() }

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})

// 语言切换可能改图标旁的 RU/UZ/ZH → trigger 宽度变化，重新定位
watch(current, () => {
  if (open.value) recompute()
})
</script>

<template>
  <div ref="root" class="relative inline-flex" data-locale-menu>
    <Button
      ref="trigger"
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
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        :style="menuStyle"
        class="z-[60] bg-popover border rounded-lg shadow-lg py-1"
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
    </Teleport>
  </div>
</template>
