-- =====================================================================
-- 0025_fix_chat_cmid_cast.sql
-- 修复: chat_messages.client_message_id 是 uuid 列, 但 0019/0022 的 RPC
--       把 v_cmid (text) 和 gen_random_uuid()::text 直接 cast 进 uuid 列,
--       触发 42883 'operator does not exist: uuid = text'.
-- 解决: 显式 ::uuid cast. (0019 / 0022 文件已同步更新, 防止新部署再踩坑.)
-- =====================================================================

-- 1. rpc_chat_create_image_message
create or replace function public.rpc_chat_create_image_message(
  p_conversation uuid,
  p_storage_path text,
  p_mime text,
  p_size bigint,
  p_width int default null,
  p_height int default null,
  p_client_message_id text default null
)
returns table (message_id uuid, attachment_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_att_id uuid;
  v_cmid text;
  v_existed boolean := false;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  v_cmid := coalesce(
    p_client_message_id,
    gen_random_uuid()::text
  );

  -- 幂等
  select id into v_msg_id
  from public.chat_messages
  where sender_id = v_uid and client_message_id = v_cmid::uuid
  limit 1;
  if v_msg_id is not null then
    v_existed := true;
    select id into v_att_id
    from public.chat_message_attachments
    where message_id = v_msg_id
    limit 1;
    return query select v_msg_id, v_att_id, false;
    return;
  end if;

  if not public.is_chat_member_of(p_conversation) and not public.is_chat_staff() then
    raise exception 'not a member of this conversation';
  end if;

  insert into public.chat_messages (
    conversation_id, sender_id, message_type, message_kind, body,
    client_message_id, created_at
  )
  values (
    p_conversation, v_uid, 'text', 'image', '[图片]', v_cmid::uuid, now()
  )
  returning id into v_msg_id;

  insert into public.chat_message_attachments (
    message_id, storage_path, mime, size_bytes, width, height
  )
  values (
    v_msg_id, p_storage_path, p_mime, p_size, p_width, p_height
  )
  returning id into v_att_id;

  return query select v_msg_id, v_att_id, true;
end $$;

grant execute on function public.rpc_chat_create_image_message(
  uuid, text, text, bigint, int, int, text
) to authenticated;

-- 2. rpc_chat_create_order_card_message
create or replace function public.rpc_chat_create_order_card_message(
  p_conversation uuid,
  p_order_id uuid,
  p_client_message_id text default null
)
returns table (message_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_cmid text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  v_cmid := coalesce(
    p_client_message_id,
    gen_random_uuid()::text
  );

  -- 幂等
  select id into v_msg_id
  from public.chat_messages
  where sender_id = v_uid and client_message_id = v_cmid::uuid;
  if v_msg_id is not null then
    return query select v_msg_id, false;
    return;
  end if;

  if not public.is_chat_member_of(p_conversation) and not public.is_chat_staff() then
    raise exception 'not a member of this conversation';
  end if;

  insert into public.chat_messages (
    conversation_id, sender_id, message_type, message_kind, body,
    client_message_id, created_at
  )
  values (
    p_conversation, v_uid, 'text', 'order_card', '[订单]', v_cmid::uuid, now()
  )
  returning id into v_msg_id;

  insert into public.chat_message_metadata (message_id, payload)
  values (v_msg_id, jsonb_build_object('order_id', p_order_id));

  return query select v_msg_id, true;
end $$;

grant execute on function public.rpc_chat_create_order_card_message(
  uuid, uuid, text
) to authenticated;

-- 3. rpc_chat_post_system_message (0022)
-- 把 client_message_id 直接用 gen_random_uuid() (uuid 类型), 避免显式 text cast
create or replace function public.rpc_chat_post_system_message(
  p_conversation uuid,
  p_body text,
  p_meta jsonb default null
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
    values (v_msg_id, p_meta);
  end if;

  return v_msg_id;
end $$;

grant execute on function public.rpc_chat_post_system_message(
  uuid, text, jsonb
) to authenticated;
