<!--
  src/views/SettingsPage.vue
  通用设置页（员工 + 客户通用）
  当前功能：
    - 修改自己的密码（三个密码字段）
  设计原则：
    - 通用入口：未来加更多"账户设置"（手机号、通知偏好等）也在这里
    - 不限角色：登录即可访问
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { Loader2, KeyRound, Eye, EyeOff } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'

import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'

const { t } = useI18n()

const currentPwd = ref('')
const newPwd = ref('')
const newPwd2 = ref('')
const showPwd = ref(false)
const submitting = ref(false)
const errorMsg = ref<string | null>(null)
const successMsg = ref<string | null>(null)

const newPwdStrength = computed(() => {
  const p = newPwd.value
  if (!p) return { score: 0, label: '' }
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/\d/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  const labels = ['', '太弱', '弱', '一般', '强', '很强']
  return { score, label: labels[Math.min(score, labels.length - 1)] }
})

const newPwdStrengthColor = computed(() => {
  const s = newPwdStrength.value.score
  if (s <= 1) return 'bg-red-500'
  if (s <= 2) return 'bg-orange-500'
  if (s <= 3) return 'bg-yellow-500'
  return 'bg-emerald-500'
})

const canSubmit = computed(() => {
  return (
    !submitting.value &&
    currentPwd.value.length > 0 &&
    newPwd.value.length >= 8 &&
    newPwd.value === newPwd2.value &&
    currentPwd.value !== newPwd.value
  )
})

const reset = () => {
  currentPwd.value = ''
  newPwd.value = ''
  newPwd2.value = ''
  showPwd.value = false
  errorMsg.value = null
  successMsg.value = null
}

const onSubmit = async () => {
  errorMsg.value = null
  successMsg.value = null
  if (!canSubmit.value) {
    if (newPwd.value.length < 8) errorMsg.value = '新密码长度至少 8 位'
    else if (newPwd.value !== newPwd2.value) errorMsg.value = '两次输入的新密码不一致'
    else if (currentPwd.value === newPwd.value) errorMsg.value = '新密码不能与旧密码相同'
    return
  }
  submitting.value = true
  try {
    const fnUrl = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined)?.trim()
    if (!fnUrl) {
      throw new Error('修改密码功能未启用（缺 VITE_SUPABASE_FUNCTIONS_URL）')
    }
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('需要登录')
    }
    const res = await fetch(`${fnUrl}/change-own-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        current_password: currentPwd.value,
        new_password: newPwd.value,
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || '修改失败')
    }
    successMsg.value = '密码修改成功'
    reset()
  } catch (e: any) {
    errorMsg.value = e?.message ?? String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
    <h1 class="text-2xl font-semibold">账户设置</h1>

    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <KeyRound class="h-4 w-4" />
          修改密码
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form class="space-y-3" @submit.prevent="onSubmit">
          <div>
            <Label for="current-pwd">当前密码 *</Label>
            <div class="relative">
              <Input
                id="current-pwd"
                v-model="currentPwd"
                :type="showPwd ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="请输入当前密码"
                class="h-9 pr-10"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                :aria-label="showPwd ? '隐藏密码' : '显示密码'"
                @click="showPwd = !showPwd"
              >
                <component :is="showPwd ? EyeOff : Eye" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div>
            <Label for="new-pwd">
              新密码 *
              <span class="text-xs text-muted-foreground">（≥8 位）</span>
            </Label>
            <div class="relative">
              <Input
                id="new-pwd"
                v-model="newPwd"
                :type="showPwd ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="请输入新密码"
                class="h-9 pr-10"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                :aria-label="showPwd ? '隐藏密码' : '显示密码'"
                @click="showPwd = !showPwd"
              >
                <component :is="showPwd ? EyeOff : Eye" class="h-3.5 w-3.5" />
              </button>
            </div>
            <div v-if="newPwd" class="mt-1.5 flex items-center gap-2">
              <div class="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full transition-all"
                  :class="newPwdStrengthColor"
                  :style="{ width: `${(newPwdStrength.score / 4) * 100}%` }"
                />
              </div>
              <span class="text-xs text-muted-foreground shrink-0">{{ newPwdStrength.label }}</span>
            </div>
          </div>

          <div>
            <Label for="new-pwd2">确认新密码 *</Label>
            <Input
              id="new-pwd2"
              v-model="newPwd2"
              :type="showPwd ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="再次输入新密码"
              class="h-9"
            />
            <p v-if="newPwd2 && newPwd !== newPwd2" class="text-xs text-destructive mt-1">两次输入不一致</p>
          </div>

          <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>
          <p v-if="successMsg" class="text-xs text-emerald-600">{{ successMsg }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" @click="reset">重置</Button>
            <Button type="submit" :disabled="!canSubmit">
              <Loader2 v-if="submitting" class="mr-2 h-4 w-4 animate-spin" />
              修改密码
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
