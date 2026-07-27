-- Migration 0007:
--   安全补丁：customer_invites RLS + accounts.user_id UNIQUE
--   解决：
--     - 前端 anon key 可直写 customer_invites（任意人灌垃圾）
--     - 同一 auth.users.id 可被绑到多个父账号（数据完整性）

-- ============ 1. customer_invites RLS ============
alter table public.customer_invites enable row level security;

drop policy if exists cust_invites_admin_all on public.customer_invites;
create policy cust_invites_admin_all on public.customer_invites
  for all using (public.is_admin()) with check (public.is_admin());

-- 客户点邀请链接时需要按 token 查（前端 anon key）
drop policy if exists cust_invites_select_token on public.customer_invites;
create policy cust_invites_select_token on public.customer_invites
  for select using (true);

-- Edge Function 用 service_role，绕过 RLS（service_role 是 bypass rls = on 的）
-- 所以这里不再额外开放 insert/update 给前端

-- ============ 2. accounts.user_id UNIQUE ============
create unique index if not exists uq_accounts_user_id
  on public.accounts (user_id) where user_id is not null;