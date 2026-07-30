/**
 * useAuth —— 全局身份与权限管理
 * 详细职责见 Phase 1，本文件为最终落地版
 */
import { ref, computed, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'
import type { Session, User as AuthUser, Subscription } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AccountType, UserRole } from '@/types/database'
import { resetOrders } from './useOrders'
import { resetProducts } from './useProducts'
import { resetAccountProducts } from './useAccountProducts'
import { resetAccounts } from './useAccounts'
import { resetFinance } from './useFinance'
import { resetCart } from './useCart'

/**
 * 切换账号时，清空所有 composable 模块级单例缓存。
 * 在 signOut() 中调用（reload 后模块状态本来就是干净的，无需在 onAuthStateChange 里重复清理）。
 */
function clearAllCaches() {
  resetOrders()
  resetProducts()
  resetAccountProducts()
  resetAccounts()
  resetFinance()
  resetCart()
}

export interface Account {
  id: string
  parent_id: string | null
  account_type: AccountType
  account_name: string
  company_name: string
  address: string
  bank: string
  bank_account: string
  mfo: string
  inn: string
  director: string
  contract_no: string | null
  contract_date: string | null
  balance: number
  status: 'active' | 'inactive'
  is_main: boolean
}

export interface AppUser {
  id: string
  account_id: string
  role: UserRole
  is_main: boolean
  full_name: string | null
  phone: string | null
}

export type Permission =
  | 'order:create' | 'order:audit' | 'order:ship'
  | 'invoice:accounting' | 'finance:view'
  | 'product:import' | 'product:assign'
  | 'account:manage' | 'user:manage'

const rolePermissionMap: Record<UserRole, Permission[]> = {
  admin: [
    'order:create','order:audit','order:ship',
    'invoice:accounting','finance:view',
    'product:import','product:assign',
    'account:manage','user:manage',
  ],
  checker:   ['order:audit', 'order:create'],
  warehouse: ['order:ship'],
  finance:   ['invoice:accounting', 'finance:view'],
  customer:  ['order:create'],
}

// ---------- 模块级单例 ----------
const session: Ref<Session | null> = ref(null)
const authUser: Ref<AuthUser | null> = ref(null)
const appUser: Ref<AppUser | null> = ref(null)
const account: Ref<Account | null> = ref(null)
const loading = ref(true)
const error = ref<string | null>(null)

let initialized = false
let authSub: Subscription | null = null

export function useAuth() {
  const init = async () => {
    if (initialized) return
    initialized = true

    const { data } = await supabase.auth.getSession()
    session.value = data.session
    authUser.value = data.session?.user ?? null
    if (authUser.value) await loadProfile(authUser.value.id)
    loading.value = false

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, _s) => {
      session.value = _s
      authUser.value = _s?.user ?? null
      appUser.value = null
      account.value = null
      if (authUser.value) await loadProfile(authUser.value.id)
    })
    authSub = sub.subscription
  }

  const loadProfile = async (uid: string) => {
    try {
      // 1. 先尝试直接拿 users 行（内部员工路径）
      let userRow = (await supabase
        .from('users').select('*').eq('id', uid).single()).data as AppUser | null

      // 2. 拿不到 → 客户登录路径：accounts.user_id = uid
      if (!userRow) {
        const { data: accRow } = await supabase
          .from('accounts').select('*').eq('user_id', uid).single()
        if (accRow) {
          const a = accRow as any
          account.value = a as Account
          // 客户角色：is_main = true（自动主联系）；
          // account_id = 父账号.id（无需 sub 选择 — 但保留下单时选子）
          userRow = {
            id: uid,
            account_id: a.id,
            role: 'customer',
            is_main: true,
            full_name: a.account_name,
            phone: null,
          } as AppUser
          // 同步写 users 行（下次能直接命中）。upsert 避免重复。
          try {
            await (supabase.from('users') as any).upsert({
              id: uid,
              account_id: a.id,
              role: 'customer',
              is_main: true,
              full_name: a.account_name,
            })
          } catch {
            // 忽略：可能 RLS 拒绝，client 不能写 users（service_role 才能）
            // 但最起码内存态可用
          }
        }
      }

      if (!userRow) {
        throw new Error('未找到用户档案。请联系管理员。')
      }
      appUser.value = userRow
      try { localStorage.setItem('appUser', JSON.stringify(userRow)) } catch {}

      // 3. 拿父账号（兼容 customer 路径：acc 已经在前面拿到）
      if (!account.value) {
        const { data: accRow, error: aErr } = await supabase
          .from('accounts').select('*').eq('id', (userRow as AppUser).account_id).single()
        if (aErr) throw aErr
        account.value = accRow as Account
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'profile load failed'
    }
  }

  /** 初始化时尝试从 localStorage 读出上次角色，让 onMounted 中的路由守卫立刻可用 */
  const cachedUser: AppUser | null = (() => {
    try {
      const raw = localStorage.getItem('appUser')
      return raw ? (JSON.parse(raw) as AppUser) : null
    } catch { return null }
  })()
  if (cachedUser && !appUser.value) appUser.value = cachedUser

  const signIn = async (email: string, password: string) => {
    const { error: e } = await supabase.auth.signInWithPassword({ email, password })
    if (e) throw e
  }

  const signOut = async () => {
    clearAllCaches()
    await supabase.auth.signOut()
    appUser.value = null
    account.value = null
    try { localStorage.removeItem('appUser') } catch {}
  }

  /** 是否拥有指定权限（支持数组表示 AND 关系） */
  const hasPermission = (perm: Permission | Permission[]): boolean => {
    if (!appUser.value) return false
    const list = Array.isArray(perm) ? perm : [perm]
    const granted = rolePermissionMap[appUser.value.role] ?? []
    return list.every((p) => granted.includes(p))
  }

  const isLoggedIn: ComputedRef<boolean> = computed(() => !!authUser.value)
  const isAdmin: ComputedRef<boolean> = computed(() => appUser.value?.role === 'admin')
  const role: ComputedRef<UserRole | null> = computed(() => appUser.value?.role ?? null)

  onMounted(() => { init() })
  onUnmounted(() => { authSub?.unsubscribe() })

  return {
    session, authUser, appUser, account, loading, error,
    isLoggedIn, isAdmin, role,
    signIn, signOut, hasPermission,
  }
}
