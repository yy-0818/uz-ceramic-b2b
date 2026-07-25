import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n } from './lib/i18n'
import { registerPermissionDirective } from './directives/permission'

import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
registerPermissionDirective(app)
app.mount('#app')
