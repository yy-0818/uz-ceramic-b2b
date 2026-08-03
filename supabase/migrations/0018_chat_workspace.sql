-- =====================================================================
-- 0018_chat_workspace.sql
-- 在线客服工作台 (M1: 独立聊天页 + 跨账号客服分配)
--
-- 背景:
--   0017 让 staff "只为会员时可见", 但客服工作台需要 admin/staff 看所有 open
--   会话并按客户主账号分组, 不依赖手动加入成员. 这一步把这个口子开出来.
--
-- 内容:
--   1. chat_conversations SELECT:
--      - admin               所有会话
--      - staff (checker/finance/warehouse)  所有会话
--      - customer (保持 0017) 仅自己主账号
--   2. chat_conversation_members SELECT:
--      - admin/staff         任意行 (工作台显示)
--      - customer (保持)     自己 OR 同一会话
--   3. chat_messages SELECT:
--      - admin/staff         任意会话
--      - customer (保持)     仅成员
--   4. chat_messages INSERT:
--      - admin/staff         任意会话 (客服可代发)
--      - customer (保持)     仅成员
--   5. chat_conversations UPDATE:
--      - admin/staff 可改 status/assigned_to
--      - 仅 allowed update 列 (CHECK + trigger)
--   6. 触发器: 客服加入会话, 立即建立自己的 member 行
--      - 客户发新会话时, 客服端首次 ensureConversation 时
--      - 同一个 trigger 在 auth.users 有 chat_role (后续 Phase 3 扩展)
--      - 现在: 用 fn_chat_autojoin_staff on INSERT chat_messages
--        + INSERT chat_conversations 两种路径
--   7. chat_message_recipients: 拆出 per-user read punct 表 (提前准备)
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. 删除旧 RLS, 替换为按角色区分的版本
-- ---------------------------------------------------------------------
drop policy if exists chat_conv_admin_all on public.chat_conversations;
drop policy if exists chat_conv_select       on public.chat_conversations;
drop policy if exists chat_conv_insert       on public.chat_conversations;
drop policy if exists chat_conv_insert_staff on public.chat_conversations;
drop policy if exists chat_conv_insert_customer on public.chat_conversations;
drop policy if exists chat_conv_update       on public.chat_conversations;

-- 是否 staff (admin/checker/finance/warehouse)
-- 用项目已有 current_user_role()
create or replace function public.is_chat_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('admin','checker','finance','warehouse')
     from public.users where id = auth.uid()),
    false
  );
$$;

-- SELECT: staff 看所有 / customer 看自己主账号
create policy chat_conv_select on public.chat_conversations
  for select using (
    public.is_chat_staff()
    or account_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
  );

-- INSERT: 所有人 (customer 自己主账号, staff 任意)
create policy chat_conv_insert on public.chat_conversations
  for insert with check (
    public.is_chat_staff()
    or (
      public.current_user_role() = 'customer'
      and account_id = (
        select coalesce(parent_id, id) from public.accounts
        where id = public.current_account_id()
      )
    )
  );

-- UPDATE: staff 可修改 status / assigned_to; customer 可不动
create policy chat_conv_update_staff on public.chat_conversations
  for update using (public.is_chat_staff())
                  with check (public.is_chat_staff());

-- 限制 staff 只能改 status / assigned_to / updated_at
create or replace function public.fn_chat_conv_limit_staff_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed_cols text[];
begin
  if public.is_admin() then
    return new;
  end if;
  -- 非 admin staff 只允许 status / assigned_to (含时间戳), 其它一律拦截
  changed_cols := array(
    select key from jsonb_object_keys(to_jsonb(new)) n
    where coalesce((new).n::text, '') is distinct from coalesce((old).n::text, '')
  );
  -- 把所有 id 不变字段剔除
  for i in 1..array_length(changed_cols, 1) loop
    if changed_cols[i] in ('id','account_id','subject_order_id','created_at','last_message_at','updated_at') then
      changed_cols[i] := null;
    end if;
  end loop;
  -- 看真实变化
  perform 1;
  -- 直接硬编码三个允许字段的白名单检查
  if (new.status is distinct from old.status) then null; end if;
  if (new.assigned_to is distinct from old.assigned_to) then null; end if;
  -- 校验除了 status/assigned_to + last_message_at + updated_at 之外没有别的
  if (
    (new.id is distinct from old.id)
    or (new.account_id is distinct from old.account_id)
    or (new.subject_order_id is distinct from old.subject_order_id)
    or (new.created_at is distinct from old.created_at)
    or (new.last_message_at is distinct from old.last_message_at)
    -- updated_at 由触发器自动处理, 允许修改
  ) then
    raise exception 'staff 不能修改该会话的非允许字段';
  end if;
  return new;
end $$;

drop trigger if exists trg_chat_conv_limit_staff_update on public.chat_conversations;
create trigger trg_chat_conv_limit_staff_update
  before update on public.chat_conversations
  for each row execute function public.fn_chat_conv_limit_staff_update();

-- ---------------------------------------------------------------------
-- B. chat_conversation_members: 工作台需要 staff 看所有 (用来显示会话的双方)
-- ---------------------------------------------------------------------
drop policy if exists chat_member_admin_all  on public.chat_conversation_members;
drop policy if exists chat_member_select     on public.chat_conversation_members;
drop policy if exists chat_member_insert_self on public.chat_conversation_members;
drop policy if exists chat_member_update_self on public.chat_conversation_members;

-- SELECT: staff 看任意; customer 看自己 OR 自己会话其它成员
create policy chat_member_select on public.chat_conversation_members
  for select using (
    public.is_chat_staff()
    or user_id = auth.uid()
    or public.is_chat_member_of(conversation_id)
  );

-- INSERT: 自己 OR (staff, 创建后补 staff 自己)
create policy chat_member_insert on public.chat_conversation_members
  for insert with check (
    user_id = auth.uid()
    or public.is_chat_staff()
  );

-- UPDATE: 自己 OR admin (admin 全权)
create policy chat_member_update on public.chat_conversation_members
  for update using (user_id = auth.uid() or public.is_admin())
                with check (user_id = auth.uid() or public.is_admin());

-- DELETE: admin
create policy chat_member_delete_admin on public.chat_conversation_members
  for delete using (public.is_admin());

-- ---------------------------------------------------------------------
-- C. chat_messages: staff 也需在任意会话里发消息
-- ---------------------------------------------------------------------
drop policy if exists chat_msg_admin_all on public.chat_messages;
drop policy if exists chat_msg_select    on public.chat_messages;
drop policy if exists chat_msg_insert    on public.chat_messages;
drop policy if exists chat_msg_update_self on public.chat_messages;

create policy chat_msg_select on public.chat_messages
  for select using (
    public.is_chat_staff()
    or public.is_chat_member_of(conversation_id)
  );

-- INSERT: sender=auth.uid, staff 不要求成员 (代发). 客户必须是成员.
create policy chat_msg_insert on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and (
      public.is_chat_staff()
      or public.is_chat_member_of(conversation_id)
    )
  );

-- UPDATE: sender 自己 OR admin
create policy chat_msg_update on public.chat_messages
  for update using (sender_id = auth.uid() or public.is_admin())
                with check (sender_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- D. 触发器: 客服开启会话时自动 join + 客服每发一条消息自动 join
--    (解决"客户先发, 客服再回" 工作台入口不用手动加成员的体验)
-- ---------------------------------------------------------------------
create or replace function public.fn_chat_autojoin_staff()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_staff_kind text;
  v_conversation_id uuid;
begin
  -- 两种调用模式:
  --   tg = 'INSERT chat_messages' 时 NEW.conversation_id
  --   tg = 'INSERT chat_conversations' 时 NEW.id
  if tg_op = 'INSERT' and tg_table_name = 'chat_messages' then
    v_conversation_id := NEW.conversation_id;
  elsif tg_op = 'INSERT' and tg_table_name = 'chat_conversations' then
    v_conversation_id := NEW.id;
  else
    return coalesce(NEW, OLD);
  end if;

  select role into v_staff_kind
  from public.users
  where id = auth.uid();

  if v_staff_kind is null or v_staff_kind in ('customer','fin_customer') then
    return coalesce(NEW, OLD);
  end if;

  -- 仅 staff (admin/checker/finance/warehouse)
  insert into public.chat_conversation_members
    (conversation_id, user_id, member_type)
  values (v_conversation_id, auth.uid(), 'staff')
  on conflict (conversation_id, user_id) do nothing
    -- partial unique 不会真冲突 (left_at 列), 这里只是幂等
    ;

  return coalesce(NEW, OLD);
end $$;

-- 因为 conversation_id+user_id 没有 strict unique, 用 sub query 兜底
create or replace function public.fn_chat_autojoin_staff_safe()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_staff_kind text;
  v_conversation_id uuid;
  v_exists boolean;
begin
  if tg_op = 'INSERT' and tg_table_name = 'chat_messages' then
    v_conversation_id := NEW.conversation_id;
  elsif tg_op = 'INSERT' and tg_table_name = 'chat_conversations' then
    v_conversation_id := NEW.id;
  else
    return coalesce(NEW, OLD);
  end if;

  select role into v_staff_kind
  from public.users where id = auth.uid();

  if v_staff_kind is null or v_staff_kind in ('customer','fin_customer') then
    return coalesce(NEW, OLD);
  end if;

  -- partial unique 索引 (left_at is null) 让我们用 on conflict
  -- 但 chat_conversation_members 上已有 uq_chat_member_user (partial)
  insert into public.chat_conversation_members
    (conversation_id, user_id, member_type)
  values (v_conversation_id, auth.uid(), 'staff')
  on conflict (conversation_id, user_id) where left_at is null do nothing;

  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_chat_autojoin_msg  on public.chat_messages;
drop trigger if exists trg_chat_autojoin_conv on public.chat_conversations;
create trigger trg_chat_autojoin_msg
  after insert on public.chat_messages
  for each row execute function public.fn_chat_autojoin_staff_safe();
create trigger trg_chat_autojoin_conv
  after insert on public.chat_conversations
  for each row execute function public.fn_chat_autojoin_staff_safe();

-- ---------------------------------------------------------------------
-- E. chat_message_recipients: Phase 1 之前写 doc 说会做, 这里建表但不
--    接 RLS, 仅占位 (后续用独立 last-read 索引, 不影响当前已读位点)
-- ---------------------------------------------------------------------
create table if not exists public.chat_message_recipients (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.chat_messages(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  read_at      timestamptz not null default now()
);
create unique index if not exists uq_chat_msg_recv
  on public.chat_message_recipients (message_id, user_id);
create index if not exists idx_chat_msg_recv_user
  on public.chat_message_recipients (user_id, read_at desc);

alter table public.chat_message_recipients enable row level security;
drop policy if exists chat_mr_admin_all on public.chat_message_recipients;
drop policy if exists chat_mr_select    on public.chat_message_recipients;
drop policy if exists chat_mr_insert    on public.chat_message_recipients;
create policy chat_mr_admin_all on public.chat_message_recipients
  for all using (public.is_admin()) with check (public.is_admin());
create policy chat_mr_select on public.chat_message_recipients
  for select using (
    public.is_chat_staff() or user_id = auth.uid()
  );
create policy chat_mr_insert on public.chat_message_recipients
  for insert with check (
    public.is_chat_staff() or user_id = auth.uid()
  );

-- ---------------------------------------------------------------------
-- F. 客服工作台 RPC: 列出所有 open + closed 会话 (分页), 给 staff 用
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
    ), my_unread as (
      select m.conversation_id, count(*) as cnt
      from public.chat_messages m
      join public.chat_conversation_members mem
        on mem.conversation_id = m.conversation_id
      where m.conversation_id in (select id from convs)
        and mem.user_id = v_uid
        and mem.left_at is null
        and m.sender_id <> v_uid
        and m.created_at > mem.joined_at
      group by m.conversation_id
    )
    select
      c.id, c.account_id, c.subject_order_id, c.assigned_to, c.status,
      c.last_message_at, c.created_at, c.updated_at,
      a.account_name::text, a.company_name::text,
      o.order_no::text,
      u.full_name::text,
      lm.body::text, lm.sender_id, lm.created_at,
      coalesce(um.cnt, 0)
    from convs c
    left join public.accounts a on a.id = c.account_id
    left join public.orders  o on o.id = c.subject_order_id
    left join public.users   u on u.id = c.assigned_to
    left join last_msg       lm on lm.conversation_id = c.id
    left join my_unread      um on um.conversation_id = c.id;
end $$;

grant execute on function public.rpc_chat_admin_list_conversations(varchar, int, int) to authenticated;
