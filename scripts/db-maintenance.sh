#!/bin/bash
# Database maintenance script
# Runs VACUUM, ANALYZE, checks indexes, reports table sizes
#
# Usage: ./scripts/db-maintenance.sh
# Recommended: Run weekly via cron
# Crontab: 0 3 * * 0 /path/to/scripts/db-maintenance.sh
#
# Requires: DATABASE_URL env variable

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${ROOT_DIR}/logs/db-maintenance.log"

# Load env if available
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

if [ -z "${DATABASE_URL:-}" ]; then
  log "ERROR: DATABASE_URL not set"
  exit 1
fi

log "=== Database Maintenance Started ==="

# 1. VACUUM ANALYZE - reclaim space and update statistics
log "Running VACUUM ANALYZE..."
psql "$DATABASE_URL" -c "VACUUM ANALYZE;" 2>>"$LOG_FILE"
log "VACUUM ANALYZE complete"

# 2. Report table sizes
log "--- Table Sizes ---"
psql "$DATABASE_URL" -c "
SELECT
  schemaname || '.' || relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS data_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
  n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

# 3. Check for unused indexes
log "--- Unused Indexes (candidates for removal) ---"
psql "$DATABASE_URL" -c "
SELECT
  schemaname || '.' || relname AS table_name,
  indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
  idx_scan AS index_scans
FROM pg_stat_user_indexes i
JOIN pg_index USING (indexrelid)
WHERE idx_scan < 10
  AND indisunique IS FALSE
  AND pg_relation_size(i.indexrelid) > 8192
ORDER BY pg_relation_size(i.indexrelid) DESC
LIMIT 15;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

# 4. Check for missing indexes (tables with lots of sequential scans)
log "--- Tables with High Sequential Scans (may need indexes) ---"
psql "$DATABASE_URL" -c "
SELECT
  schemaname || '.' || relname AS table_name,
  seq_scan AS sequential_scans,
  idx_scan AS index_scans,
  n_live_tup AS row_count,
  CASE WHEN (seq_scan + idx_scan) > 0
    THEN round(100.0 * idx_scan / (seq_scan + idx_scan), 1)
    ELSE 0
  END AS index_use_pct
FROM pg_stat_user_tables
WHERE n_live_tup > 100
  AND seq_scan > idx_scan
ORDER BY seq_scan DESC
LIMIT 10;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

# 5. Check for bloated tables (dead tuples)
log "--- Bloated Tables (high dead tuple count) ---"
psql "$DATABASE_URL" -c "
SELECT
  schemaname || '.' || relname AS table_name,
  n_live_tup AS live_tuples,
  n_dead_tup AS dead_tuples,
  CASE WHEN n_live_tup > 0
    THEN round(100.0 * n_dead_tup / n_live_tup, 1)
    ELSE 0
  END AS dead_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 100
ORDER BY n_dead_tup DESC
LIMIT 10;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

# 6. Database size
log "--- Database Size ---"
psql "$DATABASE_URL" -c "
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS database_size;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

# 7. Active connections
log "--- Connection Stats ---"
psql "$DATABASE_URL" -c "
SELECT
  state,
  count(*) AS connections
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY count(*) DESC;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

# 8. Check for long-running queries
log "--- Long Running Queries (>30s) ---"
psql "$DATABASE_URL" -c "
SELECT
  pid,
  now() - query_start AS duration,
  state,
  left(query, 100) AS query_preview
FROM pg_stat_activity
WHERE state != 'idle'
  AND query_start < now() - interval '30 seconds'
  AND datname = current_database()
ORDER BY query_start
LIMIT 5;
" 2>>"$LOG_FILE" | tee -a "$LOG_FILE"

log "=== Database Maintenance Completed ==="
