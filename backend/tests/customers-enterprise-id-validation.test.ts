import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { db } from '../src/config/db'
import { CustomersService } from '../src/modules/customers/customers.service'

/**
 * Wave 2A-1 H16: POST /customers (and PUT) silently accepted enterprise_id=""
 * and coerced it to NULL, unlinking the customer from its enterprise without
 * warning. Any non-UUID string must now return 400.
 *
 * Accepted inputs for enterprise_id:
 *   - valid UUIDv4 string → used as-is
 *   - null → explicit unset (customer detached intentionally)
 *   - absent from payload → field untouched
 *
 * Rejected inputs (400):
 *   - empty string ""
 *   - malformed strings that aren't UUIDs
 */
describe('CustomersService - enterprise_id validation (Wave 2A-1 H16)', () => {
  let service: CustomersService
  let capturedInsert: any = null
  const originalInsert = (db as any).insert

  beforeEach(() => {
    resetMocks()
    capturedInsert = null
    service = new CustomersService()

    ;(db as any).insert = vi.fn(() => ({
      values: (payload: any) => {
        capturedInsert = payload
        return {
          returning: () => [{ id: payload.id, ...payload }],
          then: (resolve: any) => resolve([{ id: payload.id, ...payload }]),
        }
      },
    }))

    ;(db as any).query.customers.findFirst = vi.fn(async () => undefined)

    // ensureMigrations + SELECTs return a benign row shape.
    mockDbExecute.mockResolvedValue({ rows: [{ id: 'cust-1' }] })
  })

  afterEach(() => {
    ;(db as any).insert = originalInsert
  })

  describe('createCustomer', () => {
    it('rejects enterprise_id="" with 400', async () => {
      await expect(
        service.createCustomer('company-1', {
          name: 'Acme Contact',
          enterprise_id: '',
        })
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/enterprise_id invalido/) })
    })

    it('rejects malformed enterprise_id with 400', async () => {
      await expect(
        service.createCustomer('company-1', {
          name: 'Acme Contact',
          enterprise_id: 'not-a-uuid',
        })
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/enterprise_id invalido/) })
    })

    it('accepts a valid UUIDv4 enterprise_id', async () => {
      const validUuid = '11111111-2222-4333-8444-555555555555'

      const result = await service.createCustomer('company-1', {
        name: 'Acme Contact',
        enterprise_id: validUuid,
      })

      expect(result).toBeDefined()

      // The UPDATE customers SET enterprise_id = ... raw SQL should have been
      // called with the validated UUID (not coerced).
      const executedWithUuid = mockDbExecute.mock.calls.some((call: any[]) => {
        const tpl = call[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        const values = tpl?.values ?? []
        return sqlStr.includes('UPDATE customers SET enterprise_id') && values.includes(validUuid)
      })
      expect(executedWithUuid).toBe(true)
    })

    it('accepts null enterprise_id as explicit unset', async () => {
      const result = await service.createCustomer('company-1', {
        name: 'Acme Contact',
        enterprise_id: null,
      })

      expect(result).toBeDefined()

      // UPDATE should have been issued with null.
      const executedWithNull = mockDbExecute.mock.calls.some((call: any[]) => {
        const tpl = call[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        const values = tpl?.values ?? []
        return sqlStr.includes('UPDATE customers SET enterprise_id') && values.length > 0 && values[0] === null
      })
      expect(executedWithNull).toBe(true)
    })
  })

  describe('updateCustomer', () => {
    it('rejects enterprise_id="" on update with 400', async () => {
      await expect(
        service.updateCustomer('company-1', 'cust-1', {
          enterprise_id: '',
        })
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/enterprise_id invalido/) })
    })

    it('accepts null enterprise_id on update (explicit unlink)', async () => {
      const result = await service.updateCustomer('company-1', 'cust-1', {
        enterprise_id: null,
      })
      expect(result).toBeDefined()
    })
  })
})
