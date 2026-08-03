-- =====================================================================
-- 0022_chat_system_messages.sql
-- Phase 4: 订单状态变更 → 自动写系统消息
--   1. fn_chat_post_system_message(conversation_id, body)
--      - 在该会话里 insert 一条 message_kind='system' / message_type='system'
--      - 由 trigger / RPC 调用
--   2. fn_order_status_chat_notify()  trigger on orders
--      - status 变化时: 给该 order 关联的 chat_conversations 各写一条 system 消息
--      - 内容根据 status 给本地化文案 (zh)
--   3. rpc_chat_post_system_message(conversation_id, body)
--      - 公开 RPC, 允许 staff 手动补一句系统消息
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fn_chat_post_system_message (内部)
-- ---------------------------------------------------------------------
create or replace function public.fn_chat_post_system_message(
  p_conversation uuid,
  p_body         text,
  p_meta         jsonb default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_msg_id uuid;
begin
  if p_conversation is null then
    raise exception 'conversation_id is null';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'body is empty';
  end if;

  insert into public.chat_messages (
    conversation_id,
    sender_id,
    message_type,
    message_kind,
    body,
    client_message_id
  )
  values (
    p_conversation,
    auth.uid(),
    'system',
    'text',
    p_body,
    gen_random_uuid()
  )
  returning id into v_msg_id;

  if p_meta is not null then
    insert into public.chat_message_metadata (message_id, payload)
    values (v_msg_id, p_meta)
    on conflict (message_id) do update set payload = excluded.payload, updated_at = now();
  end if;

  -- 触发言会话的 last_message_at
  update public.chat_conversations
    set last_message_at = now()
  where id = p_conversation;

  return v_msg_id;
end $$;

comment on function public.fn_chat_post_system_message(uuid, text, jsonb) is
  '在指定会话写入一条系统消息 (sender=auth.uid, message_type=system, message_kind=text).';

-- ---------------------------------------------------------------------
-- 2. fn_order_status_chat_notify trigger
-- ---------------------------------------------------------------------
create or replace function public.fn_order_status_chat_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_conv record;
  v_label text;
  v_body text;
  v_meta jsonb;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  -- 状态本地化文案 (zh). 后续可由前端 i18n 覆盖
  v_label := case new.status
    when 'pending'  then '已提交待审'
    when 'audited'  then '已审核'
    when 'accounted' then '已记账'
    when 'shipped'  then '已发货'
    when 'cancelled' then '已取消'
    else new.status
  end;

  v_body := format('📦 订单 #%s 状态更新: %s', new.order_no, v_label);
  v_meta := jsonb_build_object(
    'kind', 'order_status',
    'order_id', new.id,
    'order_no', new.order_no,
    'from_status', old.status,
    'to_status', new.status,
    'changed_at', now()
  );

  for v_conv in
    select id from public.chat_conversations
    where subject_order_id = new.id
      and status = 'open'
  loop
    perform public.fn_chat_post_system_message(v_conv.id, v_body, v_meta);
  end loop;

  return new;
end $$;

drop trigger if exists trg_order_status_chat_notify on public.orders;
create trigger trg_order_status_chat_notify
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.fn_order_status_chat_notify();

-- ---------------------------------------------------------------------
-- 3. rpc_chat_post_system_message (公开, 供 staff 手工调用)
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_post_system_message(
  p_conversation uuid,
  p_body         text,
  p_meta         jsonb default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select role into v_role from public.users where id = v_uid;
  if v_role is null or v_role in ('customer','fin_customer') then
    raise exception 'staff only';
  end if;

  if not public.is_chat_member_of(p_conversation) then
    raise exception 'not a member of conversation';
  end if;

  return public.fn_chat_post_system_message(p_conversation, p_body, p_meta);
end $$;

grant execute on function public.rpc_chat_post_system_message(uuid, text, jsonb) to authenticated;
