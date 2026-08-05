/**
 * 公共 fixtures + 工具
 */
import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  // 默认超时调长（业务页面 SPA 加载慢）
  page: async ({ page }, use) => {
    page.setDefaultTimeout(15_000)
    await use(page)
  },
})

export { expect }

/** 等待 SPA 路由 hydration 完成（替代硬编码 sleep） */
export async function waitAppReady(page: import('@playwright/test').Page) {
  // 看到 SPA 顶层的品牌元素或 AppLayout 出现
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => { /* ignore */ })
}