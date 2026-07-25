/**
 * 国际化配置 —— 三语：俄语 / 乌兹别克语 / 中文
 * - 默认语言：俄语（与网页 lang="ru" 同步）
 * - 持久化：localStorage key = 'app:locale'
 */
import { createI18n } from 'vue-i18n'
import ru from '@/locales/ru'
import uz from '@/locales/uz'
import zh from '@/locales/zh'

const STORAGE_KEY = 'app:locale'
const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'ru'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: stored,
  fallbackLocale: 'ru',
  messages: { ru, uz, zh },
})

export function setLocale(lang: 'ru' | 'uz' | 'zh') {
  i18n.global.locale.value = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
}
