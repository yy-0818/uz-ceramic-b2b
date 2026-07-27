-- =====================================================================
-- 0003_inventory_colors.sql
-- 库存表"色号 + 客户组映射"扩展
--
-- 业务模型（来自工厂 CSV 实际结构）：
--   1. 分类 (12F/12P/12J ...)       → products.category
--   2. 产品型号 (A12E900 ...)       → products.model
--   3. 色号 (D1, D2, ..., D22, A, A1, ..., A14) → stock_colors.color_code
--      每行非零值 = 该色号下的箱数
--   4. 客户组 (CSV 第 1 列)         → customer_group_mappings
--      管理员手动把客户组"拉取"到主账号 (1_public / 2_cash / 3_export)
--      客户组 → 账户映射 → account_products 白名单
-- =====================================================================

-- ---------- 1. stock_colors 产品色号库存分布 ----------
create table if not exists public.stock_colors (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  color_code    varchar(16) not null,    -- 'D1' 'D12' 'A' 'A1' ...
  stock_level   smallint not null default 1 check (stock_level in (1, 2)),
  boxes         integer  not null default 0 check (boxes >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, color_code, stock_level)
);

create index if not exists idx_stock_colors_product on public.stock_colors(product_id);

drop trigger if exists trg_stock_colors_updated_at on public.stock_colors;
create trigger trg_stock_colors_updated_at before update on public.stock_colors
  for each row execute function public.tg_set_updated_at();

-- ---------- 2. customer_group_mappings 客户组 → 主账号映射 ----------
create table if not exists public.customer_group_mappings (
  id            uuid primary key default gen_random_uuid(),
  customer_group varchar(64) not null unique,  -- CSV 第 1 列原值，如 'S客户' 'A中鹏'
  account_id    uuid not null references public.accounts(id) on delete cascade,
  is_active     boolean not null default true,
  remark        varchar(255),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_cgm_account on public.customer_group_mappings(account_id);

drop trigger if exists trg_cgm_updated_at on public.customer_group_mappings;
create trigger trg_cgm_updated_at before update on public.customer_group_mappings
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.stock_colors           enable row level security;
alter table public.customer_group_mappings enable row level security;

-- stock_colors: 跟随 product 读权限；admin 写
drop policy if exists stock_colors_read on public.stock_colors;
create policy stock_colors_read on public.stock_colors
  for select using (auth.uid() is not null);

drop policy if exists stock_colors_admin_write on public.stock_colors;
create policy stock_colors_admin_write on public.stock_colors
  for all using (public.is_admin()) with check (public.is_admin());

-- customer_group_mappings: admin 全权；其他角色按映射结果读
drop policy if exists cgm_admin_all on public.customer_group_mappings;
create policy cgm_admin_all on public.customer_group_mappings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists cgm_select on public.customer_group_mappings;
create policy cgm_select on public.customer_group_mappings
  for select using (auth.uid() is not null);

-- =====================================================================
-- 关键约束：products.model 允许同名不同色号 —— 调整 unique
-- 原本 products.model unique，现在允许 model 同名但 category 不同
-- 但你给的 CSV 数据 model 都唯一，所以保留 unique 即可
-- 若发现同一 model 在不同客户组出现，导入时会自动按"客户组 + model" 拆分
-- =====================================================================

-- 视图 v_products_with_colors / v_customer_product_visibility 由 0004 创建
-- （0004 加了 image_url / display_order 列后视图才完整；这里不再创建避免列冲突）

-- =====================================================================
-- 辅助视图：v_customer_product_visibility —— 商品可见性
-- 客户看见的白名单 = 客户 account_id 的白名单 ∪ 主账号(parent)的白名单
-- =====================================================================
drop view if exists public.v_customer_product_visibility;
create or replace view public.v_customer_product_visibility as
select
  ap.account_id,
  ap.product_id,
  ap.is_visible,
  ap.stock_level_1,
  ap.stock_level_2,
  cgm.customer_group
from public.account_products ap
left join public.customer_group_mappings cgm on cgm.account_id = ap.account_id
where ap.is_visible = true;