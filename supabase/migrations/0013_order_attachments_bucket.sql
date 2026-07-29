-- Migration 0013:
--   order-attachments bucket —— 订单附件（图片：物流司机电话/车牌照片 等）
--
-- 设计：
--   - bucket 名为 order-attachments, 公共读 (PUBLIC)
--     因为订单的承运司机、收货现场这些图需要让审核员/财务/仓库快速查看,
--     不需要每次都签 URL. 同主账号下所有角色(admin/checker/finance/warehouse/
--     customer) 都应能看到。
--
--   - 写权限仅限 customer(自己订单的附件上传) 与 admin
--     路径约束: {account_id}/{order_id}/...  前面是主账号 id, 跟
--     current_account_id() 对得上. 这样同主账号下的子账号都能互看.
--
--   - 文件大小上限: 5 MB (前端校验, 这里也设置 bucket 上限作 server 兜底)
--   - mime 限制: image/jpeg, image/png, image/webp, image/heic
--
-- 注: supabase_storage 是 storage schema 里的内置表. 触发 storage.objects
-- 写入, 路径就自然形成. RLS 在 storage.objects 上另设 policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-attachments',
  'order-attachments',
  true,
  5 * 1024 * 1024,   -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 读: 公共桶, 任何登录用户都能读 (公共读 bucket 本身就允许 anon 读,
-- 这里再加一条 authenticated 显式 policy, 避免以后切回 private 时漏配).
drop policy if exists "order_attachments_read" on storage.objects;
create policy "order_attachments_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'order-attachments');

-- 写 (insert): customer 限定只能写自己 account 路径下, admin 不限.
-- 路径首段必须是 current_account_id()(字符串), 否则拒.
drop policy if exists "order_attachments_insert_customer" on storage.objects;
create policy "order_attachments_insert_customer" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-attachments'
    and (
      public.is_admin()
      or (
        auth.uid() is not null
        -- 路径格式: {account_id}/{order_id}/{filename}
        -- storage.objects.name 形如 '8a3.../9f2.../photo.jpg'
        and (storage.foldername(name))[1] = public.current_account_id()::text
      )
    )
  );

-- 删: 仅自己上传的或 admin. uploaded_by 暂时用 owner 列 (storage 标准).
drop policy if exists "order_attachments_delete_own" on storage.objects;
create policy "order_attachments_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'order-attachments'
    and (public.is_admin() or owner = auth.uid())
  );
