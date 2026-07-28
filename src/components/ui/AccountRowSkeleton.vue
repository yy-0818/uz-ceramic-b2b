<script setup lang="ts">
/**
 * AccountRowSkeleton —— 账号 / 邀请行占位
 * 用于 AccountsAdminPage 的 parents / accounts / invites 三处列表
 */
import Card from '@/components/ui/Card.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
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
        <Skeleton class="h-3 w-44" />
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Skeleton class="h-7 w-7 rounded-md" />
        <Skeleton class="h-7 w-7 rounded-md" />
      </div>
    </div>
  </Card>
</template>
