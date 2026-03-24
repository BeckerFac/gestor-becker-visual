---
name: deploy
description: Deploy GESTIA to production with all checks
disable-model-invocation: true
---

# Deploy GESTIA

## Pre-Flight Checks
1. `git status` -- no uncommitted changes
2. `cd backend && npx tsc --noEmit` -- zero type errors
3. `cd frontend && npx tsc --noEmit` -- zero type errors
4. `cd "/home/facu/BECKER/Gestor BeckerVisual" && bash scripts/validate.sh` -- 141+ tests passing
5. `cd frontend && npm run build` -- clean production build

## Deploy Frontend (Vercel)
6. `git push origin main` -- triggers Vercel auto-deploy
7. Wait for Vercel build to complete
8. Check https://frontend-sooty-six-91.vercel.app loads

## Deploy Backend (Docker)
9. `docker-compose -f docker-compose.production.yml build`
10. `docker-compose -f docker-compose.production.yml up -d`
11. Verify /api/health returns 200

## Post-Deploy Verification
12. Login with test account (e2etest@test.com)
13. Create a test invoice (non-fiscal)
14. Check dashboard loads with data
15. Verify AFIP connection (FEDummy)

## If Anything Fails
- Do NOT force push or skip checks
- Fix the issue, rerun ALL checks
- Backend rollback: `docker-compose -f docker-compose.production.yml down && docker-compose -f docker-compose.production.yml up -d --build`
