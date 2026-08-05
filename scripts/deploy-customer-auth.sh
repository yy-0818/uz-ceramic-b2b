#!/usr/bin/env bash
# scripts/deploy-customer-auth.sh
# 一键部署客户邀请 + 登录全链路到 Supabase
# 使用：./scripts/deploy-customer-auth.sh [--yes]
#   --yes: 自动确认 db push 的交互提示

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-olnawzjgfrbduzfithjj}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

AUTO_YES="false"
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES="true" ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

# ---------- 颜色 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $*" >&2; }

# ---------- 0. 前置检查 ----------
log "▶ 0. 前置检查"

if ! command -v supabase >/dev/null 2>&1; then
  err "supabase CLI 未安装。brew install supabase/tap/supabase"
  exit 1
fi

if ! supabase projects list >/dev/null 2>&1; then
  err "supabase 未登录。先跑: supabase login"
  exit 1
fi

log "✓ supabase CLI 已登录，准备链接 project: $PROJECT_REF"

# ---------- 1. Link project ----------
log "▶ 1. Link project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF" 2>&1 | sed 's/^/  /'

# ---------- 2. 跑迁移 ----------
log "▶ 2. 跑数据库迁移"

# supabase db push 在交互模式下会卡 [Y/n]；用 --yes 或管道 yes 自动确认
if [[ "$AUTO_YES" == "true" ]]; then
  PUSH_CMD=(supabase db push --yes)
else
  PUSH_CMD=(supabase db push)
fi

# 实时输出，不退出；命令本身失败由 set -e 处理
"${PUSH_CMD[@]}" 2>&1 | sed 's/^/  /' || {
  err "迁移失败，请看上方的 SQL 错误并修复后重跑"
  exit 1
}
log "✓ 迁移完成"

# ---------- 3. 部署 5 个 Edge Functions ----------
log "▶ 3. 部署 Edge Functions"
for func in complete-invite reset-customer-password bind-customer-email create-staff-user change-own-password reset-staff-password; do
  log "  → $func"
  supabase functions deploy "$func" --project-ref "$PROJECT_REF" 2>&1 | sed 's/^/    /'
done
log "✓ Edge Functions 已部署"

# ---------- 4. 验证 ----------
log "▶ 4. 验证部署"

run_query() {
  supabase db query --linked "$1" 2>&1 | tr -d '\n'
}

# 4a. 检查 _internal 哨兵账号
INTERNAL=$(run_query "SELECT id::text FROM public.accounts WHERE id = '00000000-0000-0000-0000-000000000000';")
if [[ "$INTERNAL" == *'00000000-0000-0000-0000-000000000000'* ]]; then
  log "  ✓ _internal 哨兵账号就位"
else
  warn "  ✗ _internal 哨兵账号缺失（迁移 0008 没跑）"
fi

# 4b. 检查 trigger（精确匹配 schema，避免 pg_trigger 全表扫描卡住）
TRIGGER=$(run_query "SELECT tgname FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid WHERE c.relname = 'users' AND c.relnamespace = 'auth'::regnamespace AND tgname = 'trg_handle_new_user';")
if [[ "$TRIGGER" == *'"tgname": "trg_handle_new_user"'* ]]; then
  log "  ✓ trigger trg_handle_new_user 已安装"
else
  warn "  ✗ trigger trg_handle_new_user 缺失"
fi

# 4c. 检查 customer_invites RLS
RLS=$(run_query "SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_invites';")
if [[ "$RLS" == *'"relrowsecurity": true'* ]]; then
  log "  ✓ customer_invites RLS 已启用"
else
  warn "  ✗ customer_invites RLS 未启用"
fi

# 4d. Edge Function 健康检查（调用 OPTIONS 应返回 200）
FN_URL="https://$PROJECT_REF.supabase.co/functions/v1"
log "  → curl $FN_URL/complete-invite (OPTIONS)"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  "$FN_URL/complete-invite")
if [[ "$STATUS" == "200" ]]; then
  log "  ✓ complete-invite 已上线"
else
  warn "  ✗ complete-invite 返回 $STATUS"
fi

# ---------- 5. 接下来 ----------
cat <<EOF

${GREEN}部署完成。${NC}

下一步：
  1. Vercel → Project Settings → Environment Variables:
       VITE_SUPABASE_FUNCTIONS_URL=https://$PROJECT_REF.supabase.co/functions/v1
     （Production / Preview / Development 三种环境都配）

  2. Supabase Dashboard → Authentication → Users → Add user
       Email:    admin@yourdomain.com
       Password: <强密码>
       Auto Confirm User: ✅
     trigger 会自动写 public.users 行（role=admin, account_id=_internal）

  3. 浏览器访问你的 Vercel 域名 → /login → 用上面 admin 账号登录

  4. AccountsAdminPage → 新建主账号 → 填 login_email → 分配库存组 → 邀请客户

EOF
