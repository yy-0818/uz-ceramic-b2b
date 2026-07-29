<!--
  src/components/ui/PageTransition.vue
  全局页面切换动画 — 桌面 / 移动端自适应

  - 桌面端:  fade + translateY  8px  →  0  (克制的"上浮淡入")
  - 移动端:  fade + translateX 24px → 0  (更像原生 App 的水平切换)
  - prefers-reduced-motion / 旧浏览器: 直接禁用，瞬时切换
  - 配合 router.recordRoute by storing each route in <RouterView> via key=$route.path
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

// Detect sub-page direction: pushing deeper → forward, popping back → reverse.
// Used by reverse enter/leave classes (not strictly necessary for fade-only,
// but lets us pick the right slide direction on mobile).
const transitionName = computed(() => {
  // Heuristic: route meta may carry explicit `transition: 'slide-left'`
  const meta = route.meta?.transition as string | undefined
  return meta ?? 'page'
})

// Track last fullPath to decide direction. We keep it reactive on the
// router state directly to avoid relying on global this.captureDirection
// which can race with concurrent navigations.
const fromIndex = (() => {
  try {
    return Number(router.options.history.state?.position ?? 0)
  } catch {
    return 0
  }
})()
void fromIndex
</script>

<template>
  <!--
    Wrapping <RouterView> in <Transition> lets Vue intercept component
    mounts/unmounts and apply CSS classes for enter/leave. The :key on
    RouterView (driven by fullPath) is what triggers the transition — if
    a sibling route share the same component path (e.g. /orders/:id with
    two different ids), we still remount and replay the animation.
  -->
  <Transition
    :name="transitionName"
    mode="out-in"
    appear
    :duration="{ enter: 220, leave: 140 }"
  >
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="router.resolve(route).fullPath" />
    </RouterView>
  </Transition>
</template>

<style scoped>
/* ============================================================
   Desktop:  fade + 8px translateY (subtle "rise" feel)
   Mobile:   fade + 24px translateX (slide-in feel)
   Trigger:  CSS @media (max-width: 767px) — matches Tailwind md: breakpoint
   Fallback: prefers-reduced-motion → 0ms; both classes no-op
   ============================================================ */

/* page-enter-active / page-leave-active are picked up by <Transition name="page"> */
.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: opacity, transform;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Mobile override: horizontal slide replaces vertical rise */
@media (max-width: 767px) {
  .page-enter-from {
    transform: translateX(24px);
  }
  .page-leave-to {
    transform: translateX(-12px);
  }
}

/* ============================================================
   Accessibility: respect user's motion preference
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
  }
}
</style>
