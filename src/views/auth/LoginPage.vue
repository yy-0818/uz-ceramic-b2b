<!--
  src/views/auth/LoginPage.vue
  移动端优先登录页（Phase 2 最终版）
-->
<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Loader2, LockKeyhole, Mail, Factory } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import { bootstrapError } from '@/lib/supabase'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import { useAuth } from '@/composables/useAuth'
import { setLocale } from '@/lib/i18n'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const { signIn } = useAuth()

const form = reactive({ email: '', password: '' })
const submitting = ref(false)
const errorMsg = ref<string | null>(null)

const canSubmit = computed(
  () => /\S+@\S+\.\S+/.test(form.email) && form.password.length >= 6,
)

const onSubmit = async () => {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  errorMsg.value = null
  try {
    await signIn(form.email.trim(), form.password)
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(t('auth.login'))
  } finally {
    submitting.value = false
  }
}

const switchLang = (lang: 'ru' | 'uz' | 'zh') => setLocale(lang)
</script>

<template>
  <main
    class="min-h-dvh w-full flex items-center justify-center
           bg-gradient-to-br from-slate-50 via-white to-slate-100
           dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4"
  >
    <div class="w-full max-w-md">
      <header class="flex flex-col items-center mb-6 select-none">
        <div class="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3 shadow-sm">
          <Factory class="h-7 w-7" />
        </div>
        <h1 class="text-xl font-semibold tracking-tight">{{ t('auth.brand') }}</h1>
        <p class="text-sm text-muted-foreground mt-1">{{ t('auth.welcome') }}</p>
      </header>

      <Card class="border-border/60 shadow-xl shadow-slate-200/40 dark:shadow-black/40">
        <CardHeader class="space-y-1 pb-2">
          <CardTitle class="text-lg">{{ t('auth.loginTitle') }}</CardTitle>
          <CardDescription>{{ t('auth.loginDesc') }}</CardDescription>
        </CardHeader>

        <CardContent>
          <form @submit.prevent="onSubmit" class="space-y-4" novalidate>
            <div class="space-y-2">
              <Label for="email">{{ t('auth.email') }}</Label>
              <div class="relative">
                <Mail class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  v-model="form.email"
                  type="email"
                  inputmode="email"
                  autocomplete="email"
                  :placeholder="t('auth.emailPh')"
                  class="pl-9 h-11 text-base"
                  required
                />
              </div>
            </div>

            <div class="space-y-2">
              <Label for="password">{{ t('auth.password') }}</Label>
              <div class="relative">
                <LockKeyhole class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  v-model="form.password"
                  type="password"
                  autocomplete="current-password"
                  :placeholder="t('auth.passwordPh')"
                  class="pl-9 h-11 text-base"
                  required
                />
              </div>
            </div>

            <p
              v-if="bootstrapError"
              class="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2"
              role="alert"
            >
              {{ bootstrapError }}
            </p>

            <p
              v-if="errorMsg"
              class="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2"
              role="alert"
            >
              {{ errorMsg }}
            </p>

            <Button type="submit" class="w-full h-11 text-base font-medium" :disabled="!canSubmit || submitting || !!bootstrapError">
              <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
              {{ submitting ? t('auth.logging') : t('auth.login') }}
            </Button>
          </form>

          <div class="mt-6 flex items-center justify-center gap-2 text-xs">
            <button
              type="button"
              class="px-2 py-1 rounded-md hover:bg-muted transition"
              :class="locale === 'ru' ? 'text-primary font-semibold' : 'text-muted-foreground'"
              @click="switchLang('ru')"
            >
              Русский
            </button>
            <span class="text-muted-foreground/40">|</span>
            <button
              type="button"
              class="px-2 py-1 rounded-md hover:bg-muted transition"
              :class="locale === 'uz' ? 'text-primary font-semibold' : 'text-muted-foreground'"
              @click="switchLang('uz')"
            >
              O'zbekcha
            </button>
            <span class="text-muted-foreground/40">|</span>
            <button
              type="button"
              class="px-2 py-1 rounded-md hover:bg-muted transition"
              :class="locale === 'zh' ? 'text-primary font-semibold' : 'text-muted-foreground'"
              @click="switchLang('zh')"
            >
              中文
            </button>
          </div>
        </CardContent>
      </Card>

      <p class="text-center text-xs text-muted-foreground mt-6">
        © {{ new Date().getFullYear() }} · {{ t('auth.copyright') }}
      </p>
    </div>
  </main>
</template>
