-- =====================================================================
-- 0019_chat_attachments.sql
-- 在线客服聊天 (M2): 图片消息 + 订单卡片消息
--
-- 新增 / 改动:
--   1. message_attachments 表 (image / file 附件元数据)
--   2. chat_messages 新列: message_kind (text|image|order_card)
--   3. chat-attachments bucket: M1 阶段 bucket 已建 (private, 5MB).
--      这里补全 storage RLS: 读取走 member; 客户写入限自己的主账号.
--      staff 任意路径写 (admin 全权).
--   4. RPC: rpc_chat_create_image_message(conversation, path, mime, size)
--      client_message_id 幂等同一接口.
--   5. RPC: rpc_chat_create_order_card_message(conversation, order_id)
--      body 用 JSON 编码 { kind: 'order_card', order_id, ... }, 避免
--      新增 message_kind 列也能直接走 RLS select.
--      但为查询便利, 还是加上 message_kind 列.
-- =====================================================================

-- 列: chat_messages.message_kind
alter table public.chat_messages
  add column if not exists message_kind varchar(16) not null default 'text'
    check (message_kind in ('text','image','order_card'));

-- 索引优化: 按类型筛
create index if not exists idx_chat_msg_kind
  on public.chat_messages (conversation_id, message_kind, created_at);

-- ---------------------------------------------------------------------
-- chat_message_attachments: 一条 chat_messages 可能带多张附件
-- ---------------------------------------------------------------------
create table if not exists public.chat_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.chat_messages(id) on delete cascade,
  -- storage path in chat-attachments bucket (相对 bucket)
  storage_path text not null,
  mime         varchar(64) not null,
  size_bytes   bigint not null,
  width        int,
  height       int,
  -- 服务端生成, 仅作为 cache 检查
  content_sha  text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_chat_att_msg on public.chat_message_attachments (message_id);

alter table public.chat_message_attachments enable row level security;

drop policy if exists chat_attach_select on public.chat_message_attachments;
drop policy if exists chat_attach_insert on public.chat_message_attachments;

-- staff 看任意. 客户仅成员可见.
create policy chat_attach_select on public.chat_message_attachments
  for select using (
    public.is_chat_staff()
    or exists(
      select 1 from public.chat_messages m
      where m.id = message_id
        and public.is_chat_member_of(m.conversation_id)
    )
  );

-- INSERT: 仅 staff 或消息发送者 (这里同 sender=auth.uid())
-- 注: 客户端实际上传是 stage 1, 由 RPC 一起写, 所以这条 policy 留作兜底.
create policy chat_attach_insert on public.chat_message_attachments
  for insert with check (
    public.is_chat_staff()
    or exists(
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.sender_id = auth.uid()
        and public.is_chat_member_of(m.conversation_id)
    )
  );

-- ---------------------------------------------------------------------
-- chat-attachments bucket: 收紧 storage RLS
-- Phase 1 已有 chat_att_* 三个 policy. 这里覆盖为更精确的版本.
-- ---------------------------------------------------------------------
drop policy if exists "chat_att_read_member"     on storage.objects;
drop policy if exists "chat_att_insert_member"   on storage.objects;
drop policy if exists "chat_att_delete_owner"    on storage.objects;
drop policy if exists "chat_att_update_owner"    on storage.objects;

create policy "chat_att_read_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      public.is_admin()
      or exists(
        select 1 from public.chat_conversation_members m
        join public.chat_conversations c on c.id = m.conversation_id
        where m.user_id = auth.uid()
          and m.left_at is null
          -- 路径: {account_id}/{conversation_id}/{filename}
          and (storage.foldername(name))[1] = c.account_id::text
          and (storage.foldername(name))[2] = c.id::text
      )
      or
      -- staff 看任意路径
      public.is_chat_staff()
    )
  );

create policy "chat_att_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (
      public.is_admin()
      or
      -- 客户: 路径第一段 (account_id) 必须等于自己
      (storage.foldername(name))[1] = public.current_account_id()::text
      or
      -- staff: 任意路径
      public.is_chat_staff()
    )
  );

create policy "chat_att_update_owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'chat-attachments' and owner = auth.uid())
  with check (bucket_id = 'chat-attachments' and owner = auth.uid());

create policy "chat_att_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (public.is_admin() or owner = auth.uid())
  );

-- ---------------------------------------------------------------------
-- RPC: rpc_chat_create_image_message
--   - 入参: p_conversation, p_storage_path, p_mime, p_size, p_width, p_height,
--           p_client_message_id
--   - 行为: 同一个 client_message_id 已经存在则直接返回已有消息 (idempotent)
--           否则插消息 + attachment 行. 返回消息 + attachment.
-- ---------------------------------------------------------------------
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
    (select gen_random_uuid()::text)
  );

  -- 幂等: 已有 client_message_id 且 sender = me, 直接复用
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

  -- 必须是会话成员
  if not public.is_chat_member_of(p_conversation) and not public.is_chat_staff() then
    raise exception 'not a member of this conversation';
  end if;

  -- 插入消息
  insert into public.chat_messages (
    conversation_id, sender_id, message_type, message_kind, body,
    client_message_id, created_at
  )
  values (
    p_conversation, v_uid, 'text', 'image', '[图片]', v_cmid::uuid, now()
  )
  returning id into v_msg_id;

  -- 插入附件元数据
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

-- ---------------------------------------------------------------------
-- RPC: rpc_chat_create_order_card_message
--   - body 存 "[订单订单]" 占位, 关联的 order id 由消息元数据外 key 链接.
--   - 这里采用 JSON metadata 写入一条 chat_message_meta 表 (kv).
--   - 但为了不在表上再加一堆列, 走 message_kind='order_card',
--     然后 metadata 走 chat_message_metadata kv 表.
-- ---------------------------------------------------------------------
create table if not exists public.chat_message_metadata (
  message_id uuid primary key references public.chat_messages(id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.chat_message_metadata enable row level security;

drop policy if exists chat_meta_select on public.chat_message_metadata;
drop policy if exists chat_meta_insert on public.chat_message_metadata;
drop policy if exists chat_meta_update on public.chat_message_metadata;

create policy chat_meta_select on public.chat_message_metadata
  for select using (
    public.is_chat_staff()
    or exists(
      select 1 from public.chat_messages m
      where m.id = message_id
        and public.is_chat_member_of(m.conversation_id)
    )
  );

create policy chat_meta_insert on public.chat_message_metadata
  for insert with check (
    public.is_chat_staff()
    or exists(
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.sender_id = auth.uid()
        and public.is_chat_member_of(m.conversation_id)
    )
  );

create policy chat_meta_update on public.chat_message_metadata
  for update using (public.is_admin())
  with check (public.is_admin());

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
    (select gen_random_uuid()::text)
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
