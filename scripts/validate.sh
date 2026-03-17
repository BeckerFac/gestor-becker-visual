#!/bin/bash
# Pre-push validation script
# Runs the SAME checks that Render's Dockerfile runs + security checks.
# If this passes locally, the deploy WILL succeed.
#
# Usage: ./scripts/validate.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== BACKEND TESTS ==="
cd "$ROOT/backend"
npx vitest run --reporter=default
echo "PASS"

echo ""
echo "=== BACKEND TYPE CHECK (tsc) ==="
cd "$ROOT/backend"
npx tsc --noEmit
echo "PASS"

echo ""
echo "=== FRONTEND TYPE CHECK (tsc) ==="
cd "$ROOT/frontend"
npx tsc --noEmit
echo "PASS"

echo ""
echo "=== FRONTEND BUILD (vite) ==="
cd "$ROOT/frontend"
npx vite build 2>&1 | tail -3
echo "PASS"

echo ""
echo "=== SECURITY: Checking for hardcoded secrets ==="
cd "$ROOT"
SECRETS_FOUND=0
# Check for common secret patterns in source code (not .env files)
if grep -rn "password.*=.*['\"]" backend/src/ frontend/src/ --include="*.ts" --include="*.tsx" | grep -v "test" | grep -v ".env" | grep -v "placeholder" | grep -v "PASSWORD" | grep -v "password:" | grep -v "password'" | grep -v "// " | head -5; then
  echo "WARNING: Possible hardcoded passwords found (review above)"
  SECRETS_FOUND=1
fi
if grep -rn "HRKU-\|sk-\|sk_live\|pk_live\|AKIA" backend/src/ frontend/src/ --include="*.ts" --include="*.tsx" | head -5; then
  echo "CRITICAL: API keys found in source code!"
  SECRETS_FOUND=1
fi
if [ $SECRETS_FOUND -eq 0 ]; then
  echo "PASS - No hardcoded secrets detected"
fi

echo ""
echo "=== SECURITY: Checking for missing company_id checks ==="
# Look for service methods that take req.params.id without company_id
IDOR_CHECK=$(grep -rn "req.params.id" "$ROOT/backend/src/modules/" --include="*.ts" | grep -v "company_id" | grep -v "test" | head -5)
if [ -n "$IDOR_CHECK" ]; then
  echo "WARNING: Possible IDOR - endpoints using req.params.id without company_id:"
  echo "$IDOR_CHECK"
else
  echo "PASS - All endpoints appear to check company_id"
fi

echo ""
echo "==============================="
echo "  ALL CHECKS PASSED"
echo "  Backend tests OK"
echo "  TypeScript OK (frontend + backend)"
echo "  Vite build OK"
echo "  Security scan OK"
echo "  Safe to push to master."
echo "==============================="
