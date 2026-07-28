-- Migration 0011:
--   邀请链接管理：status + used_by + created_by_name
--   解决：
--     - admin 无法看到哪些链接被激活、哪些过期、哪些可安全作废
--     - 历史记录缺少操作人名字（调试/审计困难）
--
-- 1. status 枚举：pending | used | expired | revoked
--    - pending：新建，还没用过
--    - used：客户已激活（used_at 填了）
--    - expired：超过 7 天自然失效
--    - revoked：admin 主动作废
-- 2. used_by：记录激活的 auth.users.id（方便审计）
-- 3. created_by_name：冗余存 admin 名字（accounts.account_name）
--
-- ============ 1. status 列 ============
alter table public.customer_invites
  add column if not exists status text not null default 'pending';

-- 已有数据的兼容：未填 used_at 的算 pending，已填的算 used
update public.customer_invites
  set status = case
    when used_at is not null then 'used'
    when expires_at < now() then 'expired'
    else 'pending'
  end
  where status = 'pending';

alter table public.customer_invites
  drop constraint if exists chk_customer_invites_status;
alter table public.customer_invites
  add constraint chk_customer_invites_status
    check (
      (status = 'pending' and used_at is null) or
      (status = 'used' and used_at is not null) or
      (status = 'expired' and used_at is null) or
      (status = 'revoked' and used_at is null)
    );

comment on column public.customer_invites.status is
  'pending=待使用 used=已激活 expired=过期 revoked=已作废';

-- ============ 2. used_by 列（激活人的 auth.users.id）===========
alter table public.customer_invites
  add column if not exists used_by uuid references auth.users(id) on delete set null;

comment on column public.customer_invites.used_by is
  '激活该链接的客户 auth.users.id（used 时填）';

-- ============ 3. created_by_name 列（冗余 admin 名字）===========
alter table public.customer_invites
  add column if not exists created_by_name text;

comment on column public.customer_invites.created_by_name is
  '冗余存创建人 account_name，方便历史列表直接读而不 join accounts';

-- 回填已有数据
update public.customer_invites ci
  set created_by_name = u.full_name
  from public.users u
  where u.id = ci.created_by
    and ci.created_by_name is null;

-- ============ 4. 索引 ============
create index if not exists idx_invites_account_status
  on public.customer_invites (account_id, status);

create index if not exists idx_invites_pending_expires
  on public.customer_invites (status, expires_at)
  where status = 'pending';

-- ============ 5. 函数：revoke invite ============
create or replace function public.fn_revoke_invite(inv_id uuid)
returns public.customer_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.customer_invites;
begin
  if not public.is_admin() then
    raise exception '仅管理员可作废邀请链接';
  end if;

  select * into rec from public.customer_invites where id = inv_id;
  if not found then
    raise exception '邀请不存在';
  end if;

  if rec.status = 'used' then
    raise exception '该邀请已被客户激活，无法作废';
  end if;

  update public.customer_invites
  set status = 'revoked'
  where id = inv_id
  returning * into rec;

  return rec;
end;
$$;

comment on function public.fn_revoke_invite(uuid) is
  '作废一个未使用的邀请链接。返回更新后的记录。admin 调用。';

-- ============ 6. 函数：重新生成邀请 ============
create or replace function public.fn_regenerate_invite(inv_id uuid)
returns public.customer_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  rec       public.customer_invites;
  new_token text;
  new_exp   timestamptz;
  new_rec   public.customer_invites;
begin
  if not public.is_admin() then
    raise exception '仅管理员可重新生成邀请';
  end if;

  select * into rec from public.customer_invites where id = inv_id;
  if not found then
    raise exception '邀请不存在';
  end if;

  if rec.status = 'used' then
    raise exception '该邀请已被客户激活，无法重新生成（请新建）';
  end if;

  -- 标记旧记录（不作删，保留历史）
  update public.customer_invites set status = 'revoked' where id = inv_id;

  new_token := encode(gen_random_bytes(32), 'hex');
  new_exp := now() + interval '7 days';

  insert into public.customer_invites (account_id, token, expires_at, created_by, created_by_name, status)
  values (rec.account_id, new_token, new_exp, rec.created_by, rec.created_by_name, 'pending')
  returning * into new_rec;

  return new_rec;
end;
$$;

comment on function public.fn_regenerate_invite(uuid) is
  '重新生成邀请：自动作废旧记录、插入新记录并返回。admin 调用。';
