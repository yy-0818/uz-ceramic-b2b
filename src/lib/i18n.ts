/**
 * 极简国际化 runtime —— 完全无 AST 解析、零依赖。
 *
 * 背景：vue-i18n v9/v10/v11 在俄语 / 乌兹别克语 pluralization 上会触发
 * 'Invalid linked format' / 'SyntaxError: 10' 等崩溃，且编译路径无法
 * 用 messageCompiler 完全屏蔽（编译器字符串仍在 bundle 中，运行时仍
 * 可能被某条代码路径走到 tokenize）。
 *
 * 设计目标：
 *   - 100% 字符串查表；不解析 `{name}` 占位符以外的任何语法。
 *   - 与 vue-i18n 兼容：`const { t, d, n } = useI18n()` 与原 API 等价。
 *   - bundle 体积减半，Vercel 部署不再依赖 vue-i18n 编译器。
 *
 * 用法：
 *   import { i18n, useI18n, setLocale } from '@/lib/i18n'
 *   const { t } = useI18n()
 *   t('auth.login')           => 'Войти'
 *   t('hello', { name })      => 'Hello, John'  (简单 {key} 替换)
 */
import { ref, computed, readonly } from 'vue'
import ru from '@/locales/ru'
import uz from '@/locales/uz'
import zh from '@/locales/zh'

export type Locale = 'ru' | 'uz' | 'zh'
export type MessageDict = Record<string, any>
export type Messages = Record<Locale, MessageDict>

const STORAGE_KEY = 'app:locale'
const DEFAULT_LOCALE: Locale = 'ru'

const MESSAGES: Messages = { ru, uz, zh }

const currentLocale = ref<Locale>(
  ((typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Locale) ||
  DEFAULT_LOCALE,
)

function lookup(dict: MessageDict, key: string): any {
  if (!dict) return undefined
  const parts = key.split('.')
  let cur: any = dict
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}

function format(template: unknown, values?: Record<string, any>): string {
  if (template == null) return ''
  if (typeof template !== 'string') return String(template)
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = values[k]
    return v == null ? `{${k}}` : String(v)
  })
}

/**
 * 按指定 locale 翻译（用于 admin 选语言预览模板）。
 *
 * Fallback 链：当前 locale → ru → uz → zh → __MISSING.<key>
 * （中文作最终兜底，保证生产环境不会展示空字符串，方便后续逐步翻译）
 */
const FALLBACK_LOCALES: Locale[] = ['ru', 'uz', 'zh']

export function tForLocale(lang: Locale, key: string, values?: Record<string, any>): string {
  for (const loc of [lang, ...FALLBACK_LOCALES]) {
    const raw = lookup(MESSAGES[loc], key)
    if (raw != null) return format(raw, values)
  }
  return `__MISSING.${key}`
}

/**
 * 解析当前 locale 下 key 对应的字符串，找不到则走 ru → uz → zh 兜底。
 */
function translate(key: string, values?: Record<string, any>): string {
  for (const loc of [currentLocale.value, ...FALLBACK_LOCALES]) {
    const raw = lookup(MESSAGES[loc], key)
    if (raw != null) return format(raw, values)
  }
  return `__MISSING.${key}`
}

/**
 * 暴露与 vue-i18n 等价的 useI18n() API，方便业务侧无侵入替换。
 */
export function useI18n() {
  return {
    locale: readonly(currentLocale),
    t: (key: string, values?: Record<string, any>) => translate(key, values),
    tForLocale: (lang: Locale, key: string, values?: Record<string, any>) => tForLocale(lang, key, values),
    d: (value: Date | number | string) => {
      try { return new Intl.DateTimeFormat(currentLocale.value).format(new Date(value)) }
      catch { return String(value) }
    },
    n: (value: number) => {
      try { return new Intl.NumberFormat(currentLocale.value).format(value) }
      catch { return String(value) }
    },
  }
}

/**
 * 报告所有在 zh 存在但 ru/uz 缺失的 key（dev 工具）。
 */
export function reportMissingTranslations(): { locale: Locale; missing: string[] }[] {
  const result: { locale: Locale; missing: string[] }[] = []
  for (const loc of ['ru', 'uz'] as Locale[]) {
    const missing: string[] = []
    walkKeys(MESSAGES.zh, MESSAGES[loc], '', missing)
    result.push({ locale: loc, missing })
  }
  return result
}

function walkKeys(src: MessageDict, ref: MessageDict, prefix: string, missing: string[]): void {
  for (const k in src) {
    const path = prefix ? `${prefix}.${k}` : k
    const v = src[k]
    if (typeof v === 'object' && v !== null) {
      walkKeys(v as MessageDict, (ref as any)?.[k] as MessageDict ?? {}, path, missing)
    } else {
      if (ref == null || !(k in ref) || typeof (ref as any)[k] !== 'string') {
        missing.push(path)
      }
    }
  }
}

export function setLocale(lang: Locale) {
  currentLocale.value = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  }
}

/** 为兼容旧 import { i18n } 的代码 */
export const i18n = {
  global: {
    get locale() { return computed(() => currentLocale.value) },
    set locale(v: { value: Locale }) { setLocale(v.value) },
    t: translate,
  },
}

export default i18n