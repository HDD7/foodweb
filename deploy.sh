#!/usr/bin/env bash
# =============================================================================
# 阿猪餐厅（Food-Yun Web）一键部署脚本 —— 适用于 Debian 12 / Ubuntu 22.04+ 小内存 VPS
#
# 用法（在项目目录内执行）：
#   bash deploy.sh food.example.com                 # 带域名，自动申请 HTTPS
#   bash deploy.sh                                  # 不带域名，仅 IP:端口 访问
#   DEEPSEEK_KEY=sk-xxx bash deploy.sh food.example.com
#   bash deploy.sh food.example.com --firewall      # 顺便开启 ufw（会保留 SSH 端口）
#   bash deploy.sh food.example.com --no-caddy      # 不用 Caddy，自己反代
#
# 可选环境变量：
#   APP_DIR=/opt/azhu-restaurant  安装目录
#   APP_USER=azhu                 运行用户
#   PORT=3000                     监听端口
#   NODE_MAJOR=20                 Node 大版本
#   DEEPSEEK_KEY=sk-xxx           写入 config.json
#   SKIP_NODE=1                   跳过 Node 安装（已装好）
# =============================================================================
set -euo pipefail

DOMAIN=""
ENABLE_UFW=0
USE_CADDY=1
PORT="${PORT:-3000}"
APP_DIR="${APP_DIR:-/opt/azhu-restaurant}"
APP_USER="${APP_USER:-azhu}"
NODE_MAJOR="${NODE_MAJOR:-20}"
DEEPSEEK_KEY="${DEEPSEEK_KEY:-}"
SKIP_NODE="${SKIP_NODE:-0}"

for arg in "$@"; do
  case "$arg" in
    --firewall) ENABLE_UFW=1 ;;
    --no-caddy) USE_CADDY=0 ;;
    --port=*)   PORT="${arg#*=}" ;;
    --dir=*)    APP_DIR="${arg#*=}" ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "未知参数: $arg"; exit 1 ;;
    *)  DOMAIN="$arg" ;;
  esac
done

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 输出小工具 ----------
C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
step() { printf "\n${C_B}==> %s${C_0}\n" "$*"; }
ok()   { printf "${C_G}    ✓ %s${C_0}\n" "$*"; }
warn() { printf "${C_Y}    ! %s${C_0}\n" "$*"; }
die()  { printf "${C_R}    ✗ %s${C_0}\n" "$*"; exit 1; }

# ---------- 0. 前置检查 ----------
step "环境检查"
[ "$(id -u)" -eq 0 ] || die "请用 root 运行（sudo bash deploy.sh ...）"
[ -f "$SRC_DIR/server.js" ] || die "找不到 server.js，请在 Food-web 目录内运行本脚本"
[ -f "$SRC_DIR/package.json" ] || die "找不到 package.json"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  case "$ID" in
    debian|ubuntu) ok "系统: $PRETTY_NAME" ;;
    *) warn "未在 Debian/Ubuntu 上测试（当前 $ID），继续但可能失败" ;;
  esac
fi
ok "安装目录: $APP_DIR　运行用户: $APP_USER　端口: $PORT"

# ---------- 1. 系统基础包 ----------
step "安装基础依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git openssl tar sqlite3 >/dev/null
ok "curl / git / openssl / sqlite3 就绪"

# 时区
timedatectl set-timezone Asia/Shanghai 2>/dev/null && ok "时区: Asia/Shanghai" || warn "时区设置跳过"

# ---------- 2. SWAP（1G 内存必做）----------
step "检查 SWAP"
if swapon --show | grep -q .; then
  ok "已有 SWAP: $(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
elif [ -f /swapfile ]; then
  swapon /swapfile && ok "启用已有 /swapfile"
else
  MEM_MB=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
  SWAP_MB=$([ "$MEM_MB" -lt 2048 ] && echo 1024 || echo 512)
  fallocate -l "${SWAP_MB}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB"
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "已创建 ${SWAP_MB}MB SWAP（内存 ${MEM_MB}MB）"
fi

# ---------- 3. Node.js ----------
step "检查 Node.js"
need_node=1
if command -v node >/dev/null 2>&1; then
  CUR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$CUR" -ge 18 ]; then
    ok "已安装 Node $(node -v)"
    need_node=0
  else
    warn "Node 版本过低（$(node -v)），将升级"
  fi
fi
if [ "$need_node" = "1" ] && [ "$SKIP_NODE" != "1" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  ok "已安装 Node $(node -v) / npm $(npm -v)"
fi

# ---------- 4. 运行用户 ----------
step "准备运行用户"
if id "$APP_USER" >/dev/null 2>&1; then
  ok "用户 $APP_USER 已存在"
else
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  ok "已创建系统用户 $APP_USER"
fi

# ---------- 5. 复制代码 ----------
step "部署代码到 $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  tar -C "$SRC_DIR" \
      --exclude=node_modules --exclude=data --exclude=uploads \
      --exclude=backups --exclude=shots --exclude=.git --exclude=.tmp \
      --exclude='*.log' \
      -cf - . | tar -C "$APP_DIR" -xf -
  ok "代码已同步（保留原有 data / uploads / config.json）"
else
  ok "已在目标目录，跳过复制"
fi
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads" "$APP_DIR/backups"

# ---------- 6. 配置 ----------
step "检查 config.json"
CFG="$APP_DIR/config.json"
if [ -f "$CFG" ]; then
  ok "已存在，保持不动（如需改 key 请手动编辑）"
else
  cp "$APP_DIR/config.example.json" "$CFG"
  JWT_SECRET="$(openssl rand -hex 32)"
  # 用 node 改写，避免 jq 依赖
  node - "$CFG" "$JWT_SECRET" "$DEEPSEEK_KEY" "$PORT" <<'NODEEOF'
const fs = require('fs')
const [file, jwt, deepseekKey, port] = process.argv.slice(2)
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
cfg.jwtSecret = jwt
if (deepseekKey) cfg.deepseekKey = deepseekKey
cfg.port = Number(port) || 3000
if (String(cfg.deepseekKey || '').startsWith('sk-在这里')) cfg.deepseekKey = ''
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
NODEEOF
  chmod 600 "$CFG"
  ok "已生成 config.json（jwtSecret 随机、权限 600）"
  [ -n "$DEEPSEEK_KEY" ] && ok "DeepSeek key 已写入" || warn "未提供 DEEPSEEK_KEY，AI 功能将不可用（可稍后编辑 config.json）"
fi

# ---------- 7. 依赖 ----------
step "安装生产依赖"
cd "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
if [ -f package-lock.json ]; then
  sudo -u "$APP_USER" npm ci --omit=dev --no-audit --no-fund
else
  sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund
fi
ok "依赖安装完成（$(du -sh node_modules | cut -f1)）"

# ---------- 8. systemd ----------
step "配置 systemd 服务"
NODE_BIN="$(command -v node)"
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__PORT__|$PORT|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    "$APP_DIR/deploy/azhu.service.tpl" > /etc/systemd/system/azhu.service
systemctl daemon-reload
systemctl enable azhu >/dev/null 2>&1
systemctl restart azhu
sleep 2
if systemctl is-active --quiet azhu; then
  ok "服务已启动（azhu.service）"
else
  warn "服务未运行，最近日志："
  journalctl -u azhu -n 20 --no-pager || true
fi

# 健康检查
for i in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    ok "健康检查通过：http://127.0.0.1:$PORT/api/health"
    break
  fi
  [ "$i" = "10" ] && warn "健康检查超时，请查看 journalctl -u azhu -n 50"
  sleep 1
done

# ---------- 9. Caddy（域名 + HTTPS）----------
if [ "$USE_CADDY" = "1" ] && [ -n "$DOMAIN" ]; then
  step "配置 Caddy 反向代理（$DOMAIN）"
  if ! command -v caddy >/dev/null 2>&1; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
    ok "Caddy 已安装"
  else
    ok "Caddy 已存在"
  fi
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" \
      "$APP_DIR/deploy/Caddyfile.tpl" > /etc/caddy/Caddyfile
  mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  ok "Caddy 已加载配置，证书将自动申请（需域名已解析到本机）"

  if [ "$ENABLE_UFW" = "1" ]; then
    step "配置防火墙 ufw"
    SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || echo 22)"
    apt-get install -y -qq ufw >/dev/null
    ufw allow "$SSH_PORT/tcp" >/dev/null
    ufw allow 80,443/tcp >/dev/null
    ufw --force enable >/dev/null
    ok "已放行 $SSH_PORT / 80 / 443"
  fi
elif [ "$ENABLE_UFW" = "1" ]; then
  step "配置防火墙 ufw（无域名模式）"
  SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || echo 22)"
  apt-get install -y -qq ufw >/dev/null
  ufw allow "$SSH_PORT/tcp" >/dev/null
  ufw allow "$PORT/tcp" >/dev/null
  ufw --force enable >/dev/null
  ok "已放行 $SSH_PORT / $PORT"
fi

# ---------- 10. 备份 ----------
step "配置每日备份"
chmod +x "$APP_DIR/deploy/backup.sh"
CRON_LINE="0 3 * * * $APP_DIR/deploy/backup.sh >> /var/log/azhu-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "$APP_DIR/deploy/backup.sh"; then
  ok "备份任务已存在"
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  ok "已添加 crontab：每天 03:00 备份（保留 14 天）"
fi

# ---------- 完成 ----------
step "部署完成"
IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo
if [ -n "$DOMAIN" ] && [ "$USE_CADDY" = "1" ]; then
  echo "  访问地址: ${C_G}https://$DOMAIN${C_0}"
  echo "  （首次访问会触发证书签发，若失败请确认域名 A 记录已指向 $IP）"
else
  echo "  访问地址: ${C_G}http://$IP:$PORT${C_0}"
  echo "  （建议配置域名 + HTTPS：bash deploy.sh 你的域名）"
fi
echo
echo "  常用命令:"
echo "    systemctl status azhu          # 查看状态"
echo "    journalctl -u azhu -f          # 实时日志"
echo "    systemctl restart azhu         # 重启"
echo "    $APP_DIR/deploy/backup.sh      # 手动备份"
echo "  配置文件: $APP_DIR/config.json （权限 600，改完 systemctl restart azhu）"
echo
