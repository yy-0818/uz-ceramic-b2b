-- =====================================================================
-- 0020_chat_phase3.sql
-- Phase 3:
--   1. chat_typing: 对方正在输入... 状态 (短 TTL, 6s)
--   2. rpc_chat_mark_read(conversation, message_id): 精确化已读位点
--      替代客户端分两步:
--        (1) UPDATE chat_conversation_members SET last_read_message_id
--        (2) INSERT chat_message_recipients (per-message read punct)
--   3. RPC 优化 listAdminConversations: 已读位点精确化
--   4. 改进消息搜索: rpc_chat_search_messages(keyword, account_id, order_id)
--      (Phase 3 staff 工作台专用)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. chat_typing
-- ---------------------------------------------------------------------
create table if not exists public.chat_typing (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '6 seconds'),
  primary key (conversation_id, user_id)
);
create index if not exists idx_chat_typing_exp on public.chat_typing (expires_at);

alter table public.chat_typing enable row level security;

drop policy if exists chat_typing_upsert on public.chat_typing;
drop policy if exists chat_typing_select on public.chat_typing;
drop policy if exists chat_typing_delete on public.chat_typing;

-- 写自己
create policy chat_typing_upsert on public.chat_typing
  for insert with check (user_id = auth.uid());

create policy chat_typing_update on public.chat_typing
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy chat_typing_delete on public.chat_typing
  for delete using (user_id = auth.uid());

-- 读: 同一个会话的成员
create policy chat_typing_select on public.chat_typing
  for select using (
    public.is_chat_member_of(conversation_id)
    or public.is_chat_staff()
  );

-- 读取时只显示未过期
-- (TTL 过滤在 SQL/realtime 端做)

-- ---------------------------------------------------------------------
-- 2. RPC: rpc_chat_mark_read
--     一次更新: members.last_read_message_id + 写一条 chat_message_recipients
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_mark_read(
  p_conversation uuid,
  p_message_id   uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  -- 取消息的 created_at + conversation_id 用于位点校验
  select id, conversation_id, sender_id, created_at
    into v_msg
  from public.chat_messages
  where id = p_message_id
  limit 1;
  if v_msg.id is null then
    raise exception 'message not found';
  end if;
  if v_msg.conversation_id <> p_conversation then
    raise exception 'message does not belong to conversation';
  end if;

  -- 写位点 (按消息 id 字典序大等于才更新)
  update public.chat_conversation_members
    set last_read_message_id = p_message_id,
        last_read_at = now()
  where conversation_id = p_conversation
    and user_id = v_uid
    and left_at is null
    and (last_read_message_id is null or last_read_message_id < p_message_id);

  -- 写 per-message read punct (幂等)
  insert into public.chat_message_recipients (message_id, user_id, read_at)
  values (p_message_id, v_uid, now())
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;
end $$;

grant execute on function public.rpc_chat_mark_read(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 升级 rpc_chat_admin_list_conversations: 已读位点精确化
-- ---------------------------------------------------------------------
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
      select distinct on (conversation_id) conversation_id, body, sender_id, created_at
      from public.chat_messages
      where conversation_id in (select id from convs)
        and deleted_at is null
      order by conversation_id, created_at desc
    ), my_member as (
      select conversation_id, last_read_message_id
      from public.chat_conversation_members
      where user_id = v_uid
        and left_at is null
    )
    select
      c.id, c.account_id, c.subject_order_id, c.assigned_to, c.status,
      c.last_message_at, c.created_at, c.updated_at,
      a.account_name::text, a.company_name::text,
      o.order_no::text,
      u.full_name::text,
      lm.body::text, lm.sender_id, lm.created_at,
      -- 精确未读: last_read_message_id 之后 + 自己 sender 排除
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

-- ---------------------------------------------------------------------
-- 4. 消息搜索: rpc_chat_search_messages
--    - staff: 任意
--    - customer: 自己的成员会话
--    - 入参: p_keyword (全文), p_account_id? (可选), p_limit (默认 50)
--    - 搜: chat_messages.body ILIKE '%key%' (Phase 3 简化: 不用全文索引)
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_search_messages(
  p_keyword text,
  p_account_id uuid default null,
  p_limit int default 50
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  message_kind varchar,
  created_at timestamptz,
  account_id uuid,
  account_name text,
  order_no text
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_normalized text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select role into v_role from public.users where id = v_uid;
  v_normalized := trim(coalesce(p_keyword, ''));
  if v_normalized = '' then
    return;
  end if;

  return query
    select
      m.id, m.conversation_id, m.sender_id,
      coalesce(us.full_name, '—')::text,
      m.body::text,
      m.message_kind,
      m.created_at,
      c.account_id,
      coalesce(a.account_name, '—')::text,
      o.order_no::text
    from public.chat_messages m
    join public.chat_conversations c on c.id = m.conversation_id
    left join public.users us on us.id = m.sender_id
    left join public.accounts a on a.id = c.account_id
    left join public.orders o on o.id = c.subject_order_id
    where m.deleted_at is null
      and (
        m.body ilike '%' || v_normalized || '%'
        or o.order_no ilike '%' || v_normalized || '%'
        or a.account_name ilike '%' || v_normalized || '%'
      )
      and (p_account_id is null or c.account_id = p_account_id)
      and (
        -- staff 全看
        v_role in ('admin','checker','finance','warehouse')
        -- customer: 成员限定
        or public.is_chat_member_of(m.conversation_id)
      )
    order by m.created_at desc
    limit p_limit;
end $$;

grant execute on function public.rpc_chat_search_messages(text, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 5. alter publication: chat_typing 进入 realtime
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_typing'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_typing';
  end if;
end $$;
