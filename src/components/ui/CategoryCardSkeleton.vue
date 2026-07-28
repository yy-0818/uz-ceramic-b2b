<script setup lang="ts">
/**
 * CategoryCardSkeleton —— 分类卡占位
 * 1:1 模拟 ProductBrowsePage 第 1 级分类卡
 */
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
</script>

<template>
  <Card class="overflow-hidden border-2">
    <CardContent class="flex items-center gap-3 pt-5 pb-4 px-4">
      <Skeleton variant="circle" class="h-12 w-12 rounded-xl shrink-0" />
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex items-baseline gap-2">
          <Skeleton class="h-4 w-24" />
          <Skeleton class="h-3 w-8" />
        </div>
        <div class="flex gap-1.5">
          <Skeleton class="h-4 w-16 rounded-full" />
          <Skeleton class="h-4 w-20 rounded-full" />
          <Skeleton class="h-4 w-14 rounded-full" />
        </div>
      </div>
      <Skeleton class="h-4 w-4 shrink-0 rounded-sm" />
    </CardContent>
  </Card>
</template>
