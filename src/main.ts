import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n, useI18n, setLocale } from './lib/i18n'
import { initSentry } from './lib/sentry'
import { initTheme } from './composables/useTheme'
import { registerPermissionDirective } from './directives/permission'

import './assets/main.css'

// 同步初始化主题：必须在 mount 前，避免首屏白闪
initTheme()

const app = createApp(App)

// Sentry 必须在最早错误可能产生前初始化（接住模块顶层 throw）
initSentry({ app, router })

app.config.globalProperties.$t = i18n.global.t
app.config.globalProperties.$i18n = i18n
app.config.globalProperties.$setLocale = setLocale
app.config.globalProperties.$useI18n = useI18n

app.use(createPinia())
app.use(router)
registerPermissionDirective(app)

app.mount('#app')

// PWA: 注册 service worker（仅生产 + 浏览器支持）
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((e) => {
        // 不要 throw — PWA 是可选的，失败也不影响主业务
        console.warn('[pwa] sw register failed', e)
      })
  })
}