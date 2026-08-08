-- =====================================================================
-- 0028_fix_admin_list_ambiguous.sql
-- 修复 rpc_chat_admin_list_conversations 报:
--   "column reference 'created_at' is ambiguous"
-- 原因: PL/pgSQL 函数体内子查询 (select count(*) from chat_messages m)
--       在外层 SELECT 同时引用 lm.created_at, 导致 Postgres planner
--       在解析子查询的关联列时, 误以为 created_at 既可能来自
--       lm (last_msg CTE) 又可能来自 m (子查询别名), 触发 42702。
-- 修法: 子查询内的关联列加表别名 m. (虽然已经加了), 并把外层
--       SELECT 列表里所有列加限定, 并把 CTE 里的 created_at 用别名,
--       完全消除歧义。
-- =====================================================================

create or replace function public.rpc_chat_admin_list_conversations(
  p_status varchar default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  account_id uuid,
  subject_order_id uuid,
  assigned_to uuid,
  status varchar,
  last_message_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  account_name text,
  company_name text,
  order_no text,
  assigned_name text,
  last_message_body text,
  last_message_sender uuid,
  last_message_at_actual timestamptz,
  unread_for_me bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_chat_staff() then
    raise exception 'staff only';
  end if;

  return query
    with convs as (
      select c.*
      from public.chat_conversations c
      where (p_status is null or c.status = p_status)
      order by c.last_message_at desc nulls last
      limit p_limit offset p_offset
    ), last_msg as (
      -- 用 lm_at 别名, 避免和子查询关联列冲突
      select distinct on (lm_inner.conversation_id)
        lm_inner.conversation_id,
        lm_inner.body,
        lm_inner.sender_id,
        lm_inner.created_at as lm_at
      from public.chat_messages lm_inner
      where lm_inner.conversation_id in (select id from convs)
        and lm_inner.deleted_at is null
      order by lm_inner.conversation_id, lm_inner.created_at desc
    ), my_member as (
      select mm_inner.conversation_id, mm_inner.last_read_message_id
      from public.chat_conversation_members mm_inner
      where mm_inner.user_id = v_uid
        and mm_inner.left_at is null
    )
    select
      c.id, c.account_id, c.subject_order_id, c.assigned_to, c.status,
      c.last_message_at, c.created_at, c.updated_at,
      a.account_name::text, a.company_name::text,
      o.order_no::text,
      u.full_name::text,
      lm.body::text, lm.sender_id, lm.lm_at,
      (
        select count(*)
        from public.chat_messages m
        where m.conversation_id = c.id
          and m.sender_id <> v_uid
          and m.deleted_at is null
          and (mm.last_read_message_id is null or m.id > mm.last_read_message_id)
      )::bigint
    from convs c
    left join public.accounts a on a.id = c.account_id
    left join public.orders  o on o.id = c.subject_order_id
    left join public.users   u on u.id = c.assigned_to
    left join last_msg       lm on lm.conversation_id = c.id
    left join my_member      mm on mm.conversation_id = c.id;
end $$;

grant execute on function public.rpc_chat_admin_list_conversations(varchar, int, int) to authenticated;
