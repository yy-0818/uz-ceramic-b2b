<!--
  src/views/admin/product-import/ClearAllPanel.vue
  清空库存旧数据（危险操作）面板
  父级：<ClearAllPanel :clearing="clearing" :result="result" :error="error"
                     @execute="onExecute" />
-->
<script setup lang="ts">
import { ref } from 'vue'
import { Loader2, Trash2 } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  clearing: boolean
  result: { products: number; colors: number; whiteRows: number } | null
  error: string | null
}>()

const emit = defineEmits<{
  (e: 'execute'): void
}>()

const CONFIRM_TOKEN = 'CLEAR'
const confirmText = ref('')

const onExecute = () => {
  if (confirmText.value !== CONFIRM_TOKEN) return
  if (!confirm('⚠️ 此操作将物理删除：account_products / stock_colors / products 三张表所有数据，且不可恢复。确认继续？')) return
  emit('execute')
}

// 父级执行后我们仅显示结果；用户可改确认文本做下一次操作
defineExpose({ reset: () => { confirmText.value = '' } })
</script>

<template>
  <Card class="border-red-200 bg-red-50/30">
    <CardHeader class="pb-3">
      <CardTitle class="flex items-center gap-2 text-red-700">
        <Trash2 class="h-5 w-5" />
        清空旧数据（危险操作）
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <p class="text-sm text-muted-foreground">
        将物理删除 <code class="px-1 rounded bg-red-100 text-red-800">account_products</code> ·
        <code class="px-1 rounded bg-red-100 text-red-800">stock_colors</code> ·
        <code class="px-1 rounded bg-red-100 text-red-800">products</code> 三张表的所有数据，
        用于在重新导入前重置库。不可恢复，请确认后再操作。
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model="confirmText" placeholder='输入 "CLEAR" 以确认' class="w-56" />
        <Button
          variant="destructive"
          :disabled="clearing || confirmText !== 'CLEAR'"
          @click="onExecute"
        >
          <Loader2 v-if="clearing" class="mr-2 h-4 w-4 animate-spin" />
          <Trash2 v-else class="mr-2 h-4 w-4" />
          {{ clearing ? '清空中…' : '清空全部' }}
        </Button>
        <span v-if="result" class="text-xs text-emerald-700">
          ✓ 已删除：{{ result.products }} 商品 ·
          {{ result.colors }} 色号 ·
          {{ result.whiteRows }} 白名单行
        </span>
        <span v-if="error" class="text-xs text-red-700">{{ error }}</span>
      </div>
    </CardContent>
  </Card>
</template>