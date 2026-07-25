-- =====================================================================
-- 0002_orders.sql
-- Phase 3: 订单流转 + 状态机 + 库存扣减 + 财务流水
-- =====================================================================

-- ---------- orders 订单主表 ----------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        varchar(32) not null unique,                  -- 业务单号，可读
  account_id      uuid not null references public.accounts(id) on delete restrict,
  created_by      uuid references auth.users(id) on delete set null,  -- 下单人
  audited_by      uuid references auth.users(id) on delete set null,  -- 审核员
  accounted_by    uuid references auth.users(id) on delete set null,  -- 财务登记人
  shipped_by      uuid references auth.users(id) on delete set null,  -- 仓库发货人
  -- 状态机
  status          varchar(16) not null default 'pending'
                    check (status in ('pending','audited','accounted','shipped','cancelled')),
  -- 口径：金额按"客户实际录入"为准，审核员可改价；总金额按 order_items 实时汇总
  remark          varchar(512),
  created_at      timestamptz not null default now(),
  audited_at      timestamptz,
  accounted_at    timestamptz,
  shipped_at      timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists idx_orders_account on public.orders(account_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created on public.orders(created_at desc);

-- ---------- order_items 订单明细 ----------
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  -- 客户下单时是按"箱"输入，我们保留 boxes + 自动换算 m2
  boxes           integer not null check (boxes > 0),
  m2_per_box      numeric(10,3) not null,                       -- 冗余：方便历史追溯（防止 conversion_rate 改动）
  m2_total        numeric(12,3) generated always as (boxes * m2_per_box) stored,
  -- 价格：客户下盲单时是空，审核员改价时填写
  -- currency: 默认 UZS（乌兹别克斯坦索姆）
  unit_price      numeric(18,2),
  line_total      numeric(18,2) generated always as (boxes * coalesce(unit_price, 0)) stored,
  -- 库存级别（1 级 / 2 级），用于后续精细扣减
  stock_level     smallint not null default 1 check (stock_level in (1,2)),
  remark          varchar(255),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_product on public.order_items(product_id);

-- ---------- finance_ledger 财务流水（伪资金流，仅记账）----------
create table if not exists public.finance_ledger (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete restrict,
  direction       varchar(8) not null check (direction in ('debit','credit')),  -- 借 / 贷
  amount          numeric(18,2) not null,
  currency        varchar(8) not null default 'UZS',
  memo            varchar(255),
  recorded_by     uuid references auth.users(id) on delete set null,
  recorded_at     timestamptz not null default now()
);

create index if not exists idx_finance_ledger_order on public.finance_ledger(order_id);
create index if not exists idx_finance_ledger_account on public.finance_ledger(account_id);

-- ---------- 订单状态审计（可选但有用）----------
create table if not exists public.order_status_log (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  from_status     varchar(16),
  to_status       varchar(16) not null,
  changed_by      uuid references auth.users(id) on delete set null,
  changed_at      timestamptz not null default now(),
  note            varchar(255)
);

create index if not exists idx_order_status_log_order on public.order_status_log(order_id);

-- =====================================================================
-- 触发器：updated_at 自动维护（复用 0001 的函数）
-- =====================================================================
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_order_items_updated_at on public.order_items;
create trigger trg_order_items_updated_at before update on public.order_items
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- 业务函数：状态机转移 + 库存扣减
-- =====================================================================

-- 1. 状态机强制：只有允许的转移才被接受
create or replace function public.fn_order_status_guard()
returns trigger language plpgsql as $$
begin
  if old.status = new.status then
    return new;
  end if;

  -- 允许的转移：pending -> audited/cancelled, audited -> accounted/cancelled, accounted -> shipped, shipped -> (终态)
  if old.status = 'pending' and new.status in ('audited','cancelled') then
    -- audited 时记录审核时间
    if new.status = 'audited' then
      new.audited_at = now();
    end if;
    return new;
  elsif old.status = 'audited' and new.status in ('accounted','cancelled') then
    if new.status = 'accounted' then
      new.accounted_at = now();
    end if;
    return new;
  elsif old.status = 'accounted' and new.status = 'shipped' then
    new.shipped_at = now();
    return new;
  else
    raise exception '非法状态转移: % -> %', old.status, new.status;
  end if;
end $$;

drop trigger if exists trg_order_status_guard on public.orders;
create trigger trg_order_status_guard before update on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public.fn_order_status_guard();

-- 2. 状态日志：自动写入 order_status_log
create or replace function public.fn_order_status_log()
returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_log (order_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_order_status_log on public.orders;
create trigger trg_order_status_log after update on public.orders
  for each row execute function public.fn_order_status_log();

-- 3. 库存扣减：accounted -> shipped 时，按 order_items.stock_level 扣减 account_products 库存
create or replace function public.fn_ship_deduct_stock()
returns trigger language plpgsql as $$
declare
  r record;
  cur_l1 int;
  cur_l2 int;
begin
  if new.status = 'shipped' and old.status <> 'shipped' then
    for r in
      select product_id, stock_level, sum(boxes) as qty
      from public.order_items
      where order_id = new.id
      group by product_id, stock_level
    loop
      select stock_level_1, stock_level_2 into cur_l1, cur_l2
      from public.account_products
      where account_id = new.account_id and product_id = r.product_id
      for update;

      if not found then
        raise exception '账户 % 没有商品 % 的白名单，无法发货', new.account_id, r.product_id;
      end if;

      if r.stock_level = 1 then
        if cur_l1 < r.qty then
          raise exception '库存不足: account=% product=% need=% have=%', new.account_id, r.product_id, r.qty, cur_l1;
        end if;
        update public.account_products
          set stock_level_1 = stock_level_1 - r.qty
          where account_id = new.account_id and product_id = r.product_id;
      else
        if cur_l2 < r.qty then
          raise exception '库存不足: account=% product=% need=% have=%', new.account_id, r.product_id, r.qty, cur_l2;
        end if;
        update public.account_products
          set stock_level_2 = stock_level_2 - r.qty
          where account_id = new.account_id and product_id = r.product_id;
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists trg_ship_deduct_stock on public.orders;
create trigger trg_ship_deduct_stock after update on public.orders
  for each row execute function public.fn_ship_deduct_stock();

-- 4. 业务单号生成器（年月日 + 6 位日序号）
create or replace function public.fn_generate_order_no()
returns varchar language plpgsql as $$
declare
  d date := current_date;
  prefix varchar := to_char(d, 'YYYYMMDD');
  seq int;
begin
  select coalesce(max(
    nullif(substring(order_no from 9 for 6), '')::int
  ), 0) + 1
  into seq
  from public.orders
  where order_no like prefix || '%';
  return prefix || lpad(seq::text, 6, '0');
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.finance_ledger enable row level security;
alter table public.order_status_log enable row level security;

-- orders：客户只能看自己账户的订单（含 parent 归纳账户的订单）
drop policy if exists orders_customer_select on public.orders;
create policy orders_customer_select on public.orders
  for select using (
    account_id = public.current_account_id()
    or
    account_id = (
      select parent_id from public.accounts
      where id = public.current_account_id() and parent_id is not null
    )
  );

-- orders：客户可创建（必须落到自己的账户）
drop policy if exists orders_customer_insert on public.orders;
create policy orders_customer_insert on public.orders
  for insert with check (
    account_id = public.current_account_id()
    and created_by = auth.uid()
  );

-- orders：管理员/审核员/财务/仓库 全权
drop policy if exists orders_staff_all on public.orders;
create policy orders_staff_all on public.orders
  for all using (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  ) with check (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  );

-- order_items：跟随订单可见性
drop policy if exists oi_via_order on public.order_items;
create policy oi_via_order on public.order_items
  for select using (
    exists(select 1 from public.orders o where o.id = order_items.order_id)
  );

drop policy if exists oi_staff_all on public.order_items;
create policy oi_staff_all on public.order_items
  for all using (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  ) with check (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  );

-- 客户可在创建订单的同一事务里插入 order_items（通过 RPC 走 service 角色）；
-- 前端只允许读取自己的，所以这里只对 staff 开放写

-- finance_ledger：客户不可见，仅 staff
drop policy if exists fl_staff_all on public.finance_ledger;
create policy fl_staff_all on public.finance_ledger
  for all using (
    public.current_user_role() in ('admin','finance','checker')
  ) with check (
    public.current_user_role() in ('admin','finance','checker')
  );

-- order_status_log：客户可见自己订单的日志（透明）
drop policy if exists osl_via_order on public.order_status_log;
create policy osl_via_order on public.order_status_log
  for select using (
    exists(
      select 1 from public.orders o
      where o.id = order_status_log.order_id
        and (
          o.account_id = public.current_account_id()
          or o.account_id = (
            select parent_id from public.accounts
            where id = public.current_account_id() and parent_id is not null
          )
        )
    )
  );

drop policy if exists osl_staff_all on public.order_status_log;
create policy osl_staff_all on public.order_status_log
  for all using (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  ) with check (
    public.current_user_role() in ('admin','checker','finance','warehouse')
  );
