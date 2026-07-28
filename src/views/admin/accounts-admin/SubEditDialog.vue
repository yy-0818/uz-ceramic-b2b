<!--
  src/views/admin/accounts-admin/SubEditDialog.vue
  新建 / 编辑子账号对话框 —— 纯表单
  父级：<SubEditDialog v-model:open="open" :target="sub" :default-parent="parent"
                     :default-type="parent.account_type"
                     :loading="loading" @submit="onSubmit" />
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Star } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Dialog from '@/components/ui/Dialog.vue'

import type { Account, AccountType } from '@/composables/useAccounts'

const props = defineProps<{
  open: boolean
  target: Account | null
  defaultParentId: string
  defaultAccountType: AccountType
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submit', payload: {
    form: {
      parent_id: string
      account_name: string
      account_type: AccountType
      inn: string
      is_main: boolean
      status: 'active' | 'inactive'
    }
  }): void
}>()

const accountTypes: Array<{ value: AccountType; label: string }> = [
  { value: '1_public', label: '1 公户' },
  { value: '2_cash',   label: '2 现金' },
  { value: '3_export', label: '3 出口' },
]

const form = ref({
  parent_id: '',
  account_name: '',
  account_type: '1_public' as AccountType,
  inn: '',
  is_main: false,
  status: 'active' as 'active' | 'inactive',
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
        parent_id: props.defaultParentId,
        account_name: t.account_name,
        account_type: t.account_type,
        inn: t.inn ?? '',
        is_main: t.is_main,
        status: t.status,
      }
    } else {
      form.value = {
        parent_id: props.defaultParentId,
        account_name: '',
        account_type: props.defaultAccountType,
        inn: '',
        is_main: false,
        status: 'active',
      }
    }
  },
  { immediate: true },
)

const onSubmit = () => {
  if (!form.value.account_name) {
    errorMsg.value = '请填写子账号名'
    return
  }
  errorMsg.value = null
  emit('submit', { form: { ...form.value } })
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="target ? `编辑子账号：${target.account_name}` : '新建子账号'"
  >
    <form class="space-y-3" @submit.prevent="onSubmit">
      <div>
        <Label>子账号名 *</Label>
        <Input v-model="form.account_name" placeholder="例如：1账户 贾汉 ASM" class="h-9" />
      </div>
      <div>
        <Label>类型</Label>
        <div class="grid grid-cols-3 gap-2 mt-1">
          <button v-for="t in accountTypes" :key="t.value"
            type="button"
            class="border rounded-md px-2 py-2 text-sm transition text-left"
            :class="form.account_type === t.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'"
            @click="form.account_type = t.value">
            <p class="font-medium">{{ t.label }}</p>
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <Label>税号</Label>
          <Input v-model="form.inn" placeholder="可空" class="h-9" />
        </div>
        <div>
          <Label>状态</Label>
          <select v-model="form.status" class="w-full h-9 rounded-md border bg-background px-3 text-sm">
            <option value="active">可用</option>
            <option value="inactive">停用</option>
          </select>
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" v-model="form.is_main" class="rounded" />
        <Star class="h-3.5 w-3.5 text-amber-500" />
        设为主联系（默认显示）
      </label>
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