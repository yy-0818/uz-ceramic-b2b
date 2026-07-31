<!--
  src/views/CustomerInvitePage.vue
  公开页面：客户点邀请链接进来设置密码、激活账号
  URL: /customer-invite?token=...
  - 不需要 admin 登录
  - 验证 token → 选密码 → 自动登录
  - 客户登录邮箱从 accounts.login_email 读（admin 在邀请前应已填好）
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Loader2, Mail, Lock, CheckCircle2, AlertCircle, UserCheck, ArrowLeft } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import { useCustomerAuth } from '@/composables/useCustomerAuth'
import { useStockGroups } from '@/composables/useStockGroups'
import { useI18n } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useCustomerAuth()
const stockGroups = useStockGroups()

const step = ref<'verify' | 'setPassword' | 'done' | 'error'>('verify')
const error = ref<string | null>(null)
const accountId = ref<string | null>(null)
const parentName = ref<string | null>(null)
const loginEmail = ref<string | null>(null)
const expiresAt = ref<string | null>(null)
const password = ref('')
const passwordAgain = ref('')
const submitting = ref(false)
const assignedGroups = ref<string[]>([])

onMounted(async () => {
  const token = (route.query.token as string) || ''
  if (!token) {
    error.value = t('invite.errNoToken')
    step.value = 'error'
    return
  }
  try {
    const info = await auth.validateInvite(token)
    if (!info) {
      error.value = t('invite.errInvalidOrExpired')
      step.value = 'error'
      return
    }
    accountId.value = info.accountId
    expiresAt.value = info.expiresAt

    const { data: parent } = await supabase
      .from('accounts')
      .select('account_name, login_email')
      .eq('id', info.accountId)
      .single()
    parentName.value = (parent as any)?.account_name ?? t('invite.parentFallback')
    loginEmail.value = (parent as any)?.login_email?.trim() ?? ''
    if (!loginEmail.value) {
      error.value = t('invite.errNoLoginEmail')
      step.value = 'error'
      return
    }

    assignedGroups.value = await stockGroups.fetchAssignedForParent(info.accountId)
    step.value = 'setPassword'
  } catch (e: any) {
    error.value = e.message ?? String(e)
    step.value = 'error'
  }
})

const submit = async () => {
  if (!accountId.value || !loginEmail.value) return
  if (password.value.length < 8) {
    error.value = t('invite.errPasswordShort')
    return
  }
  if (password.value !== passwordAgain.value) {
    error.value = t('invite.errPasswordMismatch')
    return
  }
  submitting.value = true
  error.value = null
  try {
    const token = (route.query.token as string) || ''
    await auth.completeInvite(token, password.value, loginEmail.value)
    await auth.signIn(loginEmail.value, password.value)
    step.value = 'done'
    setTimeout(() => router.push('/catalog'), 1200)
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    submitting.value = false
  }
}

const goBack = () => {
  if (window.history.state && (window.history.state as any).back) router.back()
  else router.push('/')
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
    <!-- 顶部 hero（固定宽度，居中） -->
    <div class="w-full max-w-md mb-4">
      <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.06] via-white to-background px-6 py-5 text-center">
        <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
        <div class="pointer-events-none absolute -left-6 bottom-0 h-20 w-20 rounded-full bg-primary/5" />
        <div class="relative flex flex-col items-center">
          <div class="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-2">
            <UserCheck class="h-6 w-6" />
          </div>
          <h1 class="text-lg font-bold">客户账号激活</h1>
          <p class="text-xs text-muted-foreground mt-0.5">设置密码以激活您的客户账号</p>
        </div>
      </header>
    </div>

    <Card class="w-full max-w-md">
      <CardContent class="py-8">
        <!-- 验证中 -->
        <div v-if="step === 'verify'" class="text-center space-y-3">
          <Loader2 class="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
          <p class="text-sm text-muted-foreground">{{ t('invite.verifying') }}</p>
        </div>

        <!-- 错误 -->
        <div v-else-if="step === 'error'" class="text-center space-y-3">
          <div class="h-14 w-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
            <AlertCircle class="h-7 w-7" />
          </div>
          <p class="text-base font-semibold">{{ t('invite.invalidLink') }}</p>
          <p class="text-sm text-muted-foreground">{{ error }}</p>
          <Button variant="outline" class="mt-2" @click="goBack">
            <ArrowLeft class="h-3.5 w-3.5 mr-1" />
            返回登录
          </Button>
          <p class="text-xs text-muted-foreground mt-4">
            {{ t('invite.invalidLinkHint') }}
          </p>
        </div>

        <!-- 设置密码 -->
        <div v-else-if="step === 'setPassword'" class="space-y-4">
          <div class="text-center space-y-1 pb-2">
            <Mail class="h-7 w-7 mx-auto text-primary" />
            <p class="text-base font-semibold">{{ t('invite.welcome', { name: parentName }) }}</p>
            <p class="text-[11px] text-muted-foreground">
              {{ t('invite.expiresAt', { date: new Date(expiresAt!).toLocaleString('zh-CN') }) }}
            </p>
          </div>

          <!-- 登录邮箱 -->
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
            <p class="font-semibold text-blue-900 mb-0.5">{{ t('invite.loginEmail') }}</p>
            <p class="font-mono text-blue-800 break-all">{{ loginEmail }}</p>
            <p class="text-blue-700 mt-1 leading-relaxed">{{ t('invite.loginEmailHint') }}</p>
          </div>

          <!-- 分配的库存组 -->
          <div v-if="assignedGroups.length > 0" class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
            <p class="font-semibold text-slate-900 mb-1.5">{{ t('invite.assignedGroups') }}</p>
            <div class="flex flex-wrap gap-1">
              <span v-for="g in assignedGroups" :key="g"
                class="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-mono text-[11px]">{{ g }}</span>
            </div>
          </div>

          <form @submit.prevent="submit" class="space-y-3">
            <div class="space-y-1.5">
              <Label class="text-xs">{{ t('invite.passwordLabel') }}</Label>
              <Input v-model="password" type="password" placeholder="最少 8 位" class="h-9" />
            </div>
            <div class="space-y-1.5">
              <Label class="text-xs">{{ t('invite.passwordAgain') }}</Label>
              <Input v-model="passwordAgain" type="password" placeholder="再次输入密码" class="h-9" />
            </div>
            <div v-if="error" class="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
              {{ error }}
            </div>
            <Button type="submit" class="w-full shadow-md shadow-primary/20" :disabled="submitting">
              <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
              <Lock v-else class="mr-2 h-4 w-4" />
              {{ t('invite.submitBtn') }}
            </Button>
          </form>
        </div>

        <!-- 完成 -->
        <div v-else-if="step === 'done'" class="text-center space-y-3">
          <div class="h-14 w-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 class="h-7 w-7" />
          </div>
          <p class="text-base font-semibold">{{ t('invite.activated') }}</p>
          <p class="text-sm text-muted-foreground">{{ t('invite.redirecting') }}</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>