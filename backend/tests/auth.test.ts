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

// Import after mocks are set up
import { AuthService } from '../src/modules/auth/auth.service'

const authService = new AuthService()

describe('AuthService', () => {
  beforeEach(() => {
    resetMocks()
    mockHash.mockReset()
    mockCompare.mockReset()
  })

  describe('register', () => {
    it('registers a new user and returns tokens', async () => {
      // Mock: user doesn't exist (findFirst returns undefined)
      const { db } = await import('../src/config/db')
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(undefined)

      // Mock: insert company returns company
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'company-1', name: 'Test Company', cuit: '20123456789' }]),
        }),
      } as any)

      // Mock: bcrypt hash
      mockHash.mockResolvedValueOnce('hashed_password')

      // Mock: insert user returns user
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 'user-1',
            email: 'newuser@test.com',
            name: 'New User',
            role: 'admin',
          }]),
        }),
      } as any)

      const result = await authService.register(
        'newuser@test.com',
        'test123',
        'New User',
        'Test Company',
        '20123456789'
      )

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.user.email).toBe('newuser@test.com')
      expect(result.user.role).toBe('admin')
      expect(result.company.name).toBe('Test Company')
    })

    it('throws 409 if email already registered', async () => {
      const { db } = await import('../src/config/db')
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        id: 'existing-user',
        email: 'existing@test.com',
      } as any)

      await expect(
        authService.register('existing@test.com', 'test123', 'User', 'Company', '20123456789')
      ).rejects.toThrow('Email already registered')
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

      const result = await authService.login('test@test.com', 'test123')

      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.user.email).toBe('test@test.com')
    })

    it('throws 401 for non-existent user', async () => {
      const { db } = await import('../src/config/db')
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(undefined)

      await expect(
        authService.login('nonexistent@test.com', 'test123')
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
      } as any)

      mockCompare.mockResolvedValueOnce(false)

      await expect(
        authService.login('test@test.com', 'wrongpassword')
      ).rejects.toThrow('Invalid credentials')
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
      expect(result.customer.name).toBe('Customer Test')
      expect(result.company.name).toBe('Company Test')
    })

    it('throws 401 for invalid access code', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })

      await expect(
        authService.customerLogin('INVALID-CODE')
      ).rejects.toThrow('Código de acceso inválido')
    })
  })
})
