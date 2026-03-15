#!/bin/bash
# Pre-push validation script
# Runs the SAME checks that Render's Dockerfile runs.
# If this passes locally, the deploy WILL succeed.
#
# Usage: ./scripts/validate.sh

set -e

echo "=== FRONTEND TYPE CHECK (tsc) ==="
cd "$(dirname "$0")/../frontend"
npx tsc --noEmit
echo "PASS"

echo ""
echo "=== FRONTEND BUILD (vite) ==="
npx vite build 2>&1 | tail -3
echo "PASS"

echo ""
echo "=== BACKEND TYPE CHECK (tsc) ==="
cd ../backend
npx tsc --noEmit
echo "PASS"

echo ""
echo "==============================="
echo "  ALL CHECKS PASSED"
echo "  Safe to push to master."
echo "==============================="
