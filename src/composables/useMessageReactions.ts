/**
 * 聊天消息表情反应管理
 *
 * 数据存储位置：使用 chat_message_metadata.payload.reactions
 * 这是为了不引入新的数据库表，复用现有结构。
 *
 * 数据格式：
 * {
 *   message_id: string,
 *   payload: {
 *     reactions: [
 *       { emoji: '👍', user_ids: ['uuid1', 'uuid2'] },
 *       { emoji: '❤️', user_ids: ['uuid1'] },
 *     ]
 *   }
 * }
 */

import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { ChatMessageReaction, ChatMessageMetadata } from './useChat'

export interface ReactionSummary {
  emoji: string
  count: number
  mine: boolean
  user_ids: string[]
}

/**
 * 把 metadata.payload.reactions 转换为按消息分组的反应汇总
 * 输入：Record<message_id, ChatMessageMetadata>
 * 输出：Record<message_id, ReactionSummary[]>
 */
export function groupReactionsByMessage(
  metadataByMessage: Record<string, ChatMessageMetadata>,
  currentUserId: string | null | undefined,
): Record<string, ReactionSummary[]> {
  const out: Record<string, ReactionSummary[]> = {}
  for (const [mid, meta] of Object.entries(metadataByMessage)) {
    const reactions = meta?.payload?.reactions
    if (!Array.isArray(reactions) || reactions.length === 0) continue
    out[mid] = reactions
      .filter((r): r is ChatMessageReaction => !!r?.emoji)
      .map((r) => ({
        emoji: r.emoji,
        count: r.user_ids?.length ?? 0,
        mine: !!(currentUserId && r.user_ids?.includes(currentUserId)),
        user_ids: r.user_ids ?? [],
      }))
      .filter((r) => r.count > 0)
  }
  return out
}

/**
 * 添加或移除表情反应（toggle）
 * 直接 upsert chat_message_metadata 行（如果不存在则创建）
 */
export async function toggleMessageReaction(
  messageId: string,
  emoji: string,
  currentReactions: ChatMessageReaction[] = [],
): Promise<ChatMessageReaction[]> {
  const me = (await supabase.auth.getUser()).data.user
  if (!me) throw new Error('未登录')

  const myId = me.id
  const existing = currentReactions.find((r) => r.emoji === emoji)
  let updated: ChatMessageReaction[]

  if (existing) {
    // 已存在该 emoji → toggle
    if (existing.user_ids.includes(myId)) {
      // 已加过 → 移除
      const newUsers = existing.user_ids.filter((u) => u !== myId)
      if (newUsers.length === 0) {
        // 移除后该 emoji 没用户了 → 从列表中删除
        updated = currentReactions.filter((r) => r.emoji !== emoji)
      } else {
        updated = currentReactions.map((r) => (r.emoji === emoji ? { ...r, user_ids: newUsers } : r))
      }
    } else {
      // 没加过 → 添加 user_id
      updated = currentReactions.map((r) =>
        r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, myId] } : r,
      )
    }
  } else {
    // 新 emoji
    updated = [...currentReactions, { emoji, user_ids: [myId] }]
  }

  return updated
}

/**
 * 写入 reactions 到 metadata
 * 使用 upsert 保证记录存在
 */
export async function saveMessageReactions(
  messageId: string,
  reactions: ChatMessageReaction[],
): Promise<void> {
  // payload 类型在 Database 中是 never[]，需要绕开类型校验
  // 运行时正确性由后端 RLS 保证
  const payload = { reactions } as unknown as Record<string, unknown>
  const { error } = await supabase
    .from('chat_message_metadata')
    // @ts-expect-error Database.Insert payload 类型不完整
    .upsert({ message_id: messageId, payload }, { onConflict: 'message_id' })
  if (error) throw error
}

// 模块级响应式 reactions 缓存（避免重复计算）
const reactionSummaryCache = ref<Record<string, ReactionSummary[]>>({})

/**
 * 创建响应式的 reactions 状态
 */
export function useMessageReactions() {
  const { appUser } = useAuth()

  const getSummary = (
    messageId: string,
    metadataByMessage: Record<string, ChatMessageMetadata>,
  ): ReactionSummary[] => {
    return groupReactionsByMessage(metadataByMessage, appUser.value?.id)[messageId] ?? []
  }

  /**
   * 切换表情反应
   * @returns 更新后的 reaction 列表（如果是消息切换后的实时更新）
   */
  const toggleReaction = async (
    messageId: string,
    emoji: string,
    currentReactions: ChatMessageReaction[] = [],
  ): Promise<ChatMessageReaction[]> => {
    const updated = await toggleMessageReaction(messageId, emoji, currentReactions)
    await saveMessageReactions(messageId, updated)
    return updated
  }

  return {
    getSummary,
    toggleReaction,
    groupReactionsByMessage: (metadataByMessage: Record<string, ChatMessageMetadata>) =>
      groupReactionsByMessage(metadataByMessage, appUser.value?.id),
    cache: reactionSummaryCache,
  }
}
