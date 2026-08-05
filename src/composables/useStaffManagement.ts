/**
 * useStaffManagement —— admin 员工账号管理
 *
 * 流程：
 *   - 创建员工：admin 在 admin 后台填表 → 调 create-staff-user edge function
 *   - 该 function 内部二次校验 caller 角色，必须 admin
 *
 * 涉及 RLS / API：
 *   - 列举员工：select from users where role in (admin/checker/warehouse/finance)
 *     —— 已有 RLS：admin 能 select 所有（policy: current_user_role() = 'admin'）
 *   - 创建：edge function（service_role 创建 auth.users + 业务 public.users）
 *   - 删除 / 重置密码：客户端对 auth.users 没权限，需要 edge function（暂未实现）
 */
import { ref, type Ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { reportIfInteresting } from '@/lib/sentry'

export type StaffRole = 'admin' | 'checker' | 'warehouse' | 'finance'

export interface StaffMember {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  role: StaffRole
  is_active: boolean   // 由 created_at + last_sign_in_at 推算，简化版本
  created_at: string
  last_sign_in_at: string | null
}

const STAFF_ROLES: StaffRole[] = ['admin', 'checker', 'warehouse', 'finance']

interface UseStaffManagement {
  members: Ref<StaffMember[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  fetchMembers(): Promise<void>
  createMember(input: CreateMemberInput): Promise<{ ok: boolean; userId?: string; error?: string }>
  roles: typeof STAFF_ROLES
}

export interface CreateMemberInput {
  email: string
  password: string
  role: StaffRole
  full_name: string
  phone?: string
}

export function useStaffManagement(): UseStaffManagement {
  const members = ref<StaffMember[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchMembers = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      // 拿 public.users（内部员工）+ auth.users 的 email / last_sign_in_at
      // 用 join + service_role-friendly select：但普通客户端只能 select users，没有 join auth.users 权限
      // 所以分两步：
      //   1. select users where role in staff roles
      //   2. select admin.list via RPC（admin 才能用 auth admin API）—— 此处走 edge function
      // 简化：先用 public.users + email 单独查 auth.users（兼容性最广）
      const { data: rows, error: e } = await supabase
        .from('users')
        .select('id, full_name, phone, role, created_at, updated_at')
        .in('role', [...STAFF_ROLES])
        .order('created_at', { ascending: false })
      if (e) throw e

      // 这里调 getUser() 邮箱：批量可改用 service_role 端的 RPC（MVP 先不做）
      const list = (rows ?? []) as Array<{
        id: string
        full_name: string | null
        phone: string | null
        role: string
        created_at: string
        updated_at: string
      }>
      members.value = list.map((u) => ({
        id: u.id,
        email: null,    // 创建后由 function 回填；MVP 不展示给管理员（避免泄漏）
        full_name: u.full_name,
        phone: u.phone,
        role: u.role as StaffRole,
        is_active: true, // 默认视为 active；删除/禁用留 0026 staff mgmt migration 做
        created_at: u.created_at,
        last_sign_in_at: null,
      }))
    } catch (e: any) {
      error.value = e?.message ?? '拉取员工列表失败'
      reportIfInteresting(e, { phase: 'fetchStaffMembers' })
    } finally {
      loading.value = false
    }
  }

  const createMember = async (input: CreateMemberInput): Promise<{ ok: boolean; userId?: string; error?: string }> => {
    error.value = null
    try {
      // 1. 拿到当前 session 的 JWT（admin 必须已登录；该 function 自己再校一遍）
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        return { ok: false, error: '当前未登录' }
      }

      // 2. 调用 edge function
      const fnUrl = `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/create-staff-user`
      const resp = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify(input),
      })
      const result = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        return { ok: false, error: result?.error ?? `HTTP ${resp.status}` }
      }
      // 3. 成功后刷新列表
      await fetchMembers()
      return { ok: true, userId: result.user_id }
    } catch (e: any) {
      reportIfInteresting(e, { phase: 'createStaffMember', email: input.email })
      return { ok: false, error: e?.message ?? '创建失败' }
    }
  }

  return { members, loading, error, fetchMembers, createMember, roles: STAFF_ROLES }
}
