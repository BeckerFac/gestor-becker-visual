import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

// NOTE: setup.ts mocks db.query.customers.findFirst to an unconfigured vi.fn()
// that returns undefined by default — which is exactly what we want for the
// "no duplicate" branch. We override per-test when we need a duplicate.
import { db } from '../src/config/db'
import { CustomersService } from '../src/modules/customers/customers.service'

// Captures the values passed to db.insert(customers).values(...) so we can
// assert that CUIT is persisted as NULL (not empty string) when not provided.
let capturedInsert: any = null
const originalInsert = (db as any).insert

describe('CustomersService — CUIT optional (Nor feedback item 2)', () => {
  let service: CustomersService

  beforeEach(() => {
    resetMocks()
    capturedInsert = null
    service = new CustomersService()

    // Re-wrap db.insert so we can intercept the values() payload.
    ;(db as any).insert = vi.fn(() => ({
      values: (payload: any) => {
        capturedInsert = payload
        return {
          returning: () => [{ id: payload.id, ...payload }],
          then: (resolve: any) => resolve([{ id: payload.id, ...payload }]),
        }
      },
    }))

    // Default: no duplicate CUIT in DB.
    ;(db as any).query.customers.findFirst = vi.fn(async () => undefined)

    // ensureMigrations + SELECT * after insert: return an empty-ish row.
    mockDbExecute.mockResolvedValue({ rows: [{ id: 'test-id' }] })
  })

  afterEach(() => {
    ;(db as any).insert = originalInsert
  })

  it('creates customer without CUIT → 201 (cuit persisted as NULL)', async () => {
    const result = await service.createCustomer('company-1', {
      name: 'Acme SRL',
    })

    expect(result).toBeDefined()
    expect(capturedInsert).not.toBeNull()
    expect(capturedInsert.cuit).toBeNull()
    expect(capturedInsert.name).toBe('Acme SRL')
    // No duplicate-CUIT lookup should happen when CUIT is missing.
    expect((db as any).query.customers.findFirst).not.toHaveBeenCalled()
  })

  it('creates customer without CUIT when field is empty string → NULL', async () => {
    await service.createCustomer('company-1', {
      name: 'Acme SRL',
      cuit: '   ',
    })

    expect(capturedInsert.cuit).toBeNull()
    expect((db as any).query.customers.findFirst).not.toHaveBeenCalled()
  })

  it('creates customer with valid CUIT (dashes) → 201', async () => {
    const result = await service.createCustomer('company-1', {
      name: 'Acme SRL',
      cuit: '30-71234567-9',
    })

    expect(result).toBeDefined()
    expect(capturedInsert.cuit).toBe('30-71234567-9')
    // Uniqueness was checked.
    expect((db as any).query.customers.findFirst).toHaveBeenCalledTimes(1)
  })

  it('creates customer with valid CUIT (11 plain digits) → 201', async () => {
    await service.createCustomer('company-1', {
      name: 'Acme SRL',
      cuit: '30712345679',
    })

    expect(capturedInsert.cuit).toBe('30712345679')
  })

  it('rejects invalid CUIT format (10 digits) → 400', async () => {
    await expect(
      service.createCustomer('company-1', {
        name: 'Acme SRL',
        cuit: '3071234567',
      })
    ).rejects.toThrow(/CUIT invalido/)
  })

  it('rejects invalid CUIT format (12 digits) → 400', async () => {
    await expect(
      service.createCustomer('company-1', {
        name: 'Acme SRL',
        cuit: '307123456789',
      })
    ).rejects.toThrow(/CUIT invalido/)
  })

  it('rejects invalid CUIT format (non-numeric) → 400', async () => {
    await expect(
      service.createCustomer('company-1', {
        name: 'Acme SRL',
        cuit: 'ABC12345678',
      })
    ).rejects.toThrow(/CUIT invalido/)
  })

  it('two customers without CUIT in same company → both succeed', async () => {
    const first = await service.createCustomer('company-1', { name: 'Contact A' })
    expect(first).toBeDefined()
    expect(capturedInsert.cuit).toBeNull()

    // A second call must not attempt a uniqueness check (NULL is not unique in Postgres).
    ;(db as any).query.customers.findFirst = vi.fn(async () => undefined)

    const second = await service.createCustomer('company-1', { name: 'Contact B' })
    expect(second).toBeDefined()
    expect(capturedInsert.cuit).toBeNull()
    expect((db as any).query.customers.findFirst).not.toHaveBeenCalled()
  })

  it('rejects duplicate CUIT → 409', async () => {
    ;(db as any).query.customers.findFirst = vi.fn(async () => ({
      id: 'existing-id',
      cuit: '30-71234567-9',
    }))

    await expect(
      service.createCustomer('company-1', {
        name: 'Dup Corp',
        cuit: '30-71234567-9',
      })
    ).rejects.toThrow(/already exists/)
  })
})

