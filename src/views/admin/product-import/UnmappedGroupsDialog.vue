<!--
  src/views/admin/product-import/UnmappedGroupsDialog.vue
  未映射客户组提示对话框
  父级：<UnmappedGroupsDialog v-model:open="open" :groups="unmappedGroups" @go-assign="goAssign" />
-->
<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Badge from '@/components/ui/Badge.vue'

defineProps<{
  open: boolean
  groups: string[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'go-assign'): void
}>()
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    title="未映射客户组"
    description="这些客户组不会出现在任何账户的白名单中，需先在客户组映射中关联账户"
  >
    <div class="space-y-3">
      <p class="text-sm text-muted-foreground">
        CSV 中出现 <strong>{{ groups.length }}</strong> 个客户组未关联到任何账户：
      </p>
      <div class="max-h-60 overflow-y-auto rounded-md border bg-muted/30 p-2 flex flex-wrap gap-1">
        <Badge v-for="g in groups" :key="g" variant="outline" class="font-mono text-xs">
          {{ g }}
        </Badge>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="outline" @click="emit('update:open', false)">稍后处理</Button>
        <Button @click="emit('go-assign')">前往分配</Button>
      </div>
    </div>
  </Dialog>
</template>