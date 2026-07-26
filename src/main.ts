import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n, useI18n, setLocale } from './lib/i18n'
import { registerPermissionDirective } from './directives/permission'

import './assets/main.css'

const app = createApp(App)

app.config.globalProperties.$t = i18n.global.t
app.config.globalProperties.$i18n = i18n
app.config.globalProperties.$setLocale = setLocale
app.config.globalProperties.$useI18n = useI18n

app.use(createPinia())
app.use(router)
registerPermissionDirective(app)

app.mount('#app')