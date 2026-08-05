/**
 * Sentry 监控接入 —— 错误 + 性能
 *
 * 接入策略：
 *  - 在 main.ts 顶部最先初始化 Sentry（拿全 early error / unhandled rejection）
 *  - 用 lazy load：只取用得到的 plugin
 *  - 通过 `import.meta.env.VITE_SENTRY_DSN` 启用，没配置时 Sentry 全局 noop
 *  - VITE_SENTRY_ENVIRONMENT 区分 dev / preview / production
 *  - 性能采样：replays 0.1（录制用户操作），performance 0.2
 *  - 上线前必须把 DSN 配置到 Vercel / .env
 *
 * 注：开发环境默认关掉 Sentry（看 console 反而方便）。要开发时打开：
 *      localStorage.setItem('app:sentry-debug', '1')
 *      // 然后刷新页面
 */
import * as Sentry from '@sentry/vue'

interface InitOptions {
  app: import('vue').App
  router: import('vue-router').Router
}

let initialized = false

export function initSentry({ app, router }: InitOptions): void {
  if (initialized) return
  const dsn = (import.meta.env.VITE_SENTRY_DSN ?? '').trim()
  const environment = (import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE ?? 'development').trim()
  const release = (import.meta.env.VITE_SENTRY_RELEASE ?? '').trim() || undefined

  if (!dsn) {
    // 没有 DSN 时 dev-only console 提示（用户主动开启 debug 时显示）
    if (typeof localStorage !== 'undefined' && localStorage.getItem('app:sentry-debug') === '1') {
      // eslint-disable-next-line no-console
      console.warn('[sentry] VITE_SENTRY_DSN 未配置，Sentry 已禁用')
    }
    return
  }

  const isDev = environment === 'development'

  Sentry.init({
    app,
    dsn,
    environment,
    release,
    // 性能采样
    tracesSampleRate: isDev ? 1.0 : 0.2,
    // 用户操作录制（鼠标移动 / 点击 / 输入）
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: isDev ? 0 : 0.1,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: true,
      }),
    ],
    // 不上报 console.log 等
    ignoreErrors: [
      // 业务预期的错误，不要噪音
      /^NetworkError/,
      /^AbortError/,
      // ResizeObserver 浏览器自带噪音
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
    beforeSendTransaction(event) {
      // 去掉长期轮询的噪音（heartbeat / polling），但保留错误
      if (event.transaction === 'heartbeat' || event.transaction === 'fetchConversations') {
        return null
      }
      return event
    },
    // 生产模式加上 sourcemap（开发模式已有 in-browser sourcemap）
    enabled: !isDev || localStorage.getItem('app:sentry-debug') === '1',
  })

  initialized = true
}

/** 业务侧主动上报错误 */
export function reportError(error: unknown, context?: Record<string, any>): void {
  if (!initialized) return
  Sentry.captureException(error, { extra: context })
}

/** 主动上报消息 */
export function reportMessage(msg: string, context?: Record<string, any>): void {
  if (!initialized) return
  Sentry.captureMessage(msg, { extra: context })
}

/** 设置 user context (登录后调用) */
export function setUserContext(user: { id: string; email?: string; role?: string } | null): void {
  if (!initialized) return
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email, role: user.role })
  } else {
    Sentry.setUser(null)
  }
}

/**
 * Supabase PostgREST / RPC 错误分类。
 * 业务侧调用：
 *   const { error } = await supabase.from(...).select(...)
 *   if (error) reportError(error, { sql: 'orders.select' })
 *
 * 过滤规则（保守）：
 *   - 401 / 403 不报：未授权是预期内
 *   - 23505 (unique_violation) / 23503 (foreign_key) 不报：业务冲突
 *   - 42501 (RLS) 不报
 *   - 网络 / AbortError 不报：用户/网络行为
 *   - 其他上报
 */
export function isReportableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string; status?: number }
  const code = e.code
  const msg = String(e.message || '')
  if (/AbortError|NetworkError|Failed to fetch|Load failed/i.test(msg)) return false
  if (e.status === 401 || e.status === 403) return false
  if (code === 'PGRST301' || code === '42501') return false
  if (code === '23505' || code === '23503' || code === '23502') return false
  return true
}

/**
 * 智能上报：先按 isReportableError 过滤
 */
export function reportIfInteresting(error: unknown, context?: Record<string, any>): void {
  if (!isReportableError(error)) return
  reportError(error, context)
}
