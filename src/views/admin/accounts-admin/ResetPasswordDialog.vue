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
import { useI18n } from '@/lib/i18n'

import type { Account } from '@/composables/useAccounts'

const { t } = useI18n()

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
    alert(t('accounts.resetCopied'))
  } catch {
    prompt(t('admin.invites.copyPrompt'), props.tempPassword)
  }
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="`${t('accounts.resetTitle')}: ${target?.account_name ?? ''}`"
    :description="t('accounts.resetDesc')"
  >
    <div class="space-y-3">
      <div v-if="!tempPassword" class="flex justify-end gap-2 pt-2">
        <Button variant="outline" @click="emit('update:open', false)">{{ t('common.cancel') }}</Button>
        <Button @click="emit('generate')" :disabled="loading">
          <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
          <KeyRound class="mr-2 h-4 w-4" />
          {{ t('accounts.resetGenerate') }}
        </Button>
      </div>
      <div v-else class="space-y-2">
        <div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
          {{ t('accounts.resetReady') }}
        </div>
        <div class="flex items-center gap-2">
          <Input :value="tempPassword" readonly class="font-mono text-sm h-9" />
          <Button size="sm" variant="outline" @click="copyTempPassword">
            <Copy class="h-3.5 w-3.5" />
          </Button>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button @click="emit('update:open', false)">{{ t('common.done') }}</Button>
        </div>
      </div>
    </div>
  </Dialog>
</template>