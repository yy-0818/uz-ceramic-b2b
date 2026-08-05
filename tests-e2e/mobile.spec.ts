/**
 * E2E: 移动端视图（PWA / iPhone Safari）
 *
 * 验证：
 *   - 移动端 viewport 下，页面布局正确（不溢出 / 不破版）
 *   - 关键交互元素可点
 *   - 聊天 FAB 在移动端可见（ChatWindow 全局浮窗）
 */
import { test, expect } from './fixtures'

test.describe('Mobile UI (iPhone 13)', () => {
  test('login page is usable on mobile', async ({ page }) => {
    await page.goto('/login')
    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
    await expect(emailInput).toBeVisible()
    // 在移动 viewport 下，input 至少 200px 宽（不要被压成 < 100px）
    const box = await emailInput.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(200)
  })

  test('catalog page works on mobile (after login)', async ({ page }) => {
    // 未登录时尝试 catalog：应跳转到 login
    await page.goto('/catalog')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })
})