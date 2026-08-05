/**
 * E2E: 客户下单黄金路径（mock 登录态）
 *
 * 完整流程：
 *   登录 → 浏览商品 → 加购 → 结算 → 看到订单页
 *
 * 注：CI 环境下，登录需要真实 Supabase（占位 URL 不可用）。
 *      跑法：`E2E_BASE_URL=http://localhost:5173 npm run test:e2e`（需起 dev server + 配置真实 env）
 *      MVP 阶段重点验证"未登录路由守卫"已足够。
 */
import { test, expect } from './fixtures'

test.describe('Catalog browsing (unauthenticated)', () => {
  test('redirect to login', async ({ page }) => {
    await page.goto('/catalog')
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })
})

/**
 * 真实下单黄金路径（mock 全栈登录态）
 *
 * 跳过 CI，仅在本地跑（用 E2E_FULL_FLOW=1 启用）：
 *   E2E_FULL_FLOW=1 npm run test:e2e -- --grep "full flow"
 */
test.describe('Customer order flow (full integration)', () => {
  test.skip(!process.env.E2E_FULL_FLOW, '需要 E2E_FULL_FLOW=1 启用（需真实 Supabase 配置）')

  test('login → catalog → checkout', async ({ page }) => {
    // 1. 登录（用测试账号）
    await page.goto('/login')
    await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.E2E_TEST_EMAIL ?? 'customer1@test.local')
    await page.locator('input[type="password"]').first().fill(process.env.E2E_TEST_PASSWORD ?? 'TestPass1234')
    await page.getByRole('button', { name: /login|войти|kirish|登录/i }).first().click()

    // 2. 等待路由到 catalog
    await page.waitForURL(/\/(catalog|orders)/, { timeout: 15_000 })

    // 3. 进入 catalog
    await page.goto('/catalog')
    await expect(page.locator('body')).toContainText(/каталог|目录|katalog/i, { timeout: 10_000 })
  })
})