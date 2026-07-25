-- =====================================================================
-- 0001_init.sql
-- 乌兹别克斯坦陶瓷工厂 B2B 下单平台 - 基础架构
-- Phase 1 + Phase 2: 多主体账户 + 库存白名单 + 权限隔离
-- =====================================================================

-- ---------- 1. accounts 账户表（多主体 + 本地化俄语字段）----------
create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references public.accounts(id) on delete set null,
  account_type    varchar(32) not null
                    check (account_type in ('1_public','2_cash','3_export')),
  account_name    varchar(128) not null,
  company_name    varchar(255) not null,
  address         varchar(512) not null,
  bank            varchar(255) not null,
  bank_account    varchar(64)  not null,
  mfo             varchar(32)  not null,
  inn             varchar(32)  not null,
  director        varchar(128) not null,
  contract_no     varchar(64),
  contract_date   date,
  balance         numeric(18,2) not null default 0,
  status          varchar(16) not null default 'active'
                    check (status in ('active','inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_accounts_parent_id on public.accounts(parent_id);
create index if not exists idx_accounts_type on public.accounts(account_type);

-- ---------- 2. users 用户表 ----------
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  role        varchar(32) not null
                check (role in ('admin','checker','warehouse','finance','customer')),
  is_main     boolean not null default false,
  full_name   varchar(128),
  phone       varchar(32),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_users_account_id on public.users(account_id);

-- ---------- 3. products 产品表 ----------
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  model            varchar(128) not null unique,
  category         varchar(64)  not null,
  conversion_rate  numeric(10,3) not null default 1.000,
  remark           varchar(255),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_products_category on public.products(category);

-- ---------- 4. account_products 库存白名单 ----------
create table if not exists public.account_products (
  account_id      uuid not null references public.accounts(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  is_visible      boolean not null default true,
  stock_level_1   integer not null default 0 check (stock_level_1 >= 0),
  stock_level_2   integer not null default 0 check (stock_level_2 >= 0),
  updated_at      timestamptz not null default now(),
  primary key (account_id, product_id)
);

create index if not exists idx_account_products_product on public.account_products(product_id);
create index if not exists idx_account_products_visible on public.account_products(is_visible);

-- ---------- 触发器：updated_at 自动维护 ----------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_accounts_updated_at  on public.accounts;
create trigger trg_accounts_updated_at before update on public.accounts
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at before update on public.products
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_account_products_updated_at on public.account_products;
create trigger trg_account_products_updated_at before update on public.account_products
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.accounts         enable row level security;
alter table public.users            enable row level security;
alter table public.products         enable row level security;
alter table public.account_products enable row level security;

-- 辅助函数
create or replace function public.current_user_role()
returns varchar language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.current_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select account_id from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

-- accounts
drop policy if exists accounts_admin_all on public.accounts;
create policy accounts_admin_all on public.accounts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists accounts_customer_select on public.accounts;
create policy accounts_customer_select on public.accounts
  for select using (id = public.current_account_id());

-- users
drop policy if exists users_admin_all on public.users;
create policy users_admin_all on public.users
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists users_same_account_select on public.users;
create policy users_same_account_select on public.users
  for select using (account_id = public.current_account_id());

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- products
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (auth.uid() is not null);

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all using (public.is_admin()) with check (public.is_admin());

-- account_products（核心）
drop policy if exists ap_admin_all on public.account_products;
create policy ap_admin_all on public.account_products
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ap_customer_select on public.account_products;
create policy ap_customer_select on public.account_products
  for select using (
    is_visible = true
    and (
      account_id = public.current_account_id()
      or
      account_id = (
        select parent_id from public.accounts
        where id = public.current_account_id() and parent_id is not null
      )
    )
  );
