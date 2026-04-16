import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDbExecute, mockDbEmpty, resetMocks } from './helpers/setup'

// Mock bcryptjs
const mockHash = vi.fn()
const mockCompare = vi.fn()
vi.mock('bcryptjs', () => ({
  default: {
    hash: (...args: any[]) => mockHash(...args),
    compare: (...args: any[]) => mockCompare(...args),
  },
  hash: (...args: any[]) => mockHash(...args),
  compare: (...args: any[]) => mockCompare(...args),
}))

// Mock billingService for auth tests (auth.service imports it for register)
vi.mock('../src/modules/billing/billing.service', () => ({
  billingService: {
    createTrialSubscription: vi.fn().mockResolvedValue(undefined),
    getSubscription: vi.fn().mockResolvedValue(null),
  },
}))

// Import after mocks are set up
import { AuthService } from '../src/modules/auth/auth.service'

const authService = new AuthService()

describe('AuthService', () => {
  beforeEach(() => {
    resetMocks()
    mockHash.mockReset()
    mockCompare.mockReset()
    // Default: hash resolves to a hashed value (for timing-safe dummy hashes too)
    mockHash.mockResolvedValue('hashed_dummy')
  })

  describe('register', () => {
    it('registers a new user and returns tokens', async () => {
      // Mock: user doesn't exist (findFirst returns undefined)
      const { db } = await import('../src/config/db')
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(undefined)

      // Mock: CUIT not taken (companies.findFirst returns undefined)
      vi.mocked(db.query.companies.findFirst).mockResolvedValueOnce(undefined)

      // Mock: insert company returns company
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'company-1', name: 'Test Company', cuit: '20123456789' }]),
        }),
      } as any)

      // Mock: bcrypt hash for password
      mockHash.mockResolvedValueOnce('hashed_password')

      // Mock: insert user returns user
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 'user-1',
            email: 'newuser@test.com',
            name: 'New User',
            role: 'owner',
          }]),
        }),
      } as any)

      // Use password that meets complexity requirements
      const result = await authService.register(
        'newuser@test.com',
        'Test1234',
        'New User',
        'Test Company',
        '20123456789'
      )

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.user.email).toBe('newuser@test.com')
      expect(result.user.role).toBe('owner')
      expect(result.company.name).toBe('Test Company')
    })

    it('throws 409 if email already registered', async () => {
      const { db } = await import('../src/config/db')
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'existing-user',
        email: 'existing@test.com',
      } as any)

      // Password must meet complexity to get past validation
      await expect(
        authService.register('existing@test.com', 'Test1234', 'User', 'Company', '20123456789')
      ).rejects.toThrow('Email already registered')
    })

    it('rejects weak passwords', async () => {
      await expect(
        authService.register('test@test.com', 'weak', 'User', 'Company', '20123456789')
      ).rejects.toThrow('La contrasena debe tener al menos 8 caracteres')
    })

    it('rejects passwords without uppercase', async () => {
      await expect(
        authService.register('test@test.com', 'testpass1', 'User', 'Company', '20123456789')
      ).rejects.toThrow('mayuscula')
    })

    it('rejects invalid email format', async () => {
      await expect(
        authService.register('not-an-email', 'Test1234', 'User', 'Company', '20123456789')
      ).rejects.toThrow('email invalido')
    })
  })

  describe('login', () => {
    it('authenticates a valid user and returns tokens', async () => {
      const { db } = await import('../src/config/db')

      // Mock: findFirst returns user
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        password_hash: 'hashed_password',
        name: 'Test User',
        role: 'admin',
        company_id: 'company-1',
        active: true,
      } as any)

      // Mock: bcrypt compare succeeds
      mockCompare.mockResolvedValueOnce(true)

      // Mock: update last_login
      vi.mocked(db.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      } as any)

      // Mock: findFirst for company
      vi.mocked(db.query.companies.findFirst).mockResolvedValueOnce({
        id: 'company-1',
        name: 'Test Company',
        cuit: '20123456789',
      } as any)

      // Mock: can_access_luna raw SELECT (Sol/Luna — precedes storeSession)
      mockDbExecute.mockResolvedValueOnce({ rows: [{ can_access_luna: false }] })
      // Mock: storeSession -> DELETE expired sessions (db.execute)
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      // Mock: is_superadmin check (db.execute)
      mockDbExecute.mockResolvedValueOnce({ rows: [{ is_superadmin: false }] })

      const result = await authService.login('test@test.com', 'Test1234')

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.user.email).toBe('test@test.com')
    })

    it('throws 401 for non-existent user', async () => {
      const { db } = await import('../src/config/db')
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(undefined)

      await expect(
        authService.login('nonexistent@test.com', 'Test1234')
      ).rejects.toThrow('Invalid credentials')
    })

    it('throws 401 for wrong password', async () => {
      const { db } = await import('../src/config/db')

      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        password_hash: 'hashed_password',
        name: 'Test User',
        role: 'admin',
        company_id: 'company-1',
        active: true,
      } as any)

      mockCompare.mockResolvedValueOnce(false)

      await expect(
        authService.login('test@test.com', 'wrongpassword')
      ).rejects.toThrow('Invalid credentials')
    })

    it('throws 403 for deactivated user', async () => {
      const { db } = await import('../src/config/db')

      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        password_hash: 'hashed_password',
        name: 'Test User',
        role: 'admin',
        company_id: 'company-1',
        active: false,
      } as any)

      await expect(
        authService.login('test@test.com', 'Test1234')
      ).rejects.toThrow('User deactivated')
    })
  })

  describe('me', () => {
    it('returns user info for valid user', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'user-1',
          email: 'test@test.com',
          name: 'Test User',
          role: 'admin',
          company_id: 'company-1',
          active: true,
          email_verified: true,
          subscription_status: 'trial',
          trial_ends_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
          grace_ends_at: null,
        }],
      })

      const result = await authService.me('user-1')

      expect(result.email).toBe('test@test.com')
      expect(result.role).toBe('admin')
    })

    it('throws 404 for non-existent user', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })

      await expect(authService.me('nonexistent')).rejects.toThrow('User not found')
    })

    it('throws 403 for deactivated user', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'user-1',
          email: 'test@test.com',
          name: 'Inactive User',
          role: 'admin',
          company_id: 'company-1',
          active: false,
        }],
      })

      await expect(authService.me('user-1')).rejects.toThrow('User deactivated')
    })
  })

  describe('CRIT-03: session revocation via jti', () => {
    it('login creates a session row with access_token_jti', async () => {
      const { db } = await import('../src/config/db')

      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        password_hash: 'hashed_password',
        name: 'Test User',
        role: 'admin',
        company_id: 'company-1',
        active: true,
      } as any)
      mockCompare.mockResolvedValueOnce(true)
      vi.mocked(db.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      } as any)
      vi.mocked(db.query.companies.findFirst).mockResolvedValueOnce({
        id: 'company-1', name: 'Test Company', cuit: '20123456789',
      } as any)

      // Capture the values passed to db.insert for sessions
      const insertValues = vi.fn().mockResolvedValue(undefined)
      vi.mocked(db.insert).mockReturnValueOnce({ values: insertValues } as any)

      // Sol/Luna raw SELECT
      mockDbExecute.mockResolvedValueOnce({ rows: [{ can_access_luna: false }] })
      // storeSession -> DELETE expired sessions
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      // is_superadmin check
      mockDbExecute.mockResolvedValueOnce({ rows: [{ is_superadmin: false }] })

      const result = await authService.login('test@test.com', 'Test1234')

      expect(result.accessToken).toBeDefined()
      // Session insert must carry the jti from the access token
      expect(insertValues).toHaveBeenCalledTimes(1)
      const sessionRow = insertValues.mock.calls[0][0]
      expect(sessionRow.user_id).toBe('user-1')
      expect(sessionRow.access_token_jti).toBeDefined()
      expect(typeof sessionRow.access_token_jti).toBe('string')
      expect(sessionRow.access_token_jti.length).toBeGreaterThan(10)
    })

    it('logout marks session revoked by jti', async () => {
      const { db } = await import('../src/config/db')

      // db.delete chain for refresh-token cleanup
      vi.mocked(db.delete).mockReturnValueOnce({
        where: vi.fn().mockResolvedValue(undefined),
      } as any)

      // UPDATE sessions SET revoked_at
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [] })

      await authService.logout('user-1', 'refresh-token', 'jti-to-revoke')

      // The UPDATE sql call should have been issued (db.execute with jti)
      expect(mockDbExecute).toHaveBeenCalled()
      const calls = mockDbExecute.mock.calls
      const updateCall = calls.find(c => {
        const arg = c[0]
        // sql template mock returns { strings, values }
        return arg && Array.isArray(arg.values) && arg.values.includes('jti-to-revoke')
      })
      expect(updateCall).toBeTruthy()
    })

    it('logout is idempotent when no jti/refresh token is provided', async () => {
      // Should not throw, should not touch the DB beyond no-op
      await expect(authService.logout('user-1')).resolves.toBeUndefined()
    })

    it('cleanupExpiredSessions deletes rows older than 30 days', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 7, rows: [] })
      const deleted = await authService.cleanupExpiredSessions()
      expect(deleted).toBe(7)
      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('generateTokens issues access tokens carrying a jti claim', async () => {
      // Use the public login path to exercise generateTokens, and decode.
      const jwt = (await import('jsonwebtoken')).default
      const { db } = await import('../src/config/db')

      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'user-2', email: 'jti@test.com', password_hash: 'h',
        name: 'Jti User', role: 'admin', company_id: 'company-1', active: true,
      } as any)
      mockCompare.mockResolvedValueOnce(true)
      vi.mocked(db.update).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      } as any)
      vi.mocked(db.query.companies.findFirst).mockResolvedValueOnce({
        id: 'company-1', name: 'Co', cuit: '20123456789',
      } as any)
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockResolvedValue(undefined),
      } as any)
      mockDbExecute.mockResolvedValueOnce({ rows: [{ can_access_luna: false }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ is_superadmin: false }] })

      const result = await authService.login('jti@test.com', 'Test1234')
      const payload: any = jwt.decode(result.accessToken)
      expect(payload).toBeTruthy()
      expect(payload.jti).toBeDefined()
      expect(typeof payload.jti).toBe('string')
    })
  })

  describe('customerLogin', () => {
    it('authenticates a customer with valid access code', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'customer-1',
          name: 'Customer Test',
          cuit: '20111222333',
          email: 'customer@test.com',
          phone: '1234567890',
          company_id: 'company-1',
          company_name: 'Company Test',
          company_cuit: '20123456789',
        }],
      })

      const result = await authService.customerLogin('VALID-CODE')

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.enterprise.name).toBe('Customer Test')
      expect(result.company.name).toBe('Company Test')
    })

    it('throws 401 for invalid access code', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })

      await expect(
        authService.customerLogin('INVALID-CODE')
      ).rejects.toThrow('Codigo de acceso invalido')
    })
  })
})
