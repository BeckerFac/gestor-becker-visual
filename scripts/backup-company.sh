#!/bin/bash
# Per-company backup script
# Usage: ./scripts/backup-company.sh <company_id>
# Exports ALL data for one company as JSON
# Requires DATABASE_URL env variable

set -euo pipefail

COMPANY_ID="${1:-}"
if [ -z "$COMPANY_ID" ]; then
  echo "ERROR: Company ID required"
  echo "Usage: $0 <company_id>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups/companies}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="company_${COMPANY_ID}_${TIMESTAMP}.json.gz"

# Load env if available
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

mkdir -p "$BACKUP_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backing up company: ${COMPANY_ID}..."

# Verify company exists
COMPANY_EXISTS=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM companies WHERE id = '${COMPANY_ID}'" 2>/dev/null)
if [ "$COMPANY_EXISTS" = "0" ]; then
  echo "ERROR: Company ${COMPANY_ID} not found"
  exit 1
fi

# Tables with direct company_id
TABLES_DIRECT=(
  "companies:id"
  "users:company_id"
  "enterprises:company_id"
  "customers:company_id"
  "products:company_id"
  "categories:company_id"
  "brands:company_id"
  "orders:company_id"
  "quotes:company_id"
  "invoices:company_id"
  "cheques:company_id"
  "cobros:company_id"
  "pagos:company_id"
  "purchases:company_id"
  "remitos:company_id"
  "receipts:company_id"
  "banks:company_id"
  "tags:company_id"
  "price_lists:company_id"
  "warehouses:company_id"
  "suppliers:company_id"
  "subscriptions:company_id"
  "audit_log:company_id"
  "invitations:company_id"
)

# Start JSON output
TMPFILE=$(mktemp)
echo "{" > "$TMPFILE"
echo "  \"metadata\": {" >> "$TMPFILE"
echo "    \"company_id\": \"${COMPANY_ID}\"," >> "$TMPFILE"
echo "    \"exported_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> "$TMPFILE"
echo "    \"row_counts\": {" >> "$TMPFILE"

TOTAL_ROWS=0
FIRST_COUNT=true

for entry in "${TABLES_DIRECT[@]}"; do
  TABLE="${entry%%:*}"
  FK="${entry##*:}"

  COUNT=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM ${TABLE} WHERE ${FK} = '${COMPANY_ID}'" 2>/dev/null || echo "0")
  COUNT=$(echo "$COUNT" | tr -d '[:space:]')
  TOTAL_ROWS=$((TOTAL_ROWS + COUNT))

  if [ "$FIRST_COUNT" = true ]; then
    FIRST_COUNT=false
  else
    echo "," >> "$TMPFILE"
  fi
  printf "      \"%s\": %s" "$TABLE" "$COUNT" >> "$TMPFILE"
done

echo "" >> "$TMPFILE"
echo "    }," >> "$TMPFILE"
echo "    \"total_rows\": ${TOTAL_ROWS}" >> "$TMPFILE"
echo "  }," >> "$TMPFILE"
echo "  \"data\": {" >> "$TMPFILE"

# Export each table
FIRST_TABLE=true
for entry in "${TABLES_DIRECT[@]}"; do
  TABLE="${entry%%:*}"
  FK="${entry##*:}"

  if [ "$FIRST_TABLE" = true ]; then
    FIRST_TABLE=false
  else
    echo "," >> "$TMPFILE"
  fi

  DATA=$(psql "$DATABASE_URL" -t -A -c "SELECT json_agg(t) FROM (SELECT * FROM ${TABLE} WHERE ${FK} = '${COMPANY_ID}') t" 2>/dev/null || echo "null")
  DATA=$(echo "$DATA" | tr -d '[:space:]')
  if [ -z "$DATA" ] || [ "$DATA" = "" ]; then
    DATA="[]"
  fi
  if [ "$DATA" = "null" ]; then
    DATA="[]"
  fi

  printf "    \"%s\": %s" "$TABLE" "$DATA" >> "$TMPFILE"
done

echo "" >> "$TMPFILE"
echo "  }" >> "$TMPFILE"
echo "}" >> "$TMPFILE"

# Compress
gzip -c "$TMPFILE" > "${BACKUP_DIR}/${FILENAME}"
rm -f "$TMPFILE"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete: ${BACKUP_DIR}/${FILENAME} (${SIZE}, ${TOTAL_ROWS} rows)"

# Verify gzip integrity
if ! gunzip -t "${BACKUP_DIR}/${FILENAME}" 2>/dev/null; then
  echo "ERROR: Backup file is corrupted"
  rm -f "${BACKUP_DIR}/${FILENAME}"
  exit 1
fi

# Save metadata
echo "{\"company_id\":\"${COMPANY_ID}\",\"file\":\"${FILENAME}\",\"size\":\"${SIZE}\",\"rows\":${TOTAL_ROWS},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "${BACKUP_DIR}/${FILENAME}.meta.json"

# Keep only last 10 backups per company
cd "$BACKUP_DIR"
ls -t "company_${COMPANY_ID}_"*.json.gz 2>/dev/null | tail -n +11 | while read f; do
  rm -f "$f" "${f}.meta.json"
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup verified and metadata saved"
