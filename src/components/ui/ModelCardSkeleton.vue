<script setup lang="ts">
/**
 * ModelCardSkeleton —— 型号卡占位（带图片）
 * 1:1 模拟 ProductBrowsePage 第 2 级型号卡
 */
import Card from '@/components/ui/Card.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
</script>

<template>
  <Card class="overflow-hidden">
    <Skeleton class="aspect-square w-full rounded-none" />
    <div class="space-y-2 p-3">
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="h-3 w-1/2" />
      <div class="flex justify-between pt-1">
        <Skeleton class="h-4 w-12 rounded-full" />
        <Skeleton class="h-4 w-10 rounded-full" />
      </div>
    </div>
  </Card>
</template>
