<!--
  src/views/admin/accounts-admin/ResetPasswordDialog.vue
  重置密码对话框 —— 两步：生成 → 复制临时密码
  父级：<ResetPasswordDialog v-model:open="open" :target="target" :loading="loading"
                            @generate="customerAuth.resetPassword(target.id)"
                            @close="tempPassword = null" />
-->
<script setup lang="ts">
import { Copy, KeyRound, Loader2 } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Dialog from '@/components/ui/Dialog.vue'

import type { Account } from '@/composables/useAccounts'

const props = defineProps<{
  open: boolean
  target: Account | null
  loading: boolean
  tempPassword: string | null     // 父级持有：成功后赋值，复制/完成时不清
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'generate'): void            // 父级调 customerAuth.resetPassword() → 把结果写回 :temp-password
}>()

const copyTempPassword = async () => {
  if (!props.tempPassword) return
  try {
    await navigator.clipboard.writeText(props.tempPassword)
    alert('已复制临时密码')
  } catch {
    prompt('复制这一行：', props.tempPassword)
  }
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="`重置密码：${target?.account_name ?? ''}`"
    description="生成一个临时密码，请通过其他渠道（微信 / 电话）告知客户。客户首次登录后应自行修改。"
  >
    <div class="space-y-3">
      <div v-if="!tempPassword" class="flex justify-end gap-2 pt-2">
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button @click="emit('generate')" :disabled="loading">
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          <KeyRound class="mr-2 h-4 w-4" />
          生成临时密码
        </Button>
      </div>
      <div v-else class="space-y-2">
        <div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
          临时密码已生成。请复制后告知客户。
        </div>
        <div class="flex items-center gap-2">
          <Input :value="tempPassword" readonly class="font-mono text-sm h-9" />
          <Button size="sm" variant="outline" @click="copyTempPassword">
            <Copy class="h-3.5 w-3.5" />
          </Button>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button @click="emit('update:open', false)">完成</Button>
        </div>
      </div>
    </div>
  </Dialog>
</template>