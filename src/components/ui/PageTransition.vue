<!--
  src/components/ui/PageTransition.vue
  全局页面切换动画 — 桌面 / 移动端自适应

  桌面端 (md+):
    - 新页: clip-path circle 从 90% 中心展开到 100% + opacity 0→1 + translateY 12px→0
    - 旧页: clip-path circle 从 100% 收缩到 90% 中心 + opacity 1→0 + translateY 0→-8px
    - 效果: "上推+圆形揭示"，比单纯 fade 更有产品感
  移动端 (<md):
    - 新页: fade + translateX 24px→0  (类似原生 App)
    - 旧页: fade + translateX 0→-12px
  无障碍:
    - prefers-reduced-motion → 0ms + 立即呈现
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const transitionName = computed(() => {
  const meta = route.meta?.transition as string | undefined
  return meta ?? 'page'
})
void router
</script>

<template>
  <!--
    关键：<RouterView> 必须用 slot 形式，<Transition> 包在 <component :is> 外层。
    否则 vue-router 4 会持续打印 warn: "<router-view> can no longer be used
    directly inside <transition>".
  -->
  <RouterView v-slot="{ Component, route: r }">
    <Transition
      :name="transitionName"
      :duration="{ enter: 240, leave: 0 }"
    >
      <component :is="Component" :key="router.resolve(r).fullPath" />
    </Transition>
  </RouterView>
</template>

<style scoped>
/* ============================================================
   Desktop (md+): 圆形 clip-path 揭示 + 上推
   Mobile (<md): 水平 slide (覆盖)
   ============================================================ */

.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1),
    clip-path 0.32s cubic-bezier(0.7, 0, 0.3, 1);
  will-change: opacity, transform, clip-path;
}

/* Desktop enter-from / desktop leave-to */
.page-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
  clip-path: circle(90% at 50% 50%);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.99);
  clip-path: circle(95% at 50% 50%);
}

/* ============================================================
   Mobile override: 水平 slide 替代 clip-path
   ============================================================ */
@media (max-width: 767px) {
  .page-enter-active,
  .page-leave-active {
    transition:
      opacity 0.24s ease,
      transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
    will-change: opacity, transform;
  }
  .page-enter-from {
    opacity: 0;
    transform: translateX(24px);
    clip-path: none;
  }
  .page-leave-to {
    opacity: 0;
    transform: translateX(-12px);
    clip-path: none;
  }
}

/* ============================================================
   Accessibility: respect prefers-reduced-motion
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none !important;
  }
  .page-enter-from,
  .page-leave-to {
    opacity: 1 !important;
    transform: none !important;
    clip-path: none !important;
  }
}
</style>
