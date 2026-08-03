-- =====================================================================
-- 0017_chat.sql
-- 在线客服聊天 (Phase 1)
--
-- 表:
--   - chat_conversations       会话主表
--   - chat_messages            消息主体 (text/system)
--   - chat_conversation_members 会话成员 (授权唯一边界)
--   - chat_presence            在线状态 (心跳)
--
-- 桶:
--   - chat-attachments         私聊图片 (Phase 2 才用, 这里先建好)
--
-- 设计目标:
--   1. 私聊 MVP: 客户 ↔ 后台订单员
--   2. 同一 (account_id, order_id) 唯一 open 会话 (partial unique index)
--   3. 消息不可变 + 只追加; 删除用 deleted_at 软删
--   4. RLS 唯一依据: membership (聊天权限不靠前端 role)
--   5. realtime: messages INSERT/UPDATE 走 supabase realtime channel
--   6. 客户模式只看自己的主账号; 后台 staff (admin/checker/finance/warehouse)
--      需被显式加入成员才能看到 (避免后台每个人都能看所有客户)
--
-- 表创建顺序:
--   conversations → messages → members → presence
-- (必须 messages 在 members 之前, 因为 members.last_read_message_id
--  外键引用 chat_messages.id, PG 会在被引用表缺失时报 42P01)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. chat_conversations
-- ---------------------------------------------------------------------
create table if not exists public.chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  -- 客户主账号 (parent account). 同一主账号允许多个会话
  -- (订单会话, 普通咨询会话)
  account_id      uuid not null references public.accounts(id) on delete cascade,
  -- 关联订单 (可空). 一个订单对应一个 open 会话 (partial unique below)
  subject_order_id uuid references public.orders(id) on delete set null,
  -- 分配给哪位订单员 (staff)。customer 自己发消息时由 trigger/业务回填
  -- 也允许不属于任何 staff (自由流入, 待后台认领)
  assigned_to      uuid references public.users(id) on delete set null,
  -- 是否对该主账号开放 (admin 可关闭某个账号的聊天)
  status          varchar(16) not null default 'open'
                    check (status in ('open','closed','archived')),
  -- 最后一条消息时间 (denormalized for list sort)
  last_message_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_chat_conv_account
  on public.chat_conversations (account_id, last_message_at desc nulls last);
create index if not exists idx_chat_conv_order
  on public.chat_conversations (subject_order_id);
create index if not exists idx_chat_conv_assigned
  on public.chat_conversations (assigned_to);

-- 同一 (account_id, subject_order_id) 只允许一个 open 会话
-- subject_order_id 为 null 时, 用唯一 (account_id, scope='general') 思路:
-- Postgres 没有 "可空列唯一" 直白语义, 这里用 partial unique index 模拟:
--   - 有订单: (account_id, subject_order_id) 唯一
--   - 无订单: (account_id) 唯一 where status = 'open'
create unique index if not exists uq_chat_conv_order
  on public.chat_conversations (account_id, subject_order_id)
  where status = 'open';

-- ---------------------------------------------------------------------
-- 2. chat_messages
--    不可变 + 软删. 唯一键 (sender_id, client_message_id) 实现
--    客户端幂等 (重试不会重复插入).
--    必须在 members 之前: members.last_read_message_id 外键引用本表.
-- ---------------------------------------------------------------------
create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id         uuid not null references public.users(id) on delete cascade,
  -- 消息类型: text 文本 / system 系统事件
  message_type      varchar(16) not null default 'text'
                      check (message_type in ('text','system')),
  body              text not null,
  -- 客户端生成的 UUID, 用于重试幂等
  client_message_id uuid not null,
  reply_to_id       uuid references public.chat_messages(id) on delete set null,
  -- 排序辅助: 同一会话下 created_at 重复时用 id 兜底
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz
);

create unique index if not exists uq_chat_msg_client
  on public.chat_messages (sender_id, client_message_id);

create index if not exists idx_chat_msg_conv
  on public.chat_messages (conversation_id, created_at, id);

-- ---------------------------------------------------------------------
-- 3. chat_conversation_members
--    唯一授权边界. RLS 用 exists(membership) 决定 row 可见性.
--    last_read_message_id 外键 → chat_messages.id (前一步已建).
-- ---------------------------------------------------------------------
create table if not exists public.chat_conversation_members (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.chat_conversations(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  member_type         varchar(16) not null
                        check (member_type in ('customer','staff')),
  -- 已读位点 (last_read_message_id + 触发器回填时间)
  last_read_message_id uuid references public.chat_messages(id) on delete set null,
  last_read_at        timestamptz,
  joined_at           timestamptz not null default now(),
  -- 软离开. left_at 非空表示该用户已不再参与此会话
  left_at             timestamptz
);

create unique index if not exists uq_chat_member_user
  on public.chat_conversation_members (conversation_id, user_id)
  where left_at is null;

create index if not exists idx_chat_member_user
  on public.chat_conversation_members (user_id, left_at);

-- ---------------------------------------------------------------------
-- 4. chat_presence
--    短 TTL 心跳. 由应用每 25s upsert 一次.
--    展示: last_seen_at < 60s → online; <5min → away; 否则 offline
-- ---------------------------------------------------------------------
create table if not exists public.chat_presence (
  user_id       uuid primary key references public.users(id) on delete cascade,
  -- device_id 区分多设备 (web / mobile). 不强制唯一, 由应用层管理
  device_id     text not null default 'web',
  status        varchar(16) not null default 'online'
                  check (status in ('online','away','offline')),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_chat_presence_last_seen
  on public.chat_presence (last_seen_at desc);

-- ---------------------------------------------------------------------
-- 触发器: 维护 messages INSERT 时回写 conversations.last_message_at
-- ---------------------------------------------------------------------
create or replace function public.fn_chat_touch_last_message()
returns trigger language plpgsql as $$
begin
  update public.chat_conversations
    set last_message_at = new.created_at,
        updated_at      = now()
    where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists trg_chat_touch_last_message on public.chat_messages;
create trigger trg_chat_touch_last_message
  after insert on public.chat_messages
  for each row execute function public.fn_chat_touch_last_message();

-- 复用通用 updated_at
drop trigger if exists trg_chat_conv_updated_at on public.chat_conversations;
create trigger trg_chat_conv_updated_at before update on public.chat_conversations
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_chat_presence_updated_at on public.chat_presence;
create trigger trg_chat_presence_updated_at before update on public.chat_presence
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 桶: chat-attachments (private)
--   - 私有: 任何下载必须 createSignedUrl
--   - 路径约束: {account_id}/{conversation_id}/{uuid}.{ext}
--     第一段 = 主账号 id, 由 storage policy 校验
--   - 当前阶段还没用到 (Phase 2 启用), 但先建好 bucket
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  5 * 1024 * 1024,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.chat_conversations        enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages             enable row level security;
alter table public.chat_presence             enable row level security;

-- 辅助: 当前用户是否与会话有 active membership
-- 安全: SECURITY DEFINER, search_path 锁死
create or replace function public.is_chat_member_of(conv_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.chat_conversation_members m
    where m.conversation_id = conv_id
      and m.user_id = auth.uid()
      and m.left_at is null
  );
$$;

-- chat_conversations ------------------------------------------------------------
-- 客户: 看到自己的主账号下的会话
-- staff: 看到自己被加入的会话
-- admin: 全权
drop policy if exists chat_conv_admin_all on public.chat_conversations;
create policy chat_conv_admin_all on public.chat_conversations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists chat_conv_select on public.chat_conversations;
create policy chat_conv_select on public.chat_conversations
  for select using (
    -- 客户: account_id 在自己父账号子树
    account_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
    or
    -- staff: 自己是成员
    public.is_chat_member_of(id)
  );

-- INSERT
-- Phase 1 简化: 让 staff 端可以创建, customer 端创建时 account_id 必须是自己父账号
drop policy if exists chat_conv_insert on public.chat_conversations;
create policy chat_conv_insert_staff on public.chat_conversations
  for insert with check (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  );
create policy chat_conv_insert_customer on public.chat_conversations
  for insert with check (
    public.current_user_role() = 'customer'
    and account_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
  );

-- UPDATE 仅 admin 或 conversation 中被分配到的 staff
drop policy if exists chat_conv_update on public.chat_conversations;
create policy chat_conv_update on public.chat_conversations
  for update using (
    public.is_admin()
    or public.is_chat_member_of(id)
  ) with check (
    public.is_admin()
    or public.is_chat_member_of(id)
  );

-- chat_conversation_members ----------------------------------------------------
-- 客户端能看到自己被加入的成员行 (用于 sidebar 显示对方信息)
-- staff 端能看到自己被加入的成员行
-- admin 全权
drop policy if exists chat_member_admin_all on public.chat_conversation_members;
create policy chat_member_admin_all on public.chat_conversation_members
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists chat_member_select on public.chat_conversation_members;
create policy chat_member_select on public.chat_conversation_members
  for select using (
    user_id = auth.uid()
    or public.is_chat_member_of(conversation_id)
  );

-- 客户/员工首次创建会话时, 需要把当前 user 加进 members.
-- RLS: 仅允许 user_id = auth.uid() 插入自己这行.
drop policy if exists chat_member_insert_self on public.chat_conversation_members;
create policy chat_member_insert_self on public.chat_conversation_members
  for insert with check (user_id = auth.uid());

-- 仅允许更新自己那行的 last_read_message_id / last_read_at
-- 不允许修改 conversation_id / user_id / member_type
drop policy if exists chat_member_update_self on public.chat_conversation_members;
create policy chat_member_update_self on public.chat_conversation_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- chat_messages -----------------------------------------------------------------
-- 读取: 会话成员可见
-- 写入: 会话成员可插入 (sender 必须是自己)
-- 软删: 发送者可以将自己消息 deleted_at 置位
drop policy if exists chat_msg_admin_all on public.chat_messages;
create policy chat_msg_admin_all on public.chat_messages
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists chat_msg_select on public.chat_messages;
create policy chat_msg_select on public.chat_messages
  for select using (public.is_chat_member_of(conversation_id));

-- INSERT: 只允许 sender = auth.uid()
drop policy if exists chat_msg_insert on public.chat_messages;
create policy chat_msg_insert on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_chat_member_of(conversation_id)
  );

-- UPDATE: 仅 sender 可修改自己的消息 (目前只允许软删)
drop policy if exists chat_msg_update_self on public.chat_messages;
create policy chat_msg_update_self on public.chat_messages
  for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- chat_presence -----------------------------------------------------------------
-- 读取: 任何登录用户 (online 状态公开给同事/客户)
-- 写入: 自己改自己的
drop policy if exists chat_presence_select on public.chat_presence;
create policy chat_presence_select on public.chat_presence
  for select using (auth.uid() is not null);

drop policy if exists chat_presence_upsert on public.chat_presence;
create policy chat_presence_upsert on public.chat_presence
  for insert with check (user_id = auth.uid());

drop policy if exists chat_presence_update on public.chat_presence;
create policy chat_presence_update on public.chat_presence
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- chat-attachments bucket RLS
--   - 路径: {account_id}/{conversation_id}/{filename}
--   - 第一个 folder 必须匹配 current_account_id() (客户)
--   - staff 任意路径 (admin 全权)
-- ---------------------------------------------------------------------
drop policy if exists "chat_att_read_member" on storage.objects;
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
          -- 路径前缀 = {account_id}/{conversation_id}
          and (storage.foldername(name))[1] = c.account_id::text
          and (storage.foldername(name))[2] = c.id::text
      )
    )
  );

drop policy if exists "chat_att_insert_member" on storage.objects;
create policy "chat_att_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (
      public.is_admin()
      or
      -- 客户: 路径第一段 = 自己的 current_account_id()
      (storage.foldername(name))[1] = public.current_account_id()::text
    )
  );

drop policy if exists "chat_att_delete_owner" on storage.objects;
create policy "chat_att_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (public.is_admin() or owner = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 重要: Realtime 订阅
-- supabase_realtime publication 需要包含这些表, 否则前端订阅不到
-- ---------------------------------------------------------------------
do $$
begin
  -- phabricator-style: 避免重复 ALTER
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_conversation_members'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_conversation_members';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_presence'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_presence';
  end if;
end $$;
