import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

// Silence side-effect modules that users.service touches.
vi.mock('../src/lib/security-monitor', () => ({
  recordRoleChange: vi.fn(),
}))
vi.mock('../src/shared/permissions.constants', () => ({
  ROLE_TEMPLATES: {},
  ROLE_HIERARCHY: { owner: 3, admin: 2, user: 1 },
  FULL_ACCESS_ROLES: ['owner', 'admin'],
  SUB_ACTIONS: {},
}))
vi.mock('../src/modules/billing/billing.service', () => ({
  billingService: { createTrialSubscription: vi.fn(), getSubscription: vi.fn() },
}))
vi.mock('../src/modules/email/email.service', () => ({
  emailService: {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../src/utils/access-code', () => ({
  warnIfLegacyAccessCode: vi.fn(),
}))
// bcrypt — not used by our tests but imported by auth.service
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('x'), compare: vi.fn().mockResolvedValue(true) },
  hash: vi.fn().mockResolvedValue('x'),
  compare: vi.fn().mockResolvedValue(true),
}))

import { authorizeCircuit, assertCanAccessCircuit } from '../src/middlewares/authorizeCircuit'
import { ApiError } from '../src/middlewares/errorHandler'
import { UsersService } from '../src/modules/users/users.service'

// Helpers -----------------------------------------------------------

function fakeReq(overrides: Partial<{ user: any; query: any; body: any }> = {}): any {
  return {
    user: overrides.user,
    query: overrides.query ?? {},
    body: overrides.body ?? {},
  }
}

function runMw(mw: any, req: any): Promise<any> {
  return new Promise(resolve => {
    mw(req, {}, (err?: any) => resolve(err))
  })
}

// -------------------------------------------------------------------

describe('Sol/Luna permissions - authorizeCircuit middleware', () => {
  beforeEach(() => resetMocks())

  // T1
  it('blocks ?fiscal_type=no_fiscal for a user without Luna access', async () => {
    const mw = authorizeCircuit('query')
    const req = fakeReq({ user: { id: 'u1', can_access_luna: false }, query: { fiscal_type: 'no_fiscal' } })
    const err = await runMw(mw, req)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).statusCode).toBe(403)
  })

  // T2
  it('allows ?fiscal_type=no_fiscal for a Luna-enabled user', async () => {
    const mw = authorizeCircuit('query')
    const req = fakeReq({ user: { id: 'u1', can_access_luna: true }, query: { fiscal_type: 'no_fiscal' } })
    const err = await runMw(mw, req)
    expect(err).toBeUndefined()
  })

  // T3
  it('falls through when no circuit param is present', async () => {
    const mw = authorizeCircuit('query')
    const req = fakeReq({ user: { id: 'u1', can_access_luna: false } })
    const err = await runMw(mw, req)
    expect(err).toBeUndefined()
  })

  // T4
  it("source='body' reads fiscal_type from body", async () => {
    const mw = authorizeCircuit('body')
    const req = fakeReq({ user: { id: 'u1', can_access_luna: false }, body: { fiscal_type: 'no_fiscal' } })
    const err = await runMw(mw, req)
    expect((err as ApiError).statusCode).toBe(403)
  })

  // Extra: custom function source
  it("custom function source is honoured", async () => {
    const mw = authorizeCircuit((r: any) => r.headers?.['x-circuit'])
    const req: any = { user: { can_access_luna: false }, headers: { 'x-circuit': 'no_fiscal' } }
    const err = await runMw(mw, req)
    expect((err as ApiError).statusCode).toBe(403)
  })

  // Extra: unknown circuit returns 400
  it('rejects unknown circuit value with 400', async () => {
    const mw = authorizeCircuit('query')
    const req = fakeReq({ user: { id: 'u1', can_access_luna: true }, query: { fiscal_type: 'bogus' } })
    const err = await runMw(mw, req)
    expect((err as ApiError).statusCode).toBe(400)
  })

  // Extra: 401 when no user
  it('returns 401 when no authenticated user is present', async () => {
    const mw = authorizeCircuit('query')
    const req = fakeReq({ query: { fiscal_type: 'no_fiscal' } })
    const err = await runMw(mw, req)
    expect((err as ApiError).statusCode).toBe(401)
  })

  // T5
  it('assertCanAccessCircuit throws 404 when leak404=true (default)', () => {
    expect(() => assertCanAccessCircuit({ can_access_luna: false }, 'no_fiscal')).toThrow(
      expect.objectContaining({ statusCode: 404 })
    )
  })

  // T6
  it('assertCanAccessCircuit throws 403 when leak404=false', () => {
    expect(() => assertCanAccessCircuit({ can_access_luna: false }, 'no_fiscal', false)).toThrow(
      expect.objectContaining({ statusCode: 403 })
    )
  })

  // Extra: fiscal circuit is always allowed
  it('assertCanAccessCircuit allows fiscal for any user', () => {
    expect(() => assertCanAccessCircuit({ can_access_luna: false }, 'fiscal')).not.toThrow()
  })
})

describe('Sol/Luna permissions - UsersService.setCircuitAccess', () => {
  let svc: UsersService
  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
    svc = new UsersService()
  })

  // T7
  it('rejects non-owner/admin caller with 403', async () => {
    await expect(
      svc.setCircuitAccess('company-A', 'caller', 'editor', 'target', true)
    ).rejects.toMatchObject({ statusCode: 403 })
    // No DB touched
    expect(mockDbExecute).not.toHaveBeenCalled()
  })

  // T8 / T9
  it('owner can grant Luna access; DB is updated and target is returned', async () => {
    // Call order inside setCircuitAccess:
    // 1) SELECT target (same company)
    // 2) UPDATE users SET can_access_luna
    // 3) DELETE sessions for target
    // Then getUser() → 1) SELECT target, 2) getUserPermissions SELECT
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 'target', email: 't@x.com', role: 'editor', can_access_luna: false }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // DELETE sessions
      .mockResolvedValueOnce({ rows: [{ id: 'target', email: 't@x.com', name: 'T', role: 'editor', active: true, created_at: '', last_login: null, can_access_luna: true }] })
      .mockResolvedValueOnce({ rows: [] }) // getUserPermissions

    const out = await svc.setCircuitAccess('company-A', 'owner-id', 'owner', 'target', true)
    expect(out.can_access_luna).toBe(true)
    expect(mockDbExecute).toHaveBeenCalledTimes(5)
  })

  // T10
  it('createUser defaults can_access_luna to false when caller does not pass it', async () => {
    // createUser flow:
    // 1) SELECT existing email (empty)
    // 2) INSERT user
    // Then getUser (1 SELECT + 1 SELECT permissions)
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] }) // email check
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [{ id: 'new-id', email: 'n@x.com', name: 'N', role: 'editor', active: true, created_at: '', last_login: null, can_access_luna: false }] })
      .mockResolvedValueOnce({ rows: [] })

    const created = await svc.createUser(
      'company-A',
      { email: 'n@x.com', name: 'N', password: 'Password123', role: 'editor' },
      'owner-id',
      undefined,
      'owner',
    )
    expect(created.can_access_luna).toBe(false)

    // Inspect the actual INSERT call: its sql template should include a false literal.
    const insertCall = mockDbExecute.mock.calls[1][0] as any
    // The template aggregates `values` — last value embedded should be false.
    expect(insertCall.values).toContain(false)
  })

  // Extra: createUser ignores can_access_luna from a non-owner/admin caller
  it('createUser ignores can_access_luna when caller is not owner/admin', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-id', email: 'n@x.com', name: 'N', role: 'editor', active: true, created_at: '', last_login: null, can_access_luna: false }] })
      .mockResolvedValueOnce({ rows: [] })

    await svc.createUser(
      'company-A',
      { email: 'n@x.com', name: 'N', password: 'Password123', role: 'editor', can_access_luna: true },
      'caller-id',
      undefined,
      'editor',
    )
    const insertCall = mockDbExecute.mock.calls[1][0] as any
    expect(insertCall.values).toContain(false)
    expect(insertCall.values).not.toContain(true)
  })

  // T12
  it('getUsers normalizes can_access_luna to boolean in the payload', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [
        { id: 'u1', email: 'a@x.com', name: 'A', role: 'owner', active: true, can_access_luna: true },
        { id: 'u2', email: 'b@x.com', name: 'B', role: 'editor', active: true, can_access_luna: null },
      ],
    })
    const rows = await svc.getUsers('company-A')
    expect(rows[0].can_access_luna).toBe(true)
    expect(rows[1].can_access_luna).toBe(false)
  })

  // T13 — soft warning, not hard block
  it('owner revoking own last-remaining Luna flag logs warning but still succeeds', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockDbExecute
      // target SELECT (caller == target, currently has luna)
      .mockResolvedValueOnce({ rows: [{ id: 'owner-id', email: 'o@x.com', role: 'owner', can_access_luna: true }] })
      // remaining count SELECT → 0 others with luna
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      // UPDATE
      .mockResolvedValueOnce({ rows: [] })
      // DELETE sessions
      .mockResolvedValueOnce({ rows: [] })
      // getUser SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'owner-id', email: 'o@x.com', name: 'O', role: 'owner', active: true, created_at: '', last_login: null, can_access_luna: false }] })
      // getUserPermissions
      .mockResolvedValueOnce({ rows: [] })

    const out = await svc.setCircuitAccess('company-A', 'owner-id', 'owner', 'owner-id', false)
    expect(out.can_access_luna).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // T15 — revoking access wipes sessions (invalidates stale JWT claim cache)
  it('setCircuitAccess deletes the target user sessions on change', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 'target', email: 't@x.com', role: 'editor', can_access_luna: true }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // DELETE sessions
      .mockResolvedValueOnce({ rows: [{ id: 'target', email: 't@x.com', name: 'T', role: 'editor', active: true, created_at: '', last_login: null, can_access_luna: false }] })
      .mockResolvedValueOnce({ rows: [] })

    await svc.setCircuitAccess('company-A', 'owner-id', 'admin', 'target', false)

    // The third call is the DELETE FROM sessions template. We find any call whose
    // template strings mention "sessions".
    const anyDeletesSessions = mockDbExecute.mock.calls.some((call: any[]) => {
      const tpl = call[0]
      return Array.isArray(tpl?.strings) && tpl.strings.join(' ').includes('sessions')
    })
    expect(anyDeletesSessions).toBe(true)
  })
})

// T11 / T14 are covered at the AuthService level — the JWT payload includes
// can_access_luna and /auth/me returns it. We assert via the public surface:
describe('Sol/Luna permissions - JWT + /auth/me surface', () => {
  beforeEach(() => resetMocks())

  it('AuthService.generateTokens embeds can_access_luna in the access token', async () => {
    // Import lazily so the mocks are applied first.
    const { AuthService } = await import('../src/modules/auth/auth.service')
    const svc = new AuthService()
    // generateTokens is private — reach through `as any`.
    const tokens = (svc as any).generateTokens('uid', 'e@x.com', 'company-A', 'editor', true)
    const jwt = await import('jsonwebtoken')
    const decoded: any = jwt.default.decode(tokens.accessToken)
    expect(decoded.can_access_luna).toBe(true)
  })

  it('/auth/me (AuthService.me) returns can_access_luna normalized to boolean', async () => {
    const { AuthService } = await import('../src/modules/auth/auth.service')
    const svc = new AuthService()
    // me() executes: 1 main SELECT then optional getUserPermissions SELECT
    mockDbExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 'u1', email: 'e@x.com', name: 'E', role: 'owner', company_id: 'c1',
          active: true, is_superadmin: false, email_verified: true, can_access_luna: 'true', // raw
          onboarding_completed: true, enabled_modules: [],
          subscription_status: 'active', trial_ends_at: null, grace_ends_at: null,
        }]
      })

    const out: any = await svc.me('u1')
    expect(out.can_access_luna).toBe(false) // strict === true only
  })
})
