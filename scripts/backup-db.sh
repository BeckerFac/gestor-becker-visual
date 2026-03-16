#!/bin/bash
# Database backup script
# Usage: ./scripts/backup-db.sh
# Requires DATABASE_URL env variable

set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="gestor_backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "Creating backup: ${FILENAME}..."
pg_dump "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists > "${BACKUP_DIR}/${FILENAME}"

# Keep only last 30 backups
cd "$BACKUP_DIR"
ls -t gestor_backup_*.sql | tail -n +31 | xargs rm -f 2>/dev/null || true

SIZE=$(du -h "${FILENAME}" | cut -f1)
echo "Backup complete: ${BACKUP_DIR}/${FILENAME} (${SIZE})"
