#!/bin/bash
# Pre-push validation script
# Runs the SAME checks that Render's Dockerfile runs.
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
echo "==============================="
echo "  ALL CHECKS PASSED"
echo "  All backend tests OK"
echo "  TypeScript OK (frontend + backend)"
echo "  Vite build OK"
echo "  Safe to push to master."
echo "==============================="
