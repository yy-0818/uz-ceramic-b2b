-- Migration 0010:
--   customer_group_mappings 表：customer_group UNIQUE 改为 (customer_group, account_id) 联合 UNIQUE
--   业务：父账号 ↔ 库存组 是多对多（一个父账号可看多个库存组，同一库存组可被多个父账号看）
--   旧 UNIQUE 强制"一个客户组只能绑一个父账号"，与实际业务冲突

alter table public.customer_group_mappings
  drop constraint if exists customer_group_mappings_customer_group_key;

drop index if exists customer_group_mappings_customer_group_key;

create unique index if not exists uq_cgm_customer_group_account
  on public.customer_group_mappings (customer_group, account_id);

-- 索引保留（虽然 unique index 已经覆盖，但兼容老查询）
create index if not exists idx_cgm_customer_group
  on public.customer_group_mappings (customer_group);

comment on table public.customer_group_mappings is
  '库存组 ↔ 父账号 多对多映射。一个父账号可看多个库存组，同一库存组可被多个父账号看到。';