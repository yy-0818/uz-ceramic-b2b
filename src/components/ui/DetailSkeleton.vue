<script setup lang="ts">
/**
 * DetailSkeleton —— 大详情卡占位
 * 用于 OrderDetailPage 等
 */
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
</script>

<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-2">
          <CardTitle>
            <Skeleton class="h-5 w-32" />
          </CardTitle>
          <Skeleton class="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <div class="space-y-3 px-6 pb-6">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Skeleton class="h-3 w-12" />
            <Skeleton class="h-4 w-32" />
          </div>
          <div class="space-y-1.5">
            <Skeleton class="h-3 w-12" />
            <Skeleton class="h-4 w-32" />
          </div>
        </div>
        <Skeleton class="h-px w-full" />
        <div class="space-y-2">
          <Skeleton class="h-3 w-full" />
          <Skeleton class="h-3 w-5/6" />
          <Skeleton class="h-3 w-4/6" />
        </div>
      </div>
    </Card>
    <Card>
      <div class="space-y-2 p-4">
        <Skeleton class="h-16 w-full rounded-md" />
        <Skeleton class="h-16 w-full rounded-md" />
      </div>
    </Card>
  </div>
</template>
