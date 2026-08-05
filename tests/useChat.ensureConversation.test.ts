/**
 * useChat.ensureConversation 并发 dedup + 幂等 insert 测试
 *
 * 背景：原代码没 dedup + member 直接 insert，导致 ChatWindow + ChatPanel
 * 同时挂载 / admin 切换账号时插入同一 (conv, user) 触发 23505 (uq_chat_member_user)。
 *
 * 修复：
 *   - 同 (account, subject) 并发 → 复用同一 promise
 *   - member insert → 改 upsert (onConflict: 'conversation_id,user_id') 幂等
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用 fake SDK 直接驱动 useChat 内部的 ensureConversation 路径
let convSelectCalls = 0
let convInsertCalls = 0
let memberInsertCalls = 0
let memberUpsertCalls = 0
let nextConvSelectResult: { data: any; error: any } = { data: null, error: null }
let nextConvInsertError: { code: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'u1', email: 'staff@test.local' } },
        error: null,
      })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    from: (table: string) => {
      if (table === 'chat_conversations') {
        return {
          // select chain: .select().eq().eq().is()
          select: () => {
            convSelectCalls++
            // 构造链式对象
            const chain: any = {
              eq: () => chain,
              is: () => chain,
              maybeSingle: vi.fn(async () => {
                return Promise.resolve(nextConvSelectResult)
              }),
            }
            return chain
          },
          insert: () => {
            convInsertCalls++
            return {
              select: () => ({
                single: vi.fn(async () => {
                  if (nextConvInsertError) {
                    return { data: null, error: nextConvInsertError }
                  }
                  return {
                    data: { id: 'conv-1', account_id: 'a1', subject_order_id: 'o1', status: 'open' },
                    error: null,
                  }
                }),
              }),
            }
          },
        }
      }
      if (table === 'chat_conversation_members') {
        return {
          insert: () => {
            memberInsertCalls++
            return Promise.resolve({ error: { code: '23505', message: 'dup' } })
          },
          upsert: (_rows: any, _opts: any) => {
            memberUpsertCalls++
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn(async () => ({ data: { role: 'admin' }, error: null })),
            }),
          }),
        }
      }
      throw new Error(`unmocked table ${table}`)
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    channel: () => ({
      on: () => ({ on: () => ({ on: () => ({ subscribe: vi.fn() }) }) }),
      subscribe: vi.fn(),
    }),
    removeChannel: vi.fn(),
  },
}))

// 必须在 mock 之后 import
import { useChat, clearChatCache } from '@/composables/useChat'

describe('useChat.ensureConversation (race fix)', () => {
  beforeEach(() => {
    convSelectCalls = 0
    convInsertCalls = 0
    memberInsertCalls = 0
    memberUpsertCalls = 0
    nextConvSelectResult = { data: null, error: null }
    nextConvInsertError = null
    clearChatCache()
  })

  it('1. dedups 3 concurrent calls into 1 real conv + 1 real member operation', async () => {
    const chat = useChat()
    const [a, b, c] = await Promise.all([
      chat.ensureConversation({ account_id: 'a1', subject_order_id: 'o1' }),
      chat.ensureConversation({ account_id: 'a1', subject_order_id: 'o1' }),
      chat.ensureConversation({ account_id: 'a1', subject_order_id: 'o1' }),
    ])

    // dedup：3 个返回同一个对象引用（共享同一 promise）
    expect(a).toBe(b)
    expect(b).toBe(c)

    // 关键：只有一次真实写
    expect(convInsertCalls).toBeLessThanOrEqual(1)
    // 关键：成员必须走 upsert，不是 plain insert（避免 23505 race）
    expect(memberInsertCalls).toBe(0)
    expect(memberUpsertCalls).toBeLessThanOrEqual(1)
  })

  it('2. uses upsert for chat_conversation_members (idempotent, no 23505)', async () => {
    const chat = useChat()
    await chat.ensureConversation({ account_id: 'a2', subject_order_id: 'o2' })

    expect(memberInsertCalls).toBe(0)
    expect(memberUpsertCalls).toBeGreaterThanOrEqual(1)
  })

  it('3. different (account, subject) keys do NOT dedup together', async () => {
    const chat = useChat()
    await Promise.all([
      chat.ensureConversation({ account_id: 'a3', subject_order_id: 'o3' }),
      chat.ensureConversation({ account_id: 'a4', subject_order_id: 'o4' }),
    ])

    // 不同 key 应各自独立执行一次 conv insert
    expect(convInsertCalls).toBe(2)
  })
})
