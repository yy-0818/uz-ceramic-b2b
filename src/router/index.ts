/**
 * 路由配置 —— Phase 3
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { supabase } from '@/lib/supabase'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/customer-invite',
    name: 'customerInvite',
    component: () => import('@/views/CustomerInvitePage.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/views/layout/AppLayout.vue'),
    children: [
      { path: '', redirect: '/catalog' },

      // 客户
      {
        path: 'catalog',
        name: 'catalog',
        component: () => import('@/views/customer/ProductBrowsePage.vue'),
        meta: { roles: ['customer', 'admin', 'checker'] },
      },
      {
        path: 'checkout',
        name: 'checkout',
        component: () => import('@/views/customer/CheckoutPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker'] },
      },
      {
        path: 'orders',
        name: 'orders',
        component: () => import('@/views/customer/OrderHistoryPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker', 'finance', 'warehouse'] },
      },
      {
        path: 'orders/:id',
        name: 'order.detail',
        component: () => import('@/views/customer/OrderDetailPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker', 'finance', 'warehouse'] },
      },
      {
        path: 'orders/:id/pay',
        name: 'order.pay',
        component: () => import('@/views/customer/OrderPayPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker', 'finance', 'warehouse'] },
      },

      // 后台
      {
        path: 'admin/import',
        name: 'admin.import',
        component: () => import('@/views/admin/ProductImportPage.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'admin/products',
        name: 'admin.products',
        component: () => import('@/views/admin/AllProductsPage.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'admin/assign',
        name: 'admin.assign',
        component: () => import('@/views/admin/AssignStockPage.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'admin/accounts',
        name: 'admin.accounts',
        component: () => import('@/views/admin/AccountsAdminPage.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'admin/staff',
        name: 'admin.staff',
        component: () => import('@/views/admin/StaffManagementPage.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'admin/accounts/import',
        name: 'admin.accounts.import',
        component: () => import('@/views/admin/AccountsImportPage.vue'),
        meta: { roles: ['admin'] },
      },

      // 审核员
      {
        path: 'audit',
        name: 'audit',
        component: () => import('@/views/checker/AuditListPage.vue'),
        meta: { roles: ['admin', 'checker'] },
      },

      // 财务
      {
        path: 'finance',
        name: 'finance',
        component: () => import('@/views/finance/FinancePage.vue'),
        meta: { roles: ['admin', 'finance'] },
      },

      // 仓库
      {
        path: 'warehouse',
        name: 'warehouse',
        component: () => import('@/views/warehouse/WarehousePage.vue'),
        meta: { roles: ['admin', 'warehouse'] },
      },

      // 在线客服聊天 (Phase 1 - 客户 / 员工共用)
      // Phase 7: unified - 按角色自动切客户一对一 / 后台一对多
      {
        path: 'chat',
        name: 'chat',
        component: () => import('@/views/ChatListPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker', 'finance', 'warehouse'] },
      },

      // Phase 6: 通知中心 (所有登录用户可访问)
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('@/views/NotificationsPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker', 'finance', 'warehouse'] },
      },

      // 通用设置页 (登录用户可访问, 改自己密码 + 未来扩展)
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/SettingsPage.vue'),
        meta: { roles: ['customer', 'admin', 'checker', 'finance', 'warehouse'] },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/** 记录上一个 auth user ID，用于检测账号切换 */
let prevAuthUserId: string | null = null

router.beforeEach(async (to) => {
  if (to.meta?.public) return true

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const currentUid = session?.user?.id ?? null

  // 检测账号切换（排除登出：登出时 session=null 且 prevAuthUserId 已知，不需要 reload）
  if (session && prevAuthUserId !== null && prevAuthUserId !== currentUid) {
    // 用 location.reload() 从浏览器层面强制全量刷新，
    // 所有模块级单例、组件状态、路由状态全部重置为初始态，
    // 等同于重新打开页面，从根本上解决缓存残留和状态不一致问题。
    window.location.reload()
    return false
  }
  prevAuthUserId = currentUid

  if (!session) return { path: '/login', query: { redirect: to.fullPath } }

  // 角色守卫
  const requiredRoles = (to.meta?.roles as string[] | undefined) ?? []
  if (requiredRoles.length === 0) return true
  const { data: profile } = await supabase.from('users').select('role').eq('id', session.user.id).single()
  const role = (profile as any)?.role
  if (!role || !requiredRoles.includes(role)) {
    return { path: '/' }
  }
  return true
})
