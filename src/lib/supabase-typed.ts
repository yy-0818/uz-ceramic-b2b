/**
 * Supabase 类型扩展
 *
 * 问题：Supabase JS SDK 2.x 官方类型对 'postgres_changes' 事件的回调参数类型定义不完整，
 * 需要使用类型断言来提供类型安全。
 *
 * 本模块提供类型安全的辅助函数
 */

import type { Database } from '@/types/database'
export type { Database }

export { supabase } from '@/lib/supabase'

// Supabase Realtime postgres_changes 回调类型
export type PostgresChangesCallback<T> = (payload: { new: T; old?: T }) => void

// 类型安全的 postgres_changes 订阅选项创建函数
export function createPostgresChangesOptions<T>(options: {
  event: string
  schema: string
  table: string
  filter?: string
}): { event: string; schema: string; table: string; filter?: string } {
  return options
}
