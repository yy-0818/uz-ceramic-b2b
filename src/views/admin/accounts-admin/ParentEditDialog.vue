<!--
  src/views/admin/accounts-admin/ParentEditDialog.vue
  新建 / 编辑主账号（父）对话框 —— 纯表单组件
  父级用法：
    <ParentEditDialog v-model:open="open" :target="target" ref="dialogRef" @success="onSuccess" />
    const form = dialogRef.form   // 验证通过后拿到表单
    await acc.createParent({ account_name: form.account_name, ... })
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Dialog from '@/components/ui/Dialog.vue'

import type { Account, AccountType } from '@/composables/useAccounts'

const props = defineProps<{
  open: boolean
  target: Account | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submit', payload: { form: { account_name: string; account_type: AccountType; login_email: string } }): void
}>()

const accountTypes: Array<{ value: AccountType; label: string; desc: string }> = [
  { value: '1_public', label: '1 公户', desc: '对公大客户' },
  { value: '2_cash', label: '2 现金', desc: '现金客户' },
  { value: '3_export', label: '3 出口', desc: '出口客户' },
]

// 编辑模式下也保留账户原类型；新建则使用默认值
const form = ref({
  account_name: '',
  account_type: '1_public' as AccountType,
  login_email: '',
})
const errorMsg = ref<string | null>(null)

watch(
  () => [props.open, props.target?.id] as const,
  ([isOpen, _id]) => {
    if (!isOpen) return
    errorMsg.value = null
    const t = props.target
    if (t) {
      form.value = {
        account_name: t.account_name,
        account_type: t.account_type,
        login_email: (t as any).login_email ?? '',
      }
    } else {
      form.value = { account_name: '', account_type: '1_public', login_email: '' }
    }
  },
  { immediate: true },
)

const validate = (): boolean => {
  if (!form.value.account_name) {
    errorMsg.value = '请填写主账号名'
    return false
  }
  if (form.value.login_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.login_email)) {
    errorMsg.value = '登录邮箱格式不正确'
    return false
  }
  errorMsg.value = null
  return true
}

const onSubmit = () => {
  if (!validate()) return
  emit('submit', { form: { ...form.value } })
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="target ? `编辑主账号：${target.account_name}` : '新建主账号'"
    description="主账号对应客户分类，所有子账号共享此主账号的白名单"
  >
    <form class="space-y-3" @submit.prevent="onSubmit">
      <div>
        <Label>主账号名 *</Label>
        <Input v-model="form.account_name" placeholder="例如：贾汉 / I客户 / W客户" class="h-9" />
      </div>
      <div>
        <Label>
          客户登录邮箱
          <span class="text-xs text-muted-foreground">（邀请时使用，留空自动生成占位邮箱）</span>
        </Label>
        <Input v-model="form.login_email" type="email" placeholder="customer@example.com" class="h-9" />
      </div>
      <div>
        <Label>
          类型
          <span class="text-xs text-muted-foreground">（新建时设置；编辑时锁定不可改）</span>
        </Label>
        <div class="grid grid-cols-3 gap-2 mt-1">
          <button
            v-for="t in accountTypes"
            :key="t.value"
            type="button"
            :disabled="!!target"
            class="border rounded-md px-2 py-2 text-sm transition text-left disabled:cursor-not-allowed"
            :class="[
              form.account_type === t.value
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : target
                  ? 'opacity-50'
                  : 'hover:bg-muted',
            ]"
            @click="form.account_type = t.value"
          >
            <p class="font-medium">{{ t.label }}</p>
            <p class="text-xs text-muted-foreground">{{ t.desc }}</p>
          </button>
        </div>
      </div>
      <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>
      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button type="submit" :disabled="loading">
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          {{ target ? '保存' : '创建' }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
