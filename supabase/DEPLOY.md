# 客户邀请 + 登录流程 · 部署手册

## 1. 数据库迁移（按顺序）

```bash
# 本地
supabase db push

# 或对远端 project
supabase link --project-ref <your-project-ref>
supabase db push
```

迁移文件（按时间顺序会执行）：

| 文件 | 内容 |
|------|------|
| `0001`–`0006` | 基础架构 + 库存组 + 邀请表 |
| `0007_invite_rls_and_unique.sql` | customer_invites RLS + accounts.user_id UNIQUE |
| `0008_handle_new_user_trigger.sql` | auth.users → public.users 自动同步 trigger |
| `0009_seed.sql` | 演示数据 + admin 初始化文档 |
| `0010_cgm_multi_unique.sql` | customer_group_mappings 改为多对多 |

## 2. 部署 Edge Functions

```bash
supabase functions deploy complete-invite
supabase functions deploy reset-customer-password
supabase functions deploy bind-customer-email
```

Supabase Dashboard → Edge Functions → Secrets 确认：
- `SUPABASE_URL`（自动注入）
- `SUPABASE_SERVICE_ROLE_KEY`（自动注入）

**不需要** `--no-verify-jwt`：3 个函数都有内置 JWT 校验（`reset-customer-password` / `bind-customer-email` 拒绝非 admin；`complete-invite` 公开但用 token 当凭证）。

## 3. 初始化 admin 账号

> 关键：`auth.users` 通过 Dashboard 创建 → trigger `trg_handle_new_user` 自动写 `public.users`（role=admin, account_id=_internal 哨兵账号）。

```bash
# 1. Supabase Dashboard → Authentication → Users → Add user
#    Email: admin@yourdomain.com
#    Password: <强密码>
#    Auto Confirm User: ✅
# 2. （可选）update public.users SET full_name='管理员真名' WHERE id=<该 user.id>
```

### 内部员工（checker / warehouse / finance）

Dashboard 创 user 时 **不需要** 传 role metadata，trigger 默认按 admin 处理。
如需分角色，先在 `auth.users` 的 raw_user_meta_data 加 `{"role":"checker"}` 再创建。
或者在 trigger 跑完后手动 SQL：

```sql
UPDATE public.users SET role = 'checker' WHERE id = '<auth.users.id>';
```

### 客户（customer）

**禁止** Dashboard 直接创 user。客户账号必须经 invite 流程：

```
admin → AccountsAdminPage → 创建/选父账号 → 填 login_email → 分配库存组 → 生成邀请
  ↓
客户点链接 → /customer-invite?token=... → 设密码 → 自动登录
```

`complete-invite` Edge Function 会用 service_role 同时写 `accounts.user_id` + `public.users`。

## 4. 创建一个客户（端到端）

1. Supabase 已跑完所有迁移 + 部署 Edge Functions
2. 登录 admin：访问 `/login` → 上面创建的 admin 邮箱 + 密码
3. AccountsAdminPage → 新建主账号：
   - 账号名：`I客户`
   - 登录邮箱：`customer1@yourdomain.com`
   - 类型：`1 公户`
4. 给主账号加子账号（可选）
5. 给主账号"分配库存组"：勾选 `A中鹏`、`B客户` 等
6. 主账号右上 ⋯ → "邀请客户登录"
   - 系统生成链接：`https://yourdomain.com/customer-invite?token=...`
   - 展示 login_email：`customer1@yourdomain.com`
7. 把链接 + 邮箱发给客户
8. 客户打开链接 → 设密码 → 自动登录 → 看到 `/catalog`（已按白名单筛选）

## 5. 客户重置密码

admin → 父账号 ⋯ → "重置密码" → 拿到 12 位临时密码 → 微信发给客户。
`reset-customer-password` Edge Function 校验 admin 角色 + 标记旧 invite 失效。

## 6. 客户改密码（自助）

当前未实现自助改密码 UI。客户必须联系 admin 重置。
下一迭代：在 `/customer/account` 加 `supabase.auth.updateUser({ password })` 入口。

## 7. Vercel 部署

Project Settings → Environment Variables（**3 种环境都配**）：

| 变量 | 值 |
|------|----|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `<anon key>` |
| `VITE_SUPABASE_FUNCTIONS_URL` | `https://<ref>.supabase.co/functions/v1` |

触发重新部署。

## 8. 故障排查

| 症状 | 原因 |
|------|------|
| 客户点链接报"邀请完成功能未启用" | `VITE_SUPABASE_FUNCTIONS_URL` 没设置 |
| 客户登录后被踢回 `/` | `public.users` 没该客户行 → trigger 没跑 → 检查 0008 迁移 |
| admin 重置密码报 401 | Edge Function 部署了旧版本 → 重新 deploy |
| admin 重置密码报 403 | 调用者不是 admin → 检查 `public.users.role` |
| 同一个邀请链接 7 天后还能用 | 服务端 expires_at 校验失败 → 检查 Edge Function 部署版本 |
| 父账号生成的 login_email 是 `xxx_xxxxxxxx@customer.local` | admin 没填 login_email 字段 → 在父账号编辑里补一个真实邮箱