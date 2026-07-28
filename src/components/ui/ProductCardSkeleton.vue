<script setup lang="ts">
/**
 * ProductCardSkeleton —— 商品卡占位
 * 1:1 模拟 AllProductsPage 的商品卡结构
 */
import Card from '@/components/ui/Card.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
</script>

<template>
  <Card class="overflow-hidden">
    <div class="grid grid-cols-1 sm:grid-cols-[280px_1fr] gap-0">
      <!-- 图片区 -->
      <Skeleton class="aspect-square sm:aspect-auto sm:min-h-[220px] w-full rounded-none" />
      <!-- 文字区 -->
      <div class="space-y-3 p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="space-y-2 flex-1">
            <Skeleton class="h-5 w-32" />
            <Skeleton class="h-3 w-48" />
          </div>
          <Skeleton class="h-5 w-16 rounded-full" />
        </div>
        <div class="grid grid-cols-3 gap-2">
          <Skeleton class="h-14 rounded-md" />
          <Skeleton class="h-14 rounded-md" />
          <Skeleton class="h-14 rounded-md" />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Skeleton class="h-5 w-12 rounded-full" />
          <Skeleton class="h-5 w-14 rounded-full" />
          <Skeleton class="h-5 w-10 rounded-full" />
          <Skeleton class="h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  </Card>
</template>
