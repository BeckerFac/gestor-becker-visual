#!/bin/bash
# Uptime monitoring setup guide and configuration helper
# Run this script to see setup instructions for various monitoring services
#
# Usage: ./scripts/setup-monitoring.sh [base_url]
# Example: ./scripts/setup-monitoring.sh https://gestor.beckervisual.com

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
HEALTH_URL="${BASE_URL}/health"
DETAILED_URL="${BASE_URL}/health/detailed"

cat <<BANNER
===============================================
  Gestor BeckerVisual - Monitoring Setup Guide
===============================================

Base URL: ${BASE_URL}
Health endpoint: ${HEALTH_URL}
Detailed health: ${DETAILED_URL}

BANNER

# Test health endpoint if reachable
echo "--- Testing health endpoint ---"
if command -v curl >/dev/null 2>&1; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Health endpoint is responding (HTTP $HTTP_CODE)"
    echo "Response:"
    curl -s "$HEALTH_URL" 2>/dev/null | python3 -m json.tool 2>/dev/null || curl -s "$HEALTH_URL" 2>/dev/null
    echo ""
  elif [ "$HTTP_CODE" = "000" ]; then
    echo "Cannot reach ${HEALTH_URL} (server not running or URL incorrect)"
  else
    echo "Health endpoint returned HTTP $HTTP_CODE"
  fi
else
  echo "curl not found, skipping endpoint test"
fi

echo ""

cat <<UPTIMEROBOT
=== 1. UptimeRobot (Free Tier - Recommended) ===

Steps:
  1. Go to https://uptimerobot.com and create a free account
  2. Click "Add New Monitor"
  3. Configure:
     - Monitor Type: HTTP(s)
     - Friendly Name: Gestor BeckerVisual
     - URL: ${HEALTH_URL}
     - Monitoring Interval: 5 minutes (free tier)
  4. Alert Contacts:
     - Add your email address
     - Optional: Add Slack/Telegram webhook
  5. Advanced Settings:
     - HTTP Method: GET
     - Expected Status Code: 200
     - Keyword: "ok" (Type: exists)
     - Timeout: 30 seconds

Free tier includes:
  - 50 monitors
  - 5-minute check intervals
  - Email alerts
  - Status page

UPTIMEROBOT

cat <<BETTERUPTIME
=== 2. Better Uptime (Alternative) ===

Steps:
  1. Go to https://betteruptime.com
  2. Create monitor:
     - URL: ${HEALTH_URL}
     - Check period: 3 minutes
     - Regions: US East, EU West
  3. Configure incidents:
     - Confirmation period: 2 minutes
     - Recovery period: 2 minutes
  4. Set up alert policy with email/Slack/SMS

BETTERUPTIME

cat <<CRON_HEALTHCHECK
=== 3. DIY Health Check (via cron) ===

Add to crontab (crontab -e):

  # Check health every 5 minutes, alert on failure
  */5 * * * * curl -sf ${HEALTH_URL} > /dev/null || echo "Gestor BeckerVisual is DOWN at \$(date)" | mail -s "ALERT: Gestor Down" admin@beckervisual.com

For Slack webhook alerts:

  */5 * * * * curl -sf ${HEALTH_URL} > /dev/null || curl -X POST -H 'Content-type: application/json' --data '{"text":"ALERT: Gestor BeckerVisual is DOWN!"}' \$SLACK_WEBHOOK_URL

CRON_HEALTHCHECK

cat <<DOCKER_HC
=== 4. Docker Health Check (already configured) ===

The Dockerfile includes a built-in health check:
  HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3

To check: docker inspect --format='{{.State.Health.Status}}' gestor-becker-api-prod

DOCKER_HC

cat <<BACKUP_CRON
=== 5. Backup Cron Setup ===

Add to crontab (crontab -e):

  # Daily backup at 2:00 AM
  0 2 * * * cd ${PWD} && DATABASE_URL=\$DATABASE_URL ./scripts/backup-cron.sh >> ./logs/backup-cron.log 2>&1

  # Weekly DB maintenance on Sundays at 3:00 AM
  0 3 * * 0 cd ${PWD} && DATABASE_URL=\$DATABASE_URL ./scripts/db-maintenance.sh >> ./logs/db-maintenance.log 2>&1

BACKUP_CRON

cat <<ENV_VARS
=== 6. Environment Variables for Monitoring ===

Add to your .env or hosting platform:

  # Sentry (error tracking)
  SENTRY_DSN=https://your-key@sentry.io/your-project

  # Backup notifications (optional)
  BACKUP_NOTIFY_WEBHOOK=https://hooks.slack.com/services/xxx/yyy/zzz

ENV_VARS

echo "=== Setup guide complete ==="
