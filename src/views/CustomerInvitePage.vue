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
import { Loader2, Mail, Lock, CheckCircle2, AlertCircle } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import { useCustomerAuth, generatePlaceholderLoginEmail } from '@/composables/useCustomerAuth'
import { useStockGroups } from '@/composables/useStockGroups'
import { supabase } from '@/lib/supabase'

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
    error.value = '链接无效（缺少 token）'
    step.value = 'error'
    return
  }
  try {
    const info = await auth.validateInvite(token)
    if (!info) {
      error.value = '链接无效、已过期、或者已被使用'
      step.value = 'error'
      return
    }
    accountId.value = info.accountId
    expiresAt.value = info.expiresAt

    // 拉父账号：name + login_email（login_email 优先作为客户登录邮箱）
    const { data: parent } = await supabase
      .from('accounts')
      .select('account_name, login_email')
      .eq('id', info.accountId)
      .single()
    parentName.value = (parent as any)?.account_name ?? '主账号'
    loginEmail.value = (parent as any)?.login_email
      ?? generatePlaceholderLoginEmail(info.accountId, (parent as any)?.account_name ?? '')

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
    error.value = '密码至少 8 位'
    return
  }
  if (password.value !== passwordAgain.value) {
    error.value = '两次密码不一致'
    return
  }
  submitting.value = true
  error.value = null
  try {
    const token = (route.query.token as string) || ''
    await auth.completeInvite(token, password.value, loginEmail.value)
    // 自动登录
    await auth.signIn(loginEmail.value, password.value)
    step.value = 'done'
    // 直接跳到 /catalog（路由 / 重定向到 /catalog，绕一步没意义）
    setTimeout(() => router.push('/catalog'), 1200)
  } catch (e: any) {
    error.value = e.message ?? String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted/30 p-4">
    <Card class="w-full max-w-md">
      <CardContent class="py-8">
        <!-- 验证中 -->
        <div v-if="step === 'verify'" class="text-center space-y-3">
          <Loader2 class="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
          <p class="text-sm text-muted-foreground">验证邀请链接...</p>
        </div>

        <!-- 错误 -->
        <div v-else-if="step === 'error'" class="text-center space-y-3">
          <AlertCircle class="h-10 w-10 mx-auto text-red-500" />
          <p class="text-base font-medium">链接无效</p>
          <p class="text-sm text-muted-foreground">{{ error }}</p>
          <p class="text-xs text-muted-foreground mt-4">
            请联系你的业务对接人（管理员）重新发送邀请
          </p>
        </div>

        <!-- 设置密码 -->
        <div v-else-if="step === 'setPassword'" class="space-y-4">
          <div class="text-center space-y-1">
            <Mail class="h-8 w-8 mx-auto text-primary" />
            <p class="text-base font-semibold">欢迎，{{ parentName }}</p>
            <p class="text-xs text-muted-foreground">
              邀请有效期至 {{ new Date(expiresAt!).toLocaleString('zh-CN') }}
            </p>
          </div>

          <!-- 登录邮箱（关键提示）-->
          <div class="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs">
            <p class="font-medium text-blue-900 mb-1">您的登录邮箱：</p>
            <p class="font-mono text-blue-800 break-all">{{ loginEmail }}</p>
            <p class="text-blue-700 mt-1">请记住此邮箱，用于以后登录。</p>
          </div>

          <div v-if="assignedGroups.length > 0"
            class="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs">
            <p class="font-medium text-slate-900 mb-1">您可查看的库存组：</p>
            <div class="flex flex-wrap gap-1">
              <span v-for="g in assignedGroups" :key="g"
                class="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded">{{ g }}</span>
            </div>
          </div>

          <form @submit.prevent="submit" class="space-y-3">
            <div>
              <Label>设置密码（至少 8 位）</Label>
              <Input v-model="password" type="password" placeholder="••••••••" class="h-9" />
            </div>
            <div>
              <Label>再次输入</Label>
              <Input v-model="passwordAgain" type="password" placeholder="••••••••" class="h-9" />
            </div>
            <div v-if="error" class="text-xs text-red-600">{{ error }}</div>
            <Button type="submit" class="w-full" :disabled="submitting">
              <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
              <Lock v-else class="mr-2 h-4 w-4" />
              设置密码并登录
            </Button>
          </form>
        </div>

        <!-- 完成 -->
        <div v-else-if="step === 'done'" class="text-center space-y-3">
          <CheckCircle2 class="h-10 w-10 mx-auto text-emerald-500" />
          <p class="text-base font-medium">账号已激活</p>
          <p class="text-sm text-muted-foreground">正在跳转到商品目录...</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>