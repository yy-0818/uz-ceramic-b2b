/**
 * Supabase 客户端单例
 *
 * - 环境变量缺失时返回一个禁用桩 client，并把原因暴露为 `bootstrapError`，
 *   这样登录页 / 路由守卫能呈现友好提示而不是白屏。
 * - Vercel 部署前必须在 Project Settings → Environment Variables 配置：
 *     VITE_SUPABASE_URL
 *     VITE_SUPABASE_ANON_KEY
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const bootstrapError: string | null =
  !url || !anonKey
    ? `缺少 Supabase 环境变量：${!url ? 'VITE_SUPABASE_URL ' : ''}${!anonKey ? 'VITE_SUPABASE_ANON_KEY' : ''}。请在 Vercel 项目 Settings → Environment Variables 配置后重新部署。`
    : null

let _client: SupabaseClient<Database> | null = null

function makeClient(): SupabaseClient<Database> {
  // createClient 在 url/key 缺失时会抛 InvalidSchemeError —— 把它挡在模块外
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

/**
 * 桩 client：任何调用都会返回 `{ data: null, error: { message: 'Supabase 未配置' } }`
 * 保证 UI 不崩溃，只在 UI 里显式展示提示。
 */
function makeStub(): SupabaseClient<Database> {
  const missing = bootstrapError ?? 'Supabase 未配置'
  const err = { name: 'ConfigError', message: missing } as any
  return new Proxy({} as SupabaseClient<Database>, {
    get(_t, prop) {
      // 允许访问 .auth / .from 等任链式属性 —— 返回另一个 stub
      if (prop === 'auth') {
        return new Proxy({}, {
          get(_t, p) {
            if (p === 'getSession' || p === 'getUser') {
              return async () => ({ data: { session: null, user: null }, error: null })
            }
            return () => Promise.resolve({ data: null, error: err })
          },
        })
      }
      return () => new Proxy({}, { get: () => () => Promise.resolve({ data: null, error: err }) })
    },
  })
}

if (!bootstrapError) {
  _client = makeClient()
}

export const supabase: SupabaseClient<Database> = _client ?? (makeStub() as SupabaseClient<Database>)

export const isSupabaseConfigured = !bootstrapError