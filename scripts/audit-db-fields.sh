#!/bin/bash
# Audit database schema
# Usage: DATABASE_URL=... ./scripts/audit-db-fields.sh

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "=== DATABASE SCHEMA AUDIT ==="
echo ""

psql "$DATABASE_URL" -c "
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
"
