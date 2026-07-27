-- Migration 0009_seed.sql
--   初始演示数据 + 文档化 admin 初始化流程
--
--   ============================================================
--   如何建立第一个 admin 账号（两种方式，二选一）
--   ============================================================
--
--   方式 A：在 Supabase Dashboard 创建（推荐）
--     1. Authentication → Users → Add user → Create new user
--        Email:    admin@example.com
--        Password: <你自己的强密码>
--        Auto Confirm User: ✅ 勾上（不然不能登录）
--     2. trigger trg_handle_new_user 会自动写 public.users 行，
--        role='admin'（默认值）、account_id=_internal、full_name=email
--     3. （可选）UPDATE public.users SET full_name='管理员真名' WHERE id=<auth.users.id>;
--
--   方式 B：用 SQL 直接插入（service_role 权限）
--     -- 注意：必须先在 auth.users 创行（trigger 才有机会 fire）
--     -- 如果你已经有 auth.users 行，跳过 step 1
--     -- step 1: 先在 Dashboard 创 auth.users 行（让 trigger 跑一次）
--     -- step 2: 微调
--     UPDATE public.users SET full_name='管理员真名'
--       WHERE id = (SELECT id FROM auth.users WHERE email='admin@example.com');
--
--   之后所有内部员工都按同样流程：
--     Dashboard 创 user → metadata 里 role 写 checker/warehouse/finance → trigger 自动
--     他们的 account_id 永远指向 _internal 哨兵账号
--
--   ============================================================
--   客户（customer）账号：禁止 Dashboard 手创
--     必须经 invite 流程 → complete-invite 函数 → 带 account_id 写 users 行
--     这样 account_id 直接指向真实父账号
--
--   ============================================================

-- ============ 演示库存组（stock_groups）seed ============
-- 给 invite 流程 + 客户白名单演示用
insert into public.stock_groups (code, display_name, sku_count) values
  ('A中鹏',   'A 中鹏库存组',   0),
  ('B客户',   'B 客户库存组',   0),
  ('I客户',   'I 客户库存组',   0),
  ('PT Y客户','PT Y 客户组',    0),
  ('S客户',   'S 客户库存组',   0),
  ('W处理',   'W 处理组',       0)
on conflict (code) do nothing;

-- ============ 演示父账号 + 子账号 seed ============
-- 仅供联调演示。生产环境用 Excel 导入。
do $$
declare
  v_parent_id uuid;
begin
  insert into public.accounts (
    parent_id, account_type, account_name, company_name,
    address, bank, bank_account, mfo, inn, director,
    status, is_main, balance
  ) values (
    null, '1_public', '演示客户A', '演示客户A有限公司',
    '-', '-', '-', '-', '-', '-',
    'active', false, 0
  )
  on conflict do nothing
  returning id into v_parent_id;

  -- 只在父账号刚被创建时插入子账号（避免重复）
  if v_parent_id is not null then
    insert into public.accounts (
      parent_id, account_type, account_name, company_name,
      address, bank, bank_account, mfo, inn, director,
      status, is_main, balance
    ) values
      (v_parent_id, '1_public', '演示子账号1', '演示子账号1',
       '-', '-', '-', '-', '-', '-', 'active', true, 0),
      (v_parent_id, '1_public', '演示子账号2', '演示子账号2',
       '-', '-', '-', '-', '-', '-', 'active', false, 0);
  end if;
end $$;

comment on migration '0009_seed.sql' is
  '演示数据 + admin 初始化文档。生产部署后第一次跑这文件即可。';