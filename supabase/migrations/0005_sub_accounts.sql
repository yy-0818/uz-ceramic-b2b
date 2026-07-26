-- =====================================================================
-- 0005_sub_accounts.sql
-- 主账号（父） + 子账户结构改造
--   - 父账号：parent_id = NULL，对应 Excel "类别"（如 贾汉/I客户/W客户）
--   - 子账号：parent_id = 父.id，承载 Excel "客户名称"（如 1账户 I客户 ASM）
--   - 客户登录主账号 → 下单时选择子账号
--   - 白名单（account_products + customer_group_mappings）走父账号，
--     所有子账号共享父的白名单
-- =====================================================================

-- 1. accounts 表：补 is_main 列（标记父账号下"主联系子账号"）
alter table public.accounts
  add column if not exists is_main boolean not null default false;

-- 2. 同父下子账号名字唯一（避免重复导入产生同名 sub）
create unique index if not exists uq_accounts_parent_name
  on public.accounts (parent_id, account_name)
  where parent_id is not null;

-- 3. orders 表：sub_account_id 记录"下单具体子账号"
alter table public.orders
  add column if not exists sub_account_id uuid
    references public.accounts(id) on delete set null;

create index if not exists idx_orders_sub_account
  on public.orders (sub_account_id);

-- 4. customer_group_mappings：备注列已有；不再加列。Excel 导入时
--    remark 会写成 '通过 Excel 档案库自动生成'
--    is_active 默认 true，类别未映射到库存分类前 admin 可手动关
--    （在 AccountsAdminPage 里通过"分配库存分类"按钮编辑）