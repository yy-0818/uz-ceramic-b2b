/**
 * useTheme —— 全局深色/浅色模式
 *
 * 行为：
 * - 三态：'light' | 'dark'（用户显式选择）
 * - 持久化到 localStorage（key = 'app:theme'）
 * - 首次加载由 main.ts 调用 initTheme()（在 Vue 挂载前同步执行，避免 FOUC）
 *   后续所有组件共享同一个 module-level ref，无需重复 onMounted
 * - 通过在 <html> 上 toggle 'dark' class 触发 main.css 中已定义好的
 *   HSL tokens 切换；整个 UI 自动适配。
 *
 * 用法（仅在需要响应式主题状态时调用，ThemeToggle 需初始化，其他组件按需）：
 *   import { useTheme } from '@/composables/useTheme'
 *   const { theme, isDark, toggle, setTheme } = useTheme()
 */
import { ref, computed, watch } from 'vue'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'app:theme'
const DEFAULT_THEME: Theme = 'light'

const theme = ref<Theme>(DEFAULT_THEME)

function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  root.style.colorScheme = t
}

function readStored(): Theme | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

function persist(t: Theme) {
  try { localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
}

// 所有使用 useTheme() 的组件共享同一个 watcher
watch(theme, (t) => applyTheme(t))

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')

  const setTheme = (t: Theme) => {
    theme.value = t
    persist(t)
  }

  const toggle = () => setTheme(theme.value === 'dark' ? 'light' : 'dark')

  return { theme, isDark, setTheme, toggle }
}

/** 供 main.ts 在挂载前同步初始化，避免页面 FOUC（白闪） */
export function initTheme() {
  if (typeof document === 'undefined') return
  const stored = readStored()
  const t = stored ?? DEFAULT_THEME
  theme.value = t
  applyTheme(t)
}