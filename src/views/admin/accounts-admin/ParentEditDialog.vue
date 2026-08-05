<!--
  src/views/admin/accounts-admin/ParentEditDialog.vue
  新建 / 编辑主账号（父）对话框 —— 纯表单组件
  父级用法：
    <ParentEditDialog v-model:open="open" :target="target" :loading="loading" @submit="onSubmit" />
  说明:
    主账号是管理账号, 不参与直接下单. 1公户/2现金/3出口 类别由子账号 (SubEditDialog) 决定.
    所以本对话框不含 "类型" 字段.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2 } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Dialog from '@/components/ui/Dialog.vue'

import type { Account } from '@/composables/useAccounts'

const props = defineProps<{
  open: boolean
  target: Account | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submit', payload: { form: { account_name: string; login_email: string } }): void
}>()

// 表单只保留主账号名 + 客户登录邮箱
// account_type 由子账号决定, 不在主账号里设置
const form = ref({
  account_name: '',
  login_email: '',
})
const errorMsg = ref<string | null>(null)

watch(
  () => [props.open, props.target?.id] as const,
  ([isOpen]) => {
    if (!isOpen) return
    errorMsg.value = null
    const t = props.target
    if (t) {
      form.value = {
        account_name: t.account_name,
        login_email: (t as any).login_email ?? '',
      }
    } else {
      form.value = { account_name: '', login_email: '' }
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
    description="主账号是管理账号，不参与直接下单；下单类别由子账号决定"
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
