-- =====================================================================
-- 0015_order_items_color_code.sql
-- 在 order_items 增加 color_code 字段，记录下单时的色号。
-- 这样订单明细可按 (product, color_code, stock_level) 精确追溯，
-- 与 useCart 按色号分行保存的语义一致。
-- =====================================================================

alter table public.order_items
  add column if not exists color_code varchar(32);

create index if not exists idx_order_items_color
  on public.order_items(product_id, color_code, stock_level);

comment on column public.order_items.color_code is
  '下单时的色号（如 D1 / A12），与 stock_levels 组合定位 stock_colors';