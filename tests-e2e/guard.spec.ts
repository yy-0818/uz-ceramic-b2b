/**
 * E2E: 未登录访问受保护路由 → 自动跳 /login
 */
import { test, expect } from './fixtures'

test.describe('Auth guard', () => {
  test('/admin redirects to /login when not authenticated', async ({ page }) => {
    await page.goto('/admin/products')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('/checkout redirects to /login when not authenticated', async ({ page }) => {
    await page.goto('/checkout')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })
})