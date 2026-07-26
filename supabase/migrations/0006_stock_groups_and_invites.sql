-- Migration 0006:
--   1. 新增 stock_groups 表：库存组（来自 库存表.csv 的 A 列"客户组"）
--      白名单粒度 = 库存组，不是产品类型
--   2. 新增 customer_invites 表：邀请链接（一次性 / 7 天有效）
--   3. 改 accounts.password_hash 字段（可选）—— 客户登录需要密码
--
-- 运行前：必须先跑 0005_sub_accounts.sql

-- ============ 1. stock_groups ============
create table if not exists public.stock_groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- 'A中鹏' / 'B客户' / 'PT Y客户' / 'W处理' ...
  display_name text,                       -- '每日库存1' 之类展示名（来自 分类.xlsx）
  remark      text,
  sku_count   int default 0,               -- 该组下 SKU 数（缓存，省 count(*)）
  imported_at timestamptz default now(),
  created_at  timestamptz default now()
);

create index if not exists idx_stock_groups_code on public.stock_groups (code);

-- 库存组 ↔ 客户组的映射（用于：父账号 → 库存组白名单）
-- customer_group 仍是字符串（兼容旧 customer_group_mappings）
-- 也支持把父账号绑到一组 = 父能看该 stock_group 下所有 SKU
-- 直接复用 customer_group_mappings：customer_group 列就存 stock_group.code

comment on table public.stock_groups is '库存组 = 库存表 A 列客户组。Admin 在 AccountsAdminPage 分配父账号可见的库存组粒度白名单。';
comment on column public.stock_groups.code is '库存组的唯一业务代号（来自 库存表.csv A 列）';

-- ============ 2. customer_invites ============
create table if not exists public.customer_invites (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  token       text not null unique,        -- URL-safe 随机串
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid,                        -- admin auth.uid
  created_at  timestamptz default now()
);

create index if not exists idx_customer_invites_token on public.customer_invites (token);
create index if not exists idx_customer_invites_account on public.customer_invites (account_id);

-- 删除父账号时，连同邀请一并清（避免孤儿）
create index if not exists idx_customer_invites_account_expires
  on public.customer_invites (account_id, expires_at);

comment on table public.customer_invites is 'admin 给主账号发一次性邀请链接。客户点链接 → 设置密码 → 登录。';

-- ============ 3. accounts.email 字段（客户登录用） ============
-- 如果还没有 email 字段，加上
alter table public.accounts
  add column if not exists login_email text,
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists uq_accounts_login_email
  on public.accounts (login_email) where login_email is not null;

comment on column public.accounts.login_email is '客户登录邮箱（主账号粒度，唯一）';
comment on column public.accounts.user_id is '登录用户关联到 auth.users.id。子账号共享父.user_id';

-- ============ 4. 现有 customer_group_mappings 兼容 ============
-- 现有结构已经够用：
--   customer_group_mappings.customer_group = stock_group.code
--   customer_group_mappings.account_id = 父账号.id
--   customer_group_mappings.is_active = 是否启用（admin 决定）
-- 不用动，加个注释：
comment on table public.customer_group_mappings is '父账号 → 库存组(=customer_group)白名单。customer_group 列存 stock_group.code。所有子账号共享父的白名单。';

-- ============ 5. products.stock_group 字段（库存组粒度白名单） ============
-- 库存表里的型号属于哪个客户组，存到这里
-- 旧 account_products 表是 fine-grained per-product 白名单，仍作为 override 保留
alter table public.products
  add column if not exists stock_group text;

create index if not exists idx_products_stock_group on public.products (stock_group);

comment on column public.products.stock_group is '所属库存组（来自 库存表.csv A 列）。RLS：customers 能看 stock_group IN (他们的 customer_group_mappings.customer_group)';
