-- =====================================================================
-- 0027_performance_indexes.sql
-- 性能优化索引
-- 添加高频查询缺失的索引
-- =====================================================================

-- ---------- 1. accounts.user_id 索引 ----------
-- 迁移 0006 添加了 users.account_id，但在 accounts 表中没有对 user_id 的直接查询
-- 但如果有通过 users 表关联查询的场景，以下索引有帮助
-- 注：accounts.id 是 users.account_id 的外键，这个关系已经通过主键索引覆盖

-- ---------- 2. orders 表复合索引 ----------
-- 常见查询模式：(account_id, status, created_at DESC)
-- 订单列表、状态筛选、排序

create index if not exists idx_orders_account_status_created
  on public.orders (account_id, status, created_at desc);

-- 按状态查询所有账户的订单（管理员）
create index if not exists idx_orders_status_created
  on public.orders (status, created_at desc);

-- ---------- 3. chat_messages 软删除优化 ----------
-- Phase 3 添加了 deleted_at 字段，但没有部分索引
-- 活跃消息查询需要过滤 deleted_at IS NULL

create index if not exists idx_chat_messages_active
  on public.chat_messages (conversation_id, created_at desc, id desc)
  where deleted_at is null;

-- ---------- 4. chat_conversations 索引 ----------
-- 按状态和最后消息时间排序
create index if not exists idx_chat_conversations_status_last_message
  on public.chat_conversations (status, last_message_at desc nulls last);

-- ---------- 5. order_items 索引 ----------
-- 按订单查询商品
create index if not exists idx_order_items_order_id
  on public.order_items (order_id);

-- ---------- 6. notifications 索引 ----------
-- 按用户和已读状态查询
create index if not exists idx_notifications_user_read
  on public.notifications (user_id, read_at nulls first, created_at desc);

-- ---------- 7. chat_typing TTL 清理优化 ----------
-- 用于定期清理过期的 typing 记录
create index if not exists idx_chat_typing_expires
  on public.chat_typing (expires_at);

-- ---------- 8. stock_colors 颜色库存查询优化 ----------
-- 常见查询：按产品ID和颜色查询库存
create index if not exists idx_stock_colors_product_color
  on public.stock_colors (product_id, color_code);

-- ---------- 9. finance_ledger 索引 ----------
-- 按账户和日期范围查询流水
create index if not exists idx_finance_ledger_account_date
  on public.finance_ledger (account_id, recorded_at desc);

-- 按订单查询财务记录
create index if not exists idx_finance_ledger_order
  on public.finance_ledger (order_id);

-- ---------- 10. order_attachments 索引 ----------
-- 按订单查询附件
create index if not exists idx_order_attachments_order
  on public.order_attachments (order_id);

-- ---------- 11. chat_message_metadata 索引 ----------
-- 按消息ID查询元数据
create index if not exists idx_chat_message_metadata_message
  on public.chat_message_metadata (message_id);

-- ---------- 12. account_products 复合查询优化 ----------
-- 按产品查询所有账户的可见性配置
create index if not exists idx_account_products_product_visible
  on public.account_products (product_id, is_visible);

-- ---------- 13. customer_group_mappings 索引 ----------
-- 按客户组查询映射
create index if not exists idx_cgm_customer_group
  on public.customer_group_mappings (customer_group, is_active);

-- 按账户查询所属客户组
create index if not exists idx_cgm_account
  on public.customer_group_mappings (account_id, is_active);

-- =====================================================================
-- 分析注释：这些索引的选择基于以下查询模式分析
-- =====================================================================
--
-- 高频查询：
-- 1. orders.fetchByStatus(accountId, status) - 需要 (account_id, status, created_at)
-- 2. chat.fetchMessages(conversationId) - 需要 deleted_at IS NULL 过滤
-- 3. notifications.list(userId) - 需要 (user_id, read_at, created_at)
-- 4. stock 查询 - 按 product_id + color_code
--
-- 注意事项：
-- - 部分索引（WHERE deleted_at IS NULL）比普通索引更小、更高效
-- - 复合索引列顺序很重要：等值查询列在前，范围/排序列在后
-- - 对于高基数列（如 id），B-tree 索引效果最好
-- =====================================================================
