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
    path: '/',
    component: () => import('@/views/layout/AppLayout.vue'),
    children: [
      { path: '', redirect: '/catalog' },

      // 客户
      { path: 'catalog', name: 'catalog', component: () => import('@/views/customer/ProductBrowsePage.vue'),
        meta: { roles: ['customer','admin','checker'] } },
      { path: 'checkout', name: 'checkout', component: () => import('@/views/customer/CheckoutPage.vue'),
        meta: { roles: ['customer','admin','checker'] } },
      { path: 'orders', name: 'orders', component: () => import('@/views/customer/OrderHistoryPage.vue'),
        meta: { roles: ['customer','admin','checker','finance','warehouse'] } },
      { path: 'orders/:id', name: 'order.detail', component: () => import('@/views/customer/OrderDetailPage.vue'),
        meta: { roles: ['customer','admin','checker','finance','warehouse'] } },

      // 后台
      { path: 'admin/import', name: 'admin.import', component: () => import('@/views/admin/ProductImportPage.vue'),
        meta: { roles: ['admin'] } },
      { path: 'admin/products', name: 'admin.products', component: () => import('@/views/admin/AllProductsPage.vue'),
        meta: { roles: ['admin'] } },
      { path: 'admin/customer-groups', name: 'admin.customerGroups', component: () => import('@/views/admin/CustomerGroupMappingPage.vue'),
        meta: { roles: ['admin'] } },
      { path: 'admin/assign', name: 'admin.assign', component: () => import('@/views/admin/AssignStockPage.vue'),
        meta: { roles: ['admin'] } },

      // 审核员
      { path: 'audit', name: 'audit', component: () => import('@/views/checker/AuditListPage.vue'),
        meta: { roles: ['admin','checker'] } },

      // 财务
      { path: 'finance', name: 'finance', component: () => import('@/views/finance/FinancePage.vue'),
        meta: { roles: ['admin','finance'] } },

      // 仓库
      { path: 'warehouse', name: 'warehouse', component: () => import('@/views/warehouse/WarehousePage.vue'),
        meta: { roles: ['admin','warehouse'] } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (to.meta?.public) return true
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { path: '/login', query: { redirect: to.fullPath } }

  // 角色守卫
  const requiredRoles = (to.meta?.roles as string[] | undefined) ?? []
  if (requiredRoles.length === 0) return true
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', session.user.id).single()
  const role = (profile as any)?.role
  if (!role || !requiredRoles.includes(role)) {
    return { path: '/' }
  }
  return true
})
