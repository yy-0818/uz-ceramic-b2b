import { ref } from 'vue'

// 购物车面板打开时隐藏全局 Chat FAB，避免遮挡
export const isCartPanelOpen = ref(false)
