import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n, useI18n, setLocale } from './lib/i18n'
import { initTheme } from './composables/useTheme'
import { registerPermissionDirective } from './directives/permission'

import './assets/main.css'

// 同步初始化主题：必须在 mount 前，避免首屏白闪
initTheme()

const app = createApp(App)

app.config.globalProperties.$t = i18n.global.t
app.config.globalProperties.$i18n = i18n
app.config.globalProperties.$setLocale = setLocale
app.config.globalProperties.$useI18n = useI18n

app.use(createPinia())
app.use(router)
registerPermissionDirective(app)

app.mount('#app')