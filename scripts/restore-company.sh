#!/bin/bash
# Per-company restore script
# Usage: ./scripts/restore-company.sh <company_id> <backup_file>
# Restores company data from a JSON backup
# WARNING: This will DELETE all current data for the company and replace it
# Requires DATABASE_URL env variable

set -euo pipefail

COMPANY_ID="${1:-}"
BACKUP_FILE="${2:-}"

if [ -z "$COMPANY_ID" ] || [ -z "$BACKUP_FILE" ]; then
  echo "ERROR: Company ID and backup file required"
  echo "Usage: $0 <company_id> <backup_file>"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env if available
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restoring company: ${COMPANY_ID} from ${BACKUP_FILE}..."

# Decompress
TMPFILE=$(mktemp)
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" > "$TMPFILE"
else
  cp "$BACKUP_FILE" "$TMPFILE"
fi

# Validate JSON structure
if ! python3 -c "import json; d=json.load(open('$TMPFILE')); assert 'metadata' in d and 'data' in d" 2>/dev/null; then
  echo "ERROR: Invalid backup file format"
  rm -f "$TMPFILE"
  exit 1
fi

# Verify company_id matches
BACKUP_COMPANY=$(python3 -c "import json; print(json.load(open('$TMPFILE'))['metadata']['company_id'])" 2>/dev/null)
if [ "$BACKUP_COMPANY" != "$COMPANY_ID" ]; then
  echo "ERROR: Backup is for company ${BACKUP_COMPANY}, not ${COMPANY_ID}"
  rm -f "$TMPFILE"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup validated. Starting restore..."
echo "WARNING: This will replace ALL data for company ${COMPANY_ID}"
echo "Backup date: $(python3 -c "import json; print(json.load(open('$TMPFILE'))['metadata']['exported_at'])" 2>/dev/null)"
echo "Total rows: $(python3 -c "import json; print(json.load(open('$TMPFILE'))['metadata'].get('total_rows', 'unknown'))" 2>/dev/null)"

# The actual restore requires careful handling of FK constraints.
# For safety, we use a Python script that processes the JSON
# and generates SQL INSERT statements in the correct order.
python3 - "$TMPFILE" "$COMPANY_ID" "$DATABASE_URL" <<'PYEOF'
import json
import sys
import psycopg2

backup_file = sys.argv[1]
company_id = sys.argv[2]
db_url = sys.argv[3]

with open(backup_file) as f:
    backup = json.load(f)

data = backup['data']
conn = psycopg2.connect(db_url)
conn.autocommit = False
cur = conn.cursor()

try:
    # Delete existing data in reverse dependency order
    delete_order = [
        'audit_log', 'invitations', 'pending_invitations',
        'subscriptions', 'usage_tracking',
        'crm_deal_stage_history', 'crm_deal_documents', 'crm_activities', 'crm_deals', 'crm_stages',
        'cobro_items', 'cobros', 'pagos',
        'receipt_items', 'receipts',
        'cheque_status_history', 'cheques',
        'remito_items', 'remitos',
        'purchase_items', 'purchases',
        'order_status_history', 'order_items', 'orders',
        'invoice_items', 'invoices',
        'quote_items', 'quotes',
        'product_components', 'product_pricing', 'stock_movements', 'stock', 'products',
        'price_list_items', 'price_lists',
        'entity_tags', 'tags',
        'categories', 'brands',
        'warehouses', 'suppliers',
        'permissions', 'sessions', 'payments',
        'customers', 'enterprises',
        'banks',
        'users',
    ]

    for table in delete_order:
        try:
            if table in ('companies',):
                continue
            cur.execute(f"DELETE FROM {table} WHERE company_id = %s", (company_id,))
        except Exception:
            try:
                # Some child tables don't have company_id
                conn.rollback()
                conn.autocommit = False
            except Exception:
                pass

    # Insert data in correct dependency order
    insert_order = [
        'companies', 'users', 'enterprises', 'customers', 'suppliers',
        'categories', 'brands', 'products', 'warehouses', 'banks',
        'tags', 'price_lists',
        'orders', 'quotes', 'invoices', 'purchases',
        'cheques', 'cobros', 'pagos', 'remitos', 'receipts',
        'subscriptions', 'audit_log', 'invitations',
    ]

    for table in insert_order:
        rows = data.get(table, [])
        if not rows:
            continue
        if table == 'companies':
            # Update existing company instead of inserting
            for row in rows:
                cols = [k for k in row.keys() if k != 'id']
                sets = ', '.join(f'{c} = %s' for c in cols)
                vals = [row[c] for c in cols]
                vals.append(company_id)
                cur.execute(f"UPDATE companies SET {sets} WHERE id = %s", vals)
            continue

        # Generic insert
        for row in rows:
            cols = list(row.keys())
            placeholders = ', '.join(['%s'] * len(cols))
            col_names = ', '.join(cols)
            vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in row.values()]
            try:
                cur.execute(
                    f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING",
                    vals
                )
            except Exception as e:
                print(f"  Warning: {table} row skip: {e}")
                conn.rollback()
                conn.autocommit = False

    conn.commit()
    print(f"Restore complete for company {company_id}")

except Exception as e:
    conn.rollback()
    print(f"ERROR: Restore failed: {e}")
    sys.exit(1)
finally:
    cur.close()
    conn.close()
PYEOF

rm -f "$TMPFILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restore finished"
