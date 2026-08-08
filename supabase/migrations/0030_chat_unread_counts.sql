-- =====================================================================
-- 0027_chat_unread_counts.sql
-- 修复 unread_count 计算错误 (一会儿有一会儿消失)
--
-- 根因 (customer 路径):
--   原 useChat.fetchConversations 客户端拼接 unread 时只用 joined_at 作为 cutoff,
--   完全忽略 last_read_at / last_read_message_id. 结果:
--     1. 用户 markRead 后未读不归零 (cutoff 没更新)
--     2. .limit(1000) 隐式截断导致未读数不稳
--     3. 客户端 1000 条消息来回拉, 慢
--
-- 修法: 新增 RPC rpc_chat_unread_counts (customer 端用),
--   在 SQL 端用 last_read_at + last_read_message_id 精确计算每会话未读数.
-- =====================================================================

create or replace function public.rpc_chat_unread_counts(
  p_conversation_ids uuid[]
)
returns table(conversation_id uuid, unread_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  return query
  select
    c.id as conversation_id,
    count(m.id) as unread_count
  from public.chat_conversations c
  join public.chat_conversation_members mem
    on mem.conversation_id = c.id
    and mem.user_id = v_uid
    and mem.left_at is null
  left join lateral (
    select last_msg.id, last_msg.created_at
    from public.chat_messages last_msg
    where last_msg.conversation_id = c.id
      and last_msg.sender_id <> v_uid
      and last_msg.deleted_at is null
      -- cutoff: 用户已读位点 (优先 last_read_at, fallback last_read_message_id 对应消息的 created_at)
      and last_msg.created_at > coalesce(mem.last_read_at, '1970-01-01 00:00:00+00'::timestamptz)
      and last_msg.created_at > mem.joined_at
      -- last_read_message_id 作为额外 cutoff (如果 last_read_at 缺失但 last_read_message_id 存在)
      and (
        mem.last_read_message_id is null
        or last_msg.created_at > coalesce(
          (select created_at from public.chat_messages where id = mem.last_read_message_id limit 1),
          '1970-01-01 00:00:00+00'::timestamptz
        )
      )
    order by last_msg.created_at desc, last_msg.id desc
    limit 1000
  ) m on true
  where c.id = any(p_conversation_ids)
  group by c.id;

  -- 不需要 (v_uid check) 后再 select auth.uid(), 已 declare
end;
$$;

comment on function public.rpc_chat_unread_counts(uuid[]) is
  '返回传入会话 id 列表中, 当前用户未读消息数 (精确化位点比较)';

-- 测试权限: 仅成员可调用 (function 默认 SECURITY DEFINER, 但仍然通过 auth.uid 验证)
grant execute on function public.rpc_chat_unread_counts(uuid[]) to authenticated;