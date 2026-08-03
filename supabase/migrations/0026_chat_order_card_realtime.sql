-- =====================================================================
-- 0026_chat_order_card_realtime.sql
-- Phase 7: 分享订单卡片状态实时同步
-- - RPC 写入 metadata 时, 顺手存一份 status / status_label / total_amount
--   (发送那一刻的快照). 客户端订阅 orders 表 realtime 持续更新最新值.
-- - 客户端 ChatOrderCard 组件按 order_id 聚合最新实时状态.
-- =====================================================================

-- 1. 重写 rpc_chat_create_order_card_message, 写入更多元数据
create or replace function public.rpc_chat_create_order_card_message(
  p_conversation uuid,
  p_order_id uuid,
  p_client_message_id text default null
)
returns table (message_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_msg_id uuid;
  v_cmid text;
  v_status text;
  v_total numeric;
  v_order_no text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  v_cmid := coalesce(
    p_client_message_id,
    gen_random_uuid()::text
  );

  -- 幂等
  select id into v_msg_id
  from public.chat_messages
  where sender_id = v_uid and client_message_id = v_cmid::uuid;
  if v_msg_id is not null then
    return query select v_msg_id, false;
    return;
  end if;

  if not public.is_chat_member_of(p_conversation) and not public.is_chat_staff() then
    raise exception 'not a member of this conversation';
  end if;

  -- 快照当前订单状态/金额/单号 (发送那一刻)
  select status, total_amount, order_no
    into v_status, v_total, v_order_no
  from public.orders
  where id = p_order_id;

  insert into public.chat_messages (
    conversation_id, sender_id, message_type, message_kind, body,
    client_message_id, created_at
  )
  values (
    p_conversation, v_uid, 'text', 'order_card', '[订单]', v_cmid::uuid, now()
  )
  returning id into v_msg_id;

  insert into public.chat_message_metadata (message_id, payload)
  values (
    v_msg_id,
    jsonb_build_object(
      'order_id',     p_order_id,
      'order_no',     coalesce(v_order_no, '—'),
      'status',       coalesce(v_status, 'pending'),
      'total_amount', coalesce(v_total, 0)
    )
  );

  return query select v_msg_id, true;
end $$;

grant execute on function public.rpc_chat_create_order_card_message(
  uuid, uuid, text
) to authenticated;

-- 2. 让前端能订阅订单变更. 现有 trigger 已经写入 notify channel 'orders'
--    (notification trigger on UPDATE 写 .status 变化), 但 channel 名需统一.
--    注意: supabase realtime 默认 'public' schema 下的表都进 supabase_realtime publication.
--    这里仅显式补一下 orders, 防止发布遗漏.
do $$
begin
  perform 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders';
  if not found then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;