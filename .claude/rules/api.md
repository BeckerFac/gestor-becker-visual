---
paths:
  - "backend/src/routes/**"
  - "backend/src/controllers/**"
  - "backend/src/services/**"
---

# GESTIA API Rules

## Input Validation
- Validate ALL inputs before processing
- Validate CUIT with modulo 11 before sending to AFIP
- Return 400 with clear error on validation failure
- Never trust client-sent IDs -- always use session company_id

## Multi-Tenant Isolation (CRITICAL)
- EVERY query MUST filter by company_id
- NEVER expose data across tenants (IDOR prevention)
- Verify company_id in every endpoint, no exceptions

## Authentication
- ALL routes require JWT auth middleware except /auth/*
- requireAuth() throws 401 if no session
- Never trust client-sent user IDs -- use req.user
- Rate limit auth endpoints: 5 req/min

## Error Handling
- Consistent format: { error: string, code?: string }
- Never expose stack traces or internal errors
- Log errors with context (route, user_id, company_id, input)
- Return appropriate HTTP codes:
  - 400 = bad input, 401 = no auth, 403 = forbidden
  - 404 = not found, 429 = rate limited, 500 = server error

## Response Envelope
- Always return wrapped: { users: [...] }, { user: {...} }
- Frontend api.ts MUST unwrap: data.users, data.user, etc.
- Set Cache-Control headers where appropriate

## SQL Safety
- ALWAYS use parameterized queries (never string interpolation)
- NEVER use SELECT * in queries that return to frontend
- Whitelist columns explicitly to prevent leaking sensitive fields
- Use transactions (BEGIN/COMMIT/ROLLBACK) for multi-table operations

## AFIP Integration
- Always call FECompUltimoAutorizado before emitting invoices
- Cache WSAA tokens (12h validity)
- Implement FECompConsultar recovery for timeouts
- Validate CbteFch date ranges before sending
