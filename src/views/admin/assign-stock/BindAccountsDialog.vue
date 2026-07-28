<!--
  src/views/admin/assign-stock/BindAccountsDialog.vue
  客户组 ↔ 主账号绑定对话框
  父级：
    <BindAccountsDialog
      v-model:open="bindDialogOpen"
      :group="currentGroup"
      :initial-selection="currentSelection"
      :all-parents="allParents"
      :saving="savingBind"
      @submit="onSubmitSelection"
    />
  父级拿 finalSelection 后调 mappings.bulkUpsert/remove → 保存后 v-model:open=false
-->
<script setup lang="ts">
import { ref, watch } from 'vue'

import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'

import type { Account } from '@/composables/useAccounts'

const props = defineProps<{
  open: boolean
  group: string | null
  initialSelection: string[]     // 打开时预选中的 account_id 列表
  allParents: Account[]          // 可绑定的主账号全集
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'submit', payload: { group: string; selection: string[] }): void
}>()

const selection = ref<Set<string>>(new Set())
const isSelected = (id: string) => selection.value.has(id)

watch(
  () => [props.open, props.group] as const,
  ([isOpen]) => {
    if (!isOpen) return
    // 每次打开都重新加载 selection（父级在 open 前应已设好 initialSelection）
    selection.value = new Set(props.initialSelection)
  },
  { immediate: true },
)

const toggle = (id: string) => {
  const s = new Set(selection.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selection.value = s
}

const onCancel = () => emit('update:open', false)
const onSubmit = () => {
  if (!props.group) return
  emit('submit', { group: props.group, selection: Array.from(selection.value) })
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="group ? `「${group}」绑定主账号` : ''"
    description="可多选；勾选确定后写入 DB。"
  >
    <div class="flex flex-wrap gap-1.5 max-h-72 overflow-auto py-2">
      <button
        v-for="a in allParents" :key="a.id"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
        :class="isSelected(a.id)
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background hover:bg-muted'"
        @click="toggle(a.id)"
      >
        <span class="font-medium truncate max-w-[160px]">{{ a.account_name }}</span>
        <span class="text-[10px]"
          :class="isSelected(a.id) ? 'opacity-80' : 'text-muted-foreground'">
          {{ a.account_type }}
        </span>
      </button>
    </div>

    <div class="mt-4 flex justify-end gap-2">
      <Button variant="outline" :disabled="saving" @click="onCancel">取消</Button>
      <Button :disabled="saving" @click="onSubmit">
        保存绑定
      </Button>
    </div>
  </Dialog>
</template>