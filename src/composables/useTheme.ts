/**
 * useTheme —— 全局深色/浅色模式
 *
 * 行为：
 * - 三态：'light' | 'dark'（用户显式选择）
 * - 持久化到 localStorage（key = 'app:theme'）
 * - 首次加载：应用 stored value；无值则默认 light
 *   （如需跟随系统，可在调用 initTheme() 时改 default）
 * - 通过在 <html> 上 toggle 'dark' class 触发 main.css 中已定义好的
 *   HSL tokens 切换；整个 UI 自动适配。
 *
 * 用法：
 *   import { useTheme } from '@/composables/useTheme'
 *   const { theme, isDark, toggle, setTheme } = useTheme()
 */
import { ref, computed, watch, onMounted } from 'vue'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'app:theme'
const DEFAULT_THEME: Theme = 'light'

const theme = ref<Theme>(DEFAULT_THEME)
let initialized = false

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

export function useTheme() {
  onMounted(() => {
    if (initialized) return
    initialized = true
    const stored = readStored()
    theme.value = stored ?? DEFAULT_THEME
    applyTheme(theme.value)
  })

  watch(theme, (t) => applyTheme(t))

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