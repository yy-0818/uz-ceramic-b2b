-- =====================================================================
-- 0004_product_image.sql
-- 给 products 表加 image_url + 关联分类图标字段
-- 后续：后台管理商品页上传图片到 Supabase Storage
-- =====================================================================

alter table public.products
  add column if not exists image_url text,
  add column if not exists display_order integer not null default 0;

-- 展示顺序索引
create index if not exists idx_products_display_order
  on public.products(category, display_order, model);

-- =====================================================================
-- Supabase Storage 桶：product-images
-- 公开读（带图片链接的客户端读取），仅 admin 可写
-- （注意：建桶也可以在 Dashboard Storage 里手动操作，这里给出 SQL 版本）
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- 任何登录用户可读
drop policy if exists "product_images read" on storage.objects;
create policy "product_images read"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- 仅 admin 可写（用 public.is_admin() helper）
drop policy if exists "product_images admin write" on storage.objects;
create policy "product_images admin write"
  on storage.objects for all
  using (
    bucket_id = 'product-images'
    and public.is_admin()
  )
  with check (
    bucket_id = 'product-images'
    and public.is_admin()
  );

-- 同步更新 view，让后台商品页直接拿到 image_url
drop view if exists public.v_products_with_colors;
create view public.v_products_with_colors as
select
  p.id           as product_id,
  p.model,
  p.category,
  p.conversion_rate,
  p.remark,
  p.image_url,
  p.display_order,
  coalesce(sum(sc.boxes) filter (where sc.stock_level = 1), 0) as total_boxes_level1,
  coalesce(sum(sc.boxes) filter (where sc.stock_level = 2), 0) as total_boxes_level2,
  (
    select json_agg(json_build_object(
      'color_code', sc2.color_code,
      'stock_level', sc2.stock_level,
      'boxes', sc2.boxes
    ) order by sc2.color_code, sc2.stock_level)
    from public.stock_colors sc2
    where sc2.product_id = p.id and sc2.boxes > 0
  ) as colors
from public.products p
left join public.stock_colors sc on sc.product_id = p.id
group by p.id, p.model, p.category, p.conversion_rate, p.remark, p.image_url, p.display_order;

grant select on public.v_products_with_colors to anon, authenticated;