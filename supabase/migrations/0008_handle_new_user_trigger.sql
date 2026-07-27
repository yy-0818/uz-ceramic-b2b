-- Migration 0008:
--   1. 哨兵父账号（_internal）：用来挂 admin / checker / warehouse / finance 员工
--   2. handle_new_user trigger：auth.users 新建 → 自动在 public.users 写占位行
--      - 内部员工（role != customer）→ account_id = _internal.id，role 直接按 metadata 写
--      - 客户（role = customer）→ 跳过 trigger（由 complete-invite 函数带 account_id 写入）
--
-- 约束：所有 DDL 用极简形式（不 add comment、不改 owner），让 supabase_admin 跑通
-- SECURITY DEFINER 函数 owner 默认 = supabase_admin，本角色 bypass rls，写 public.users OK

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

-- ============ 2. handle_new_user trigger ============
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

  if v_role = 'customer' then
    return new;
  end if;

  v_account_id := '00000000-0000-0000-0000-000000000000'::uuid;

  insert into public.users (id, account_id, role, is_main, full_name)
  values (new.id, v_account_id, v_role, false, v_full_name)
  on conflict (id) do update set
    role = excluded.role,
    full_name = excluded.full_name,
    updated_at = now();

  return new;
end $$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();