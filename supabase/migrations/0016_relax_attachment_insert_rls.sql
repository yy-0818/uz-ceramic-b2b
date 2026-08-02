-- Migration 0016:
--   放宽 order-attachments storage insert RLS, 让同主账号子账号也能上传
--
-- 历史问题:
--   order_attachments_insert_customer 要求路径首段 = current_account_id()。
--   current_account_id() = users.account_id (即叶子账号的 id)，
--   而 checkout 上传时用的是 parentAccountId (= parent_id, 主账号 id)。
--   子账号下单时 → 路径首段 ≠ current_account_id() → 上传被 RLS 拒绝。
--
--   admin 不受影响（走 is_admin()）。
--   main account (无 parent_id) 也不受影响 (parent_id = self.id = account.id)。
--   只有 sub-account (有 parent_id) 会卡。
--
--   后果：sub-account 下单 → 上传失败 → reset 删除 → DB 写不存在 path → 详情 404。
--
-- 修复:
--   路径首段可以是当前用户自己的 parent_id（含自身）
--   = current_account_id() 的 parent_id (or self if main)
--   这样不论是 main account 直接下单, 还是 sub-account 代主账号下单,
--   路径首段都对应到主账号 id。

drop policy if exists "order_attachments_insert_customer" on storage.objects;
create policy "order_attachments_insert_customer" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-attachments'
    and (
      public.is_admin()
      or (
        auth.uid() is not null
        and (storage.foldername(name))[1] = (
          select coalesce(parent_id, id)::text from public.accounts
          where id = public.current_account_id()
        )
      )
    )
  );

-- 同步放宽 read policy: 任何 authenticated 用户都能读 (bucket 本身是 public,
-- 这条 policy 只是为了和 private bucket 兼容, 并不真正限制)
-- 保持现状即可, 不动 read policy.