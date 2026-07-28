<script setup lang="ts">
/**
 * OrderRowSkeleton —— 订单行占位
 * 用于 OrderHistoryPage / WarehousePage / AuditListPage
 */
import Card from '@/components/ui/Card.vue'
import Skeleton from '@/components/ui/Skeleton.vue'

defineProps<{ compact?: boolean }>()
</script>

<template>
  <Card>
    <div class="flex items-center gap-3 p-3">
      <Skeleton variant="circle" class="h-9 w-9 shrink-0" />
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex items-center gap-2">
          <Skeleton class="h-4 w-32" />
          <Skeleton class="h-3 w-16 rounded-full" />
        </div>
        <Skeleton v-if="!compact" class="h-3 w-48" />
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Skeleton class="h-8 w-20 rounded-md" />
      </div>
    </div>
  </Card>
</template>
