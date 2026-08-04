/**
 * useSharedAuthUser —— 共享的"当前登录用户"获取
 *
 * 设计原则：能不动网络就不动网络
 * --------------------------------------------------------------
 * Supabase JS SDK 提供三种读取当前用户的方式：
 *   1. `auth.user`              — 同步读内存中 currentUser，可能为空（token 未刷新时）
 *   2. `auth.getSession()`      — 从 localStorage 读 session，**不打网络**（除非 token 即将过期，会顺带触发刷新）
 *   3. `auth.getUser()`         — **每次都打** /auth/v1/user 网络请求（官方故意不缓存，因为禁用/封号等需要实时反映）
 *
 * 本应用场景（聊天、订单、UI 展示用户名/角色）：
 *   - 我们已经登录了，UI 上展示用户名
 *   - 用户角色不会"实时"变化（客服/管理员不会因为一秒钟不发请求就突然变成 customer）
 *   - 即使 session 失效，realtime 也会推送 SIGNED_OUT 事件
 *
 * 所以：优先用 `auth.user`（最快），fallback 到 `auth.getSession()`（不打 /user）。
 * 仅当两者都没值时，**才**退到 `getUser()`（确认 token 有效性）。
 *
 * 缓存策略：
 *   - TTL 60 秒（足以覆盖"打开会话 + 加载消息 + 标记已读 + typing + heartbeat"一连串并发）
 *   - in-flight 复用：同一 tick 并发只发 1 次
 *   - 监听 onAuthStateChange：登录/登出/token 刷新时立即清缓存
 *
 * 对服务器的影响：
 *   - /auth/v1/user 在 60 秒内 0 次请求
 *   - /auth/v1/token（refresh）由 supabase-js 自动管理（30s tick 一次），不受我们影响
 */

import { supabase } from '@/lib/supabase'

const CURRENT_USER_TTL_MS = 60_000

let currentUserCache: { user: any | null; timestamp: number } | null = null
let currentUserInFlight: Promise<any | null> | null = null
let listenerInitialized = false

interface AuthLike {
  user: any | null
  getSession: () => Promise<{ data: { session: { user: any } | null } }>
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
    const { data } = auth.onAuthStateChange((_event, session) => {
      // 收到新的 session 事件：用回调里的 session.user 直接更新缓存（不再调 getUser）
      // - SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION → session 里有最新 user
      // - SIGNED_OUT → session 为 null → 清缓存
      if (session?.user) {
        currentUserCache = { user: session.user, timestamp: Date.now() }
        currentUserInFlight = null
      } else {
        currentUserCache = null
        currentUserInFlight = null
      }
    })
    void data?.subscription
  } catch {
    // 旧版本 SDK 静默忽略
  }
}

/**
 * 获取当前登录用户（优先内存 → session storage → 仅最后才打 /auth/v1/user）
 *  - 缓存命中：直接返回，0 网络
 *  - auth.user 命中：0 网络
 *  - auth.getSession() 命中：最多 1 次本地 storage 读（不打 /user）
 *  - 兜底 getUser()：仅前面都失败时打 1 次 /auth/v1/user
 */
export async function getCurrentUser(): Promise<any | null> {
  initAuthListenerOnce()
  const auth = (supabase as any).auth as AuthLike

  // 1. 缓存命中
  if (currentUserCache && Date.now() - currentUserCache.timestamp < CURRENT_USER_TTL_MS) {
    return currentUserCache.user
  }

  // 2. 内存 currentUser（同步、零网络）
  if (auth.user) {
    currentUserCache = { user: auth.user, timestamp: Date.now() }
    return auth.user
  }

  // 3. in-flight 复用
  if (currentUserInFlight) return currentUserInFlight

  currentUserInFlight = (async () => {
    try {
      // 4. session 读 localStorage（不打 /user）
      try {
        const { data } = await auth.getSession()
        if (data?.session?.user) {
          currentUserCache = { user: data.session.user, timestamp: Date.now() }
          return data.session.user
        }
      } catch {
        /* ignore */
      }
      // 5. 最后兜底：才打 /auth/v1/user
      const { data } = await auth.getUser()
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
 * 主动清空当前用户缓存（登录/登出时安全冗余）
 */
export function invalidateCurrentUserCache(): void {
  currentUserCache = null
  currentUserInFlight = null
}

// ---------------------------------------------------------------------
// heartbeat 节流（防止多组件各自跑 setInterval 反复打同一个心跳）
//  - ChatWindow / ChatListPage / StaffChatWorkspacePage 都启 timer
//  - 仅让"距离上次心跳 >= 25 秒"的请求真去打 DB
//  - 模块级锁：跨 useChat() 实例共享
// ---------------------------------------------------------------------
const HEARTBEAT_MIN_INTERVAL_MS = 25_000
let lastHeartbeatAt = 0
let lastHeartbeatInFlight: Promise<void> | null = null

/**
 * 调度一次心跳。节流：25 秒内多次调用复用同一次结果
 */
export function throttledHeartbeat(doHeartbeat: () => Promise<void>): Promise<void> {
  const now = Date.now()
  if (lastHeartbeatInFlight) return lastHeartbeatInFlight
  if (now - lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS) {
    // 在节流窗口内：跳过
    return Promise.resolve()
  }
  lastHeartbeatInFlight = doHeartbeat().finally(() => {
    lastHeartbeatAt = Date.now()
    lastHeartbeatInFlight = null
  })
  return lastHeartbeatInFlight
}