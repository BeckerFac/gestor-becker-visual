---
name: validate
description: Run all GESTIA checks before commit
---

# Validate GESTIA

Run ALL checks. If ANY step fails, STOP and fix.

```bash
cd "/home/facu/BECKER/Gestor BeckerVisual" && bash scripts/validate.sh
```

This runs: 141+ backend tests + tsc backend + tsc frontend + vite build.

If validate.sh doesn't exist or fails, run manually:
1. `cd backend && npx tsc --noEmit`
2. `cd backend && npm test`
3. `cd frontend && npx tsc --noEmit`
4. `cd frontend && npm run build`

Report: PASS (all green) or FAIL (with specific errors).
