-- =====================================================================
-- 0021_chat_phase3_5.sql
-- Phase 3.5:
--   1. 编辑消息: rpc_chat_edit_message(message_id, new_body)
--      - 限制: sender 自己 + message_kind='text' + created_at < 5 分钟
--   2. 撤回消息: rpc_chat_soft_delete_message(message_id)
--      - 限制: sender 自己 (admin 也可代撤自己之前代发的)
--              + created_at < 2 分钟
--      - 行为: deleted_at = now(), body = '[已撤回]'
--   3. 客服接管: rpc_chat_join_conversation(conversation_id)
--      - staff 加入会话 + 设为 assigned_to (默认给自己)
--   4. 客服转接: rpc_chat_transfer_conversation(conversation_id, to_staff_id)
--      - assigned_to 改成 to_staff_id (自动 to_staff_id 也成为 member)
--      - 仅 staff 可调
--   5. 兜底: markRead 旧路径也写 chat_message_recipients (如果 RPC 失败时)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. rpc_chat_edit_message
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_edit_message(
  p_message_id uuid,
  p_new_body   text
)
returns table (message_id uuid, edited_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
  v_body text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  v_body := trim(coalesce(p_new_body, ''));
  if v_body = '' then
    raise exception '消息内容为空';
  end if;

  select id, sender_id, message_kind, created_at, deleted_at
    into v_msg
  from public.chat_messages
  where id = p_message_id
  for update;
  if v_msg.id is null then
    raise exception 'message not found';
  end if;
  if v_msg.deleted_at is not null then
    raise exception '消息已撤回, 无法编辑';
  end if;
  if v_msg.sender_id <> v_uid and not public.is_admin() then
    raise exception '只能编辑自己的消息';
  end if;
  if v_msg.message_kind <> 'text' then
    raise exception '图片 / 订单卡片不能编辑';
  end if;
  if now() - v_msg.created_at > interval '5 minutes' and not public.is_admin() then
    raise exception '超过 5 分钟编辑时限';
  end if;

  update public.chat_messages
    set body = v_body,
        edited_at = now()
  where id = p_message_id;

  return query select p_message_id, now();
end $$;

grant execute on function public.rpc_chat_edit_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. rpc_chat_soft_delete_message
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_soft_delete_message(
  p_message_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg record;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select id, sender_id, created_at, deleted_at
    into v_msg
  from public.chat_messages
  where id = p_message_id
  for update;
  if v_msg.id is null then
    raise exception 'message not found';
  end if;
  if v_msg.deleted_at is not null then
    return; -- idempotent
  end if;
  if v_msg.sender_id <> v_uid and not public.is_admin() then
    raise exception '只能撤回自己的消息';
  end if;
  if now() - v_msg.created_at > interval '2 minutes' and not public.is_admin() then
    raise exception '超过 2 分钟撤回时限';
  end if;

  update public.chat_messages
    set deleted_at = now(),
        body = case when message_kind = 'text' then '[已撤回]' else body end
  where id = p_message_id;
end $$;

grant execute on function public.rpc_chat_soft_delete_message(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. rpc_chat_join_conversation  (staff 接管/查看)
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_join_conversation(
  p_conversation uuid
)
returns void
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

  insert into public.chat_conversation_members
    (conversation_id, user_id, member_type)
  values (p_conversation, v_uid, 'staff')
  on conflict (conversation_id, user_id) where left_at is null do nothing;

  -- 默认 assigned_to 为自己 (如果当前没人接管)
  update public.chat_conversations
    set assigned_to = coalesce(assigned_to, v_uid)
  where id = p_conversation;
end $$;

grant execute on function public.rpc_chat_join_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. rpc_chat_transfer_conversation  (转给同事)
-- ---------------------------------------------------------------------
create or replace function public.rpc_chat_transfer_conversation(
  p_conversation uuid,
  p_to_staff_id  uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_to_role text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if not public.is_chat_staff() then
    raise exception 'staff only';
  end if;

  if p_to_staff_id is not null then
    select role into v_to_role from public.users where id = p_to_staff_id;
    if v_to_role is null or v_to_role in ('customer','fin_customer') then
      raise exception 'target is not staff';
    end if;
    -- 把目标 staff 自动加 member
    insert into public.chat_conversation_members
      (conversation_id, user_id, member_type)
    values (p_conversation, p_to_staff_id, 'staff')
    on conflict (conversation_id, user_id) where left_at is null do nothing;
  end if;

  update public.chat_conversations
    set assigned_to = p_to_staff_id
  where id = p_conversation;
end $$;

grant execute on function public.rpc_chat_transfer_conversation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. rpc_chat_mark_read 修正: 旧路径兜底也写 recipients
--    原 0020 版已写 recipients, 这里仅做 consistency 兜底
--    (无 schema 改动, 仅 doc)
-- ---------------------------------------------------------------------
comment on function public.rpc_chat_mark_read(uuid, uuid) is
  '原子写位点 (chat_conversation_members.last_read_message_id) + per-message read punct (chat_message_recipients). 失败时由 client 兜底.';
