-- Migration 0008:
--   1. 哨兵父账号（_internal）：用来挂 admin / checker / warehouse / finance 员工
--   2. handle_new_user trigger：auth.users 新建 → 自动在 public.users 写占位行
--      - 内部员工（role != customer）→ account_id = _internal.id，role 直接按 metadata 写
--      - 客户（role = customer）→ 跳过 trigger（由 complete-invite 函数带 account_id 写入）
--   3. 默认 admin 账号 seed（README + seed.sql）

-- ============ 1. _internal 哨兵父账号 ============
insert into public.accounts (
  id, parent_id, account_type, account_name, company_name,
  address, bank, bank_account, mfo, inn, director,
  status, is_main, balance
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  null, '1_public', '_internal', '_internal',
  '-', '-', '-', '-', '-', '-',
  'active', false, 0
) on conflict (id) do nothing;

comment on table public.accounts is
  '业务父账号 + _internal 哨兵账号（承载内部员工 user）。子账号通过 parent_id 关联父账号。';

-- ============ 2. handle_new_user trigger ============
-- SECURITY DEFINER + owner=postgres：bypass public.users RLS，确保能写入
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_account_id uuid;
  v_full_name text;
  v_metadata jsonb;
begin
  v_metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role := coalesce(v_metadata->>'role', 'admin');
  v_full_name := coalesce(v_metadata->>'full_name', new.email);

  -- 客户（role=customer）由 complete-invite 带 account_id 写入，trigger 跳过避免重复/孤儿
  if v_role = 'customer' then
    return new;
  end if;

  -- 内部员工 → 挂到 _internal 哨兵账号
  v_account_id := '00000000-0000-0000-0000-000000000000'::uuid;

  insert into public.users (id, account_id, role, is_main, full_name)
  values (new.id, v_account_id, v_role, false, v_full_name)
  on conflict (id) do update set
    role = excluded.role,
    full_name = excluded.full_name,
    updated_at = now();

  return new;
end $$;

-- 函数 owner 默认是 supabase_admin（supabase CLI 跑迁移用的角色）
-- supabase_admin 是 superuser 等价权限，能 bypass RLS → SECURITY DEFINER 函数足够
-- 不要再 alter owner to postgres：supabase_admin 没权限把自己改成 postgres owner

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

comment on function public.fn_handle_new_user() is
  'auth.users 新建后自动写 public.users。客户(role=customer)跳过，由 complete-invite 服务端显式写入（带 account_id）。';

comment on trigger trg_handle_new_user on auth.users is
  '内部员工注册时自动建 public.users 行；客户必须经 invite 流程走 complete-invite，不会被这个 trigger 处理。';