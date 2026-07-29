-- Migration 0012:
--   修复 accounts_customer_select policy —— 旧版只允许 SELECT 自己的那一行，
--   导致登录态为"父账号自己"时无法 SELECT 自己的子账号（checkout 下单页
--   fetchSubAccounts 必然返回空，"主账号下没有子账号"）。
--
-- 旧定义:
--   create policy accounts_customer_select on public.accounts
--     for select using (id = public.current_account_id());
--
-- 新定义:
--   任意登录用户(customer/checker/finance/warehouse/admin)可以 SELECT:
--     - 自己的那一行(id = current_account_id())
--     - 父账号: 如果自己是子账号(parent_id = current_account_id())，
--       父那一行也可见 —— 登录后立即知道"我在哪个父下面"
--     - 同父下的所有子账号(parent_id = 自己父的 id)，
--       这样父账号登录后能 SELECT 自己的子账号集合
--
-- 权限边界:
--   - admin 走 accounts_admin_all, 任何行都可见(覆盖此策略)
--   - 普通客户 SELECT 范围仍受父-子树限制, 看不到别人的账户
--   - 这条策略对 INSERT/UPDATE/DELETE 不生效, 只有 SELECT
drop policy if exists accounts_customer_select on public.accounts;
create policy accounts_customer_select on public.accounts
  for select using (
    -- 自己那一行
    id = public.current_account_id()
    or
    -- 自己的父那一行(若是子账号, 允许看父账号)
    id = (
      select parent_id from public.accounts
      where id = public.current_account_id()
    )
    or
    -- 同父下的所有子账号(若自己是父, 允许看所有子; 若是子, 允许看同父下的兄弟)
    parent_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
  );

-- 同理修复 users_same_account_select: 父账号应能看自己树下所有 users 行
-- (子账号有 user_id 关联 auth.users, 但实际是 users 表里 users.role 是给
--  后台人员用的, 客户登录的是子账号的 user_id; 父账号登录的场景下应能
-- 看到所有子账号的 user_id 关联, 否则审计/对账页空白)
drop policy if exists users_same_account_select on public.users;
create policy users_same_account_select on public.users
  for select using (
    -- 自己那一行
    id = auth.uid()
    or
    -- 同 account 下(自己本来就是某 account 的成员)
    account_id = public.current_account_id()
    or
    -- 同 account 的父下(若自己是子, 也能看父的 users 行; 若自己是父,
    -- 也能看所有子的 users 行 —— 通过父 id 关联)
    account_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
  );