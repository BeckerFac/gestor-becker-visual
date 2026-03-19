#!/bin/bash
# Automated database backup with retention policy
# Usage: Add to crontab: 0 2 * * * /path/to/scripts/backup-cron.sh
#
# Retention policy:
#   - Daily backups: 7 days
#   - Weekly backups (Sundays): 4 weeks
#   - Monthly backups (1st of month): 3 months
#
# Requires: DATABASE_URL env variable or .env file in project root
# Optional: BACKUP_DIR (default: ./backups), BACKUP_NOTIFY_WEBHOOK

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${ROOT_DIR}/logs/backup.log"

# Load env if available
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly" "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

notify_webhook() {
  if [ -n "${BACKUP_NOTIFY_WEBHOOK:-}" ]; then
    curl -s -X POST "$BACKUP_NOTIFY_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"$1\"}" >/dev/null 2>&1 || true
  fi
}

if [ -z "${DATABASE_URL:-}" ]; then
  log "ERROR: DATABASE_URL not set"
  notify_webhook "BACKUP FAILED: DATABASE_URL not set"
  exit 1
fi

# Create daily backup
DAILY_FILE="gestor_daily_${TIMESTAMP}.sql.gz"
log "Starting daily backup: ${DAILY_FILE}"

if pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists 2>>"$LOG_FILE" | gzip > "${BACKUP_DIR}/daily/${DAILY_FILE}"; then
  SIZE=$(du -h "${BACKUP_DIR}/daily/${DAILY_FILE}" | cut -f1)
  log "Daily backup complete: ${DAILY_FILE} (${SIZE})"
else
  log "ERROR: Daily backup failed"
  notify_webhook "BACKUP FAILED: pg_dump error"
  exit 1
fi

# Verify backup integrity (quick check - decompress and check for valid SQL)
if ! gunzip -t "${BACKUP_DIR}/daily/${DAILY_FILE}" 2>/dev/null; then
  log "ERROR: Backup file is corrupted"
  notify_webhook "BACKUP FAILED: Corrupted backup file"
  rm -f "${BACKUP_DIR}/daily/${DAILY_FILE}"
  exit 1
fi

log "Backup integrity verified"

# Weekly backup (copy Sunday's daily to weekly)
if [ "$DAY_OF_WEEK" = "7" ]; then
  WEEKLY_FILE="gestor_weekly_${TIMESTAMP}.sql.gz"
  cp "${BACKUP_DIR}/daily/${DAILY_FILE}" "${BACKUP_DIR}/weekly/${WEEKLY_FILE}"
  log "Weekly backup created: ${WEEKLY_FILE}"
fi

# Monthly backup (copy 1st of month to monthly)
if [ "$DAY_OF_MONTH" = "01" ]; then
  MONTHLY_FILE="gestor_monthly_${TIMESTAMP}.sql.gz"
  cp "${BACKUP_DIR}/daily/${DAILY_FILE}" "${BACKUP_DIR}/monthly/${MONTHLY_FILE}"
  log "Monthly backup created: ${MONTHLY_FILE}"
fi

# Retention cleanup
log "Applying retention policy..."

# Keep 7 daily backups
cd "$BACKUP_DIR/daily"
ls -t gestor_daily_*.sql.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true
DAILY_COUNT=$(ls gestor_daily_*.sql.gz 2>/dev/null | wc -l)
log "Daily backups retained: ${DAILY_COUNT}"

# Keep 4 weekly backups
cd "$BACKUP_DIR/weekly"
ls -t gestor_weekly_*.sql.gz 2>/dev/null | tail -n +5 | xargs rm -f 2>/dev/null || true
WEEKLY_COUNT=$(ls gestor_weekly_*.sql.gz 2>/dev/null | wc -l)
log "Weekly backups retained: ${WEEKLY_COUNT}"

# Keep 3 monthly backups
cd "$BACKUP_DIR/monthly"
ls -t gestor_monthly_*.sql.gz 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true
MONTHLY_COUNT=$(ls gestor_monthly_*.sql.gz 2>/dev/null | wc -l)
log "Monthly backups retained: ${MONTHLY_COUNT}"

log "Backup cron completed successfully"
notify_webhook "Backup OK: ${DAILY_FILE} (${SIZE})"
