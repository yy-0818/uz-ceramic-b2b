-- =====================================================================
-- 0023_notifications.sql
-- Phase 5: 站内通知中心
--   1. notifications 表 (id, user_id, kind, title, body, link, payload, read_at, created_at)
--      - user_id = 接收方
--      - kind: 'chat_message' | 'order_status' | 'staff_assigned' | 'staff_transferred'
--   2. 触发器:
--      - 订单状态变更 → 写通知给账号 owner + 关联客服 (M4 同步用, 但 notifications 单独写)
--      - 新聊天消息 → 给非 sender 的 conversation members 写通知
--   3. RPC:
--      - rpc_notifications_list(limit, only_unread) → 列表
--      - rpc_notifications_unread_count() → 数字
--      - rpc_notifications_mark_read(id) → 标记单条
--      - rpc_notifications_mark_all_read() → 全标
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 表
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        varchar(32) not null
                check (kind in ('chat_message','order_status','staff_assigned','staff_transferred','system')),
  title       text not null,
  body        text not null default '',
  link        text,                -- 跳转: /chat?conversation=xxx 或 /orders/xxx
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists notif_self_select on public.notifications;
create policy notif_self_select on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notif_self_update on public.notifications;
create policy notif_self_update on public.notifications
  for update using (user_id = auth.uid())
                with check (user_id = auth.uid());

drop policy if exists notif_self_delete on public.notifications;
create policy notif_self_delete on public.notifications
  for delete using (user_id = auth.uid());

-- 写权限: service role + 触发器 (security definer)
drop policy if exists notif_insert on public.notifications;
-- 不开 insert policy: 只能通过 RPC / 触发器写

-- ---------------------------------------------------------------------
-- 3. 触发器 1: 订单状态变更 → 通知
-- ---------------------------------------------------------------------
create or replace function public.fn_order_status_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_user record;
  v_title text;
  v_body text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_label := case new.status
    when 'pending'   then '已提交待审'
    when 'audited'   then '已审核'
    when 'accounted' then '已记账'
    when 'shipped'   then '已发货'
    when 'cancelled' then '已取消'
    else new.status
  end;

  v_title := format('📦 订单 #%s', new.order_no);
  v_body  := format('订单状态: %s', v_label);

  -- 客户: order.owner_id (account 归属 user)
  for v_user in
    select distinct u.id as user_id
    from public.orders o
    join public.accounts a on a.id = o.account_id
    join public.users u on u.id = a.owner_id
    where o.id = new.id
  loop
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      v_user.user_id,
      'order_status',
      v_title,
      v_body,
      format('/orders/%s', new.id),
      jsonb_build_object(
        'order_id', new.id,
        'order_no', new.order_no,
        'from_status', old.status,
        'to_status', new.status
      )
    );
  end loop;

  -- 客服: 任何 staff (assignee or member of conversation)
  for v_user in
    select distinct u.id as user_id
    from public.chat_conversations c
    join public.chat_conversation_members m on m.conversation_id = c.id and m.left_at is null
    join public.users u on u.id = m.user_id
    where c.subject_order_id = new.id
      and u.id <> coalesce(new.owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and u.role in ('admin','checker','finance','warehouse')
  loop
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      v_user.user_id,
      'order_status',
      v_title,
      v_body,
      format('/orders/%s', new.id),
      jsonb_build_object(
        'order_id', new.id,
        'order_no', new.order_no,
        'from_status', old.status,
        'to_status', new.status
      )
    );
  end loop;

  return new;
end $$;

drop trigger if exists trg_order_status_notify on public.orders;
create trigger trg_order_status_notify
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.fn_order_status_notify();

-- ---------------------------------------------------------------------
-- 4. 触发器 2: 新聊天消息 → 给非 sender 的 members 写通知
-- ---------------------------------------------------------------------
create or replace function public.fn_chat_message_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_sender_name text;
  v_body_preview text;
begin
  -- 系统消息不再发通知 (避免重复: 状态已写一次了)
  if new.message_type = 'system' then
    return new;
  end if;

  select coalesce(full_name, '客服') into v_sender_name
  from public.users where id = new.sender_id;

  v_body_preview := case
    when new.message_kind = 'image' then '[图片]'
    when new.message_kind = 'order_card' then '[订单卡片]'
    else substr(new.body, 1, 80)
  end;

  for v_member in
    select distinct user_id
    from public.chat_conversation_members
    where conversation_id = new.conversation_id
      and left_at is null
      and user_id <> new.sender_id
  loop
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      v_member.user_id,
      'chat_message',
      v_sender_name,
      v_body_preview,
      format('/chat?conversation=%s', new.conversation_id),
      jsonb_build_object(
        'conversation_id', new.conversation_id,
        'message_id', new.id,
        'message_kind', new.message_kind
      )
    );
  end loop;

  return new;
end $$;

drop trigger if exists trg_chat_message_notify on public.chat_messages;
create trigger trg_chat_message_notify
  after insert on public.chat_messages
  for each row
  execute function public.fn_chat_message_notify();

-- ---------------------------------------------------------------------
-- 5. RPC: list / unread_count / mark_read / mark_all_read
-- ---------------------------------------------------------------------
create or replace function public.rpc_notifications_list(
  p_limit     int default 50,
  p_only_unread boolean default false
)
returns table (
  id          uuid,
  kind        varchar,
  title       text,
  body        text,
  link        text,
  payload     jsonb,
  read_at     timestamptz,
  created_at  timestamptz
)
language sql stable security invoker set search_path = public as $$
  select id, kind, title, body, link, payload, read_at, created_at
  from public.notifications
  where user_id = auth.uid()
    and (not p_only_unread or read_at is null)
  order by created_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.rpc_notifications_list(int, boolean) to authenticated;

create or replace function public.rpc_notifications_unread_count()
returns int
language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;

grant execute on function public.rpc_notifications_unread_count() to authenticated;

create or replace function public.rpc_notifications_mark_read(p_id uuid)
returns void
language sql security invoker set search_path = public as $$
  update public.notifications
  set read_at = now()
  where id = p_id and user_id = auth.uid() and read_at is null;
$$;

grant execute on function public.rpc_notifications_mark_read(uuid) to authenticated;

create or replace function public.rpc_notifications_mark_all_read()
returns int
language sql security invoker set search_path = public as $$
  with upd as (
    update public.notifications
    set read_at = now()
    where user_id = auth.uid() and read_at is null
    returning 1
  )
  select count(*)::int from upd;
$$;

grant execute on function public.rpc_notifications_mark_all_read() to authenticated;
