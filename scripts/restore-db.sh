#!/bin/bash
# Database restore script
# Usage: ./scripts/restore-db.sh <backup_file>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <backup_file.sql>"
  echo "Available backups:"
  ls -la backups/gestor_backup_*.sql 2>/dev/null || echo "  No backups found"
  exit 1
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "WARNING: This will REPLACE all data in the database."
echo "Restoring from: $1"
echo "Press Ctrl+C to cancel, or Enter to continue..."
read

psql "$DATABASE_URL" < "$1"
echo "Restore complete."
