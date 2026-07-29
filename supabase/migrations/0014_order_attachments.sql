-- Migration 0014:
--   order_attachments 表 —— 订单附件 (图片) 元数据
--
--   与 storage.objects 一对多: 一个上传的图片 = 一行 order_attachments
--   + 一个 storage 对象 (object 名 = path).
--
--   用途: 客户在 checkout 下单时, 上传司机信息 (车牌照片 / 提货单 /
--         收货现场) 等图片作为订单备注的补充. 审核员/财务/仓库在订单详情里能看到.
--
--   为什么不在 orders.remark 里塞 URL?
--     - 文本字段不适合图片元数据 (mime/size/uploader)
--     - 后续需要"订单详情页查看附件缩略图"是高频操作, JOIN 表 + URL 拼接
--       比 parse 文本稳.
--
--   RLS:
--     - admin 全权
--     - 客户的可见性: 自己的订单 + 同主账号下的订单 (audit/finance/warehouse
--       也要能看到, 业务要求他们处理订单时看到附件)

create table if not exists public.order_attachments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  -- storage 对象路径 (object name, 不含 bucket 名), 形如
  -- '8a3.../9f2.../photo.jpg'. 完整 URL 由前端拼 public bucket URL.
  storage_path text not null,
  -- 文件元数据冗余存储 (storage 删除后元数据还在, 这里保留 size/mime 用于显示)
  mime        text not null,
  size_bytes  bigint not null,
  -- 备注: 客户可对每张图加一句说明 (例如 "司机张三  车牌 80 777 AAA")
  caption     text,
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_order_attachments_order
  on public.order_attachments (order_id);

create index if not exists idx_order_attachments_account
  on public.order_attachments (account_id);

-- RLS
alter table public.order_attachments enable row level security;

-- admin 全权
drop policy if exists order_attachments_admin_all on public.order_attachments;
create policy order_attachments_admin_all on public.order_attachments
  for all using (public.is_admin()) with check (public.is_admin());

-- 读: 订单所属主账号子树内可见 (自己下单 + 同主账号下其他订单)
--  即 account_id 是当前用户父 (含自身) 即可
drop policy if exists order_attachments_read on public.order_attachments;
create policy order_attachments_read on public.order_attachments
  for select using (
    account_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
  );

-- 写 (insert): 客户能给自己/同主账号下的订单上传附件;
--               admin 也能. 同 account 子树即可.
drop policy if exists order_attachments_insert on public.order_attachments;
create policy order_attachments_insert on public.order_attachments
  for insert with check (
    account_id = (
      select coalesce(parent_id, id) from public.accounts
      where id = public.current_account_id()
    )
  );

-- 删: 仅 admin 或上传者本人 (uploaded_by = auth.uid())
drop policy if exists order_attachments_delete on public.order_attachments;
create policy order_attachments_delete on public.order_attachments
  for delete using (
    public.is_admin() or uploaded_by = auth.uid()
  );
