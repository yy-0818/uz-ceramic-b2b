# Uz Ceramic B2B

乌兹别克斯坦陶瓷工厂 B2B 下单平台。

## 技术栈
- Vue 3 (Composition API + `<script setup>`) + Vite
- TypeScript
- Vue Router 4 + Pinia
- TailwindCSS + 类 Shadcn-vue 组件库
- Supabase (PostgreSQL + Auth + RLS)
- Vue-i18n (俄语 / 乌兹别克语 / 中文)
- PapaParse（CSV 解析）

## 当前进度
- ✅ Phase 1：基建 + 多主体权限 + 登录页
- ✅ Phase 2：商品导入（CSV） + 库存白名单分配 + 客户盲价列表
- ✅ Phase 3：订单流转 + 状态机 + 财务记账 + 仓库发货
- ⏳ Phase 4：报表 / 通知（计划）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 填入 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY

# 3. 初始化 Supabase
#    在 Supabase SQL Editor 中运行：
#    supabase/migrations/0001_init.sql

# 4. 启动开发服务器
npm run dev
```

## 部署到 Vercel

1. 推送到 GitHub
2. 在 Vercel 中导入项目
3. 设置环境变量：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Build Command: `npm run build`
5. Output Directory: `dist`

## 关键设计

### 多主体账户
- 三类账户：`1_public` / `2_cash` / `3_export`
- `parent_id` 仅用于"归纳"关系；通过 RLS 让客户也能看到父账户的库存
- 字段本地化：俄语 р/с、МФО、ИНН、Директор

### 库存白名单（核心解耦）
- CSV 的"客户组"（共 30+ 个，如 B客户、S客户、A中鹏）≠ 账户
- 流程：上传 CSV → 后台手动把客户组映射到账户 → 勾选账户+商品 → 批量 upsert
- 真正可见性由 `account_products.is_visible` + RLS 共同决定

### 盲价列表
- 前台完全不显示单价
- 按"整箱"下单，浏览器实时换算平方米
- 库存显示来自 `stock_level_1 + stock_level_2`

## 目录结构
```
src/
├── assets/             # Tailwind 入口
├── components/ui/      # 类 Shadcn-vue 组件
├── composables/        # useAuth, useCart, useInventoryCsv, useProducts, useAccountProducts, useAccounts
├── directives/         # v-permission
├── lib/                # supabase client, i18n, utils
├── locales/            # ru.ts, uz.ts, zh.ts
├── router/             # 路由 + 守卫
├── types/              # 数据库类型
└── views/
    ├── admin/          # 后台：导入 + 分配
    ├── auth/           # 登录
    ├── customer/       # 客户：浏览 + 结算
    └── layout/         # AppLayout
```

## Phase 3 订单状态机

```
pending ──► audited ──► accounted ──► shipped
   │           │             │
   ▼           ▼             ▼
cancelled  cancelled     (终态)
```

- `pending`  → `audited`  ：开单员审核（必填单价）
- `audited`  → `accounted`：财务记账（伪资金流）
- `accounted`→ `shipped`：仓库发货（触发器自动扣减账户库存）
- 任一未发状态 → `cancelled`（客户或管理员）

所有状态转移由数据库触发器 `fn_order_status_guard` 校验。
库存扣减由 `fn_ship_deduct_stock` 在 `accounted → shipped` 时自动执行。
所有状态变更写入 `order_status_log` 审计表。

## 部署 SQL（按顺序）

1. `supabase/migrations/0001_init.sql` — 基础 4 表 + RLS
2. `supabase/migrations/0002_orders.sql` — 订单 + 状态机 + 触发器

