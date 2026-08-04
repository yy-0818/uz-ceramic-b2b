/**
 * useSharedAuthUser —— 共享的"当前登录用户"缓存
 *
 * 为什么需要这个：
 *  supabase JS SDK 的 `supabase.auth.getUser()` 每次调用都会**实际发起 HTTP 请求**
 *  （不像 `auth.user`/`auth.session()` 那样从本地内存读）。
 *  Supabase auth 后端是 /auth/v1/user，会校验 token 有效性。
 *
 *  在 chat 等高频场景下，多个函数都会查当前用户（fetchConversations / sendMessage /
 *  notifyTyping / heartbeat / 等），每次都打 /auth/v1/user 不仅慢，还造成重复请求。
 *
 * 解决方案：
 *  - 5 秒缓存：避免短期重复请求
 *  - in-flight 复用：同一 tick 的并发只发 1 次
 *  - 监听 onAuthStateChange：登录/登出/token 刷新时立即清缓存
 */

import { supabase } from '@/lib/supabase'

const CURRENT_USER_TTL_MS = 5_000

let currentUserCache: { user: any | null; timestamp: number } | null = null
let currentUserInFlight: Promise<any | null> | null = null
let listenerInitialized = false

interface AuthLike {
  getUser: () => Promise<{ data: { user: any | null } }>
  onAuthStateChange: (cb: (event: string, session: any) => void) => {
    data: { subscription: { unsubscribe: () => void } }
  }
}

function initAuthListenerOnce(): void {
  if (listenerInitialized) return
  listenerInitialized = true
  try {
    const auth = (supabase as any).auth as AuthLike
    const { data } = auth.onAuthStateChange(() => {
      // 登录/登出/token 刷新：清缓存
      currentUserCache = null
      currentUserInFlight = null
    })
    // 注意：模块级单例，进程生命周期内有效，不主动 unsubscribe
    void data?.subscription
  } catch {
    // 旧版本 SDK 可能没有 onAuthStateChange，静默忽略
  }
}

/**
 * 获取当前登录用户，带 5 秒缓存 + in-flight 去重
 *  - 多次同时调用只会发 1 次 /auth/v1/user
 *  - 5 秒内复用缓存结果
 *  - 监听 auth 状态变更后立即失效
 */
export async function getCurrentUser(): Promise<any | null> {
  initAuthListenerOnce()

  // 缓存命中
  if (currentUserCache && Date.now() - currentUserCache.timestamp < CURRENT_USER_TTL_MS) {
    return currentUserCache.user
  }
  // in-flight 复用
  if (currentUserInFlight) {
    return currentUserInFlight
  }
  currentUserInFlight = (async () => {
    try {
      const { data } = await supabase.auth.getUser()
      const u = data?.user ?? null
      currentUserCache = { user: u, timestamp: Date.now() }
      return u
    } finally {
      currentUserInFlight = null
    }
  })()
  return currentUserInFlight
}

/**
 * 主动清空当前用户缓存（登录/登出时调用，安全冗余）
 */
export function invalidateCurrentUserCache(): void {
  currentUserCache = null
  currentUserInFlight = null
}
