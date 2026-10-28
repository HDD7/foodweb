#!/usr/bin/env bash
# 阿猪餐厅 · 每日备份
# 安装位置：/opt/azhu-restaurant/deploy/backup.sh
# 建议 crontab：0 3 * * * /opt/azhu-restaurant/deploy/backup.sh >> /var/log/azhu-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F)"
TARGET="$BACKUP_DIR/$STAMP.tar.gz"

# SQLite 建议先做一致性检查点，避免备份到半写的 WAL
if [ -f data/food-yun.db ] && command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 data/food-yun.db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
fi

tar czf "$TARGET" data uploads 2>/dev/null || tar czf "$TARGET" data

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "[$(date '+%F %T')] 备份完成: $TARGET ($SIZE)"

# 清理过期备份
find "$BACKUP_DIR" -name '*.tar.gz' -mtime "+$KEEP_DAYS" -delete
COUNT="$(find "$BACKUP_DIR" -name '*.tar.gz' | wc -l)"
echo "[$(date '+%F %T')] 当前保留 $COUNT 份备份（保留 $KEEP_DAYS 天）"
