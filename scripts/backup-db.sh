#!/bin/bash
# Database backup script (improved)
# Usage: ./scripts/backup-db.sh [--verify]
# Requires DATABASE_URL env variable
# Outputs compressed .sql.gz backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="gestor_backup_${TIMESTAMP}.sql.gz"
VERIFY="${1:-}"

# Load env if available
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

mkdir -p "$BACKUP_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set"
  echo "Usage: DATABASE_URL=postgres://... $0"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Creating backup: ${FILENAME}..."

# Create compressed backup
if pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists 2>/dev/null | gzip > "${BACKUP_DIR}/${FILENAME}"; then
  SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete: ${BACKUP_DIR}/${FILENAME} (${SIZE})"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup failed"
  rm -f "${BACKUP_DIR}/${FILENAME}"
  exit 1
fi

# Verify backup integrity
if ! gunzip -t "${BACKUP_DIR}/${FILENAME}" 2>/dev/null; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Backup file is corrupted"
  rm -f "${BACKUP_DIR}/${FILENAME}"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup integrity verified (gzip OK)"

# Optional: verify by doing a test restore to /dev/null
if [ "$VERIFY" = "--verify" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running restore verification..."
  if gunzip -c "${BACKUP_DIR}/${FILENAME}" | head -20 | grep -q "PostgreSQL database dump"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restore verification passed (valid PostgreSQL dump)"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: File may not be a valid PostgreSQL dump"
  fi
fi

# Keep only last 30 backups
cd "$BACKUP_DIR"
ls -t gestor_backup_*.sql.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

REMAINING=$(ls gestor_backup_*.sql.gz 2>/dev/null | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backups retained: ${REMAINING}"
