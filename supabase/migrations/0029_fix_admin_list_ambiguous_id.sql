-- =====================================================================
-- 0029_fix_admin_list_ambiguous_id.sql
-- 报: column reference "id" is ambiguous
-- 原因: 子查询 (m.conversation_id = c.id) 在 PL/pgSQL + security
--       definer + set search_path 组合下, Postgres 解析"id"时, 把
--       外层 c.id 暴露给 convs CTE 的 c.* 的列展开后, 在子查询
--       WHERE 子句里遇到未限定的 id 时报模糊。
-- 修法: 子查询里所有列(c.id) 全部限定, 并把外层 SELECT 列表的列
--       全部明确限定; 同时把变量 v_uid 加别名保护, 避免被
--       PL/pgSQL 与字段名混淆。
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
  v_uid_text text := auth.uid()::text;  -- 防止 PL/pgSQL 变量名与列名冲突
begin
  if not public.is_chat_staff() then
    raise exception 'staff only';
  end if;

  return query
    with convs as (
      select
        cc.id, cc.account_id, cc.subject_order_id, cc.assigned_to, cc.status,
        cc.last_message_at, cc.created_at, cc.updated_at
      from public.chat_conversations cc
      where (p_status is null or cc.status = p_status)
      order by cc.last_message_at desc nulls last
      limit p_limit offset p_offset
    ), last_msg as (
      select distinct on (lm_inner.conversation_id)
        lm_inner.conversation_id,
        lm_inner.body,
        lm_inner.sender_id,
        lm_inner.created_at as lm_at
      from public.chat_messages lm_inner
      where lm_inner.conversation_id in (select convs.id from convs)
        and lm_inner.deleted_at is null
      order by lm_inner.conversation_id, lm_inner.created_at desc
    ), my_member as (
      select mm_inner.conversation_id, mm_inner.last_read_message_id
      from public.chat_conversation_members mm_inner
      where mm_inner.user_id = v_uid
        and mm_inner.left_at is null
    )
    select
      convs.id, convs.account_id, convs.subject_order_id, convs.assigned_to, convs.status,
      convs.last_message_at, convs.created_at, convs.updated_at,
      a.account_name::text, a.company_name::text,
      o.order_no::text,
      u.full_name::text,
      lm.body::text, lm.sender_id, lm.lm_at,
      (
        select count(*)
        from public.chat_messages m
        where m.conversation_id = convs.id
          and m.sender_id <> v_uid
          and m.deleted_at is null
          and (mm.last_read_message_id is null or m.id > mm.last_read_message_id)
      )::bigint
    from convs
    left join public.accounts a on a.id = convs.account_id
    left join public.orders  o on o.id = convs.subject_order_id
    left join public.users   u on u.id = convs.assigned_to
    left join last_msg       lm on lm.conversation_id = convs.id
    left join my_member      mm on mm.conversation_id = convs.id;
end $$;

grant execute on function public.rpc_chat_admin_list_conversations(varchar, int, int) to authenticated;
