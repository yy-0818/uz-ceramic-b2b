-- =====================================================================
-- 0024_notifications_i18n.sql
-- Phase 6: 通知本地化
-- - DB 不再硬编码中文 title/body, 改为存 'kind_key' + payload (i18n 变量)
-- - 前端用 t('notif.' + kind_key + '.title', payload) 渲染
-- - 兼容旧数据: title/body 保留, 但前端优先用 kind_key
-- =====================================================================

-- chat_message 通知: 改用 kind_key = 'chat_message'
drop trigger if exists trg_chat_message_notify on public.chat_messages;
drop function if exists public.fn_chat_message_notify();

create or replace function public.fn_chat_message_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_sender_name text;
  v_body_preview text;
begin
  if new.message_type = 'system' then
    return new;
  end if;

  select coalesce(full_name, 'Staff') into v_sender_name
  from public.users where id = new.sender_id;

  v_body_preview := case
    when new.message_kind = 'image' then '[image]'
    when new.message_kind = 'order_card' then '[order_card]'
    else substr(new.body, 1, 80)
  end;

  for v_member in
    select distinct user_id
    from public.chat_conversation_members
    where conversation_id = new.conversation_id
      and left_at is null
      and user_id <> new.sender_id
  loop
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      v_member.user_id,
      'chat_message',
      v_sender_name,                          -- 英文 fallback
      v_body_preview,                          -- 英文 fallback (或 [image])
      format('/chat?conversation=%s', new.conversation_id),
      jsonb_build_object(
        'kind_key', 'chat_message',
        'sender_name', v_sender_name,
        'message_kind', new.message_kind,
        'preview', v_body_preview,
        'conversation_id', new.conversation_id,
        'message_id', new.id
      )
    );
  end loop;

  return new;
end $$;

create trigger trg_chat_message_notify
  after insert on public.chat_messages
  for each row
  execute function public.fn_chat_message_notify();

-- order_status 通知: 改用 kind_key = 'order_status'
drop trigger if exists trg_order_status_notify on public.orders;
drop function if exists public.fn_order_status_notify();

create or replace function public.fn_order_status_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_meta jsonb;
  v_prev text;
  v_next text;
  v_status_key text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_prev := old.status;
  v_next := new.status;
  v_status_key := case v_next
    when 'pending'   then 'pending'
    when 'audited'   then 'audited'
    when 'accounted' then 'accounted'
    when 'shipped'   then 'shipped'
    when 'cancelled' then 'cancelled'
    else 'unknown'
  end;

  v_meta := jsonb_build_object(
    'kind_key', 'order_status',
    'order_id', new.id,
    'order_no', new.order_no,
    'from_status', v_prev,
    'to_status', v_next,
    'status_key', v_status_key
  );

  -- 客户
  for v_user in
    select distinct u.id as user_id
    from public.orders o
    join public.accounts a on a.id = o.account_id
    join public.users u on u.id = a.owner_id
    where o.id = new.id
  loop
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      v_user.user_id,
      'order_status',
      format('Order #%s', new.order_no),   -- 英文 fallback
      format('Status: %s', v_next),
      format('/orders/%s', new.id),
      v_meta
    );
  end loop;

  -- 客服
  for v_user in
    select distinct u.id as user_id
    from public.chat_conversations c
    join public.chat_conversation_members m on m.conversation_id = c.id and m.left_at is null
    join public.users u on u.id = m.user_id
    where c.subject_order_id = new.id
      and u.role in ('admin','checker','finance','warehouse')
  loop
    insert into public.notifications (user_id, kind, title, body, link, payload)
    values (
      v_user.user_id,
      'order_status',
      format('Order #%s', new.order_no),
      format('Status: %s', v_next),
      format('/orders/%s', new.id),
      v_meta
    );
  end loop;

  return new;
end $$;

create trigger trg_order_status_notify
  after update of status on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.fn_order_status_notify();
