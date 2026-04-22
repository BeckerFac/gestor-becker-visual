import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

import { EnterprisesService } from '../src/modules/enterprises/enterprises.service'

/**
 * Nor feedback item 3: each Enterprise has a default Sol/Luna circuit
 * (default_fiscal_type). Used by the order form to pre-fill orders.fiscal_type
 * when an enterprise is selected.
 *
 * These tests lock in: default, persistence, whitelist validation,
 * update semantics, and listing inclusion of the field.
 */
describe('EnterprisesService - default_fiscal_type (Nor feedback item 3)', () => {
  let service: EnterprisesService

  beforeEach(() => {
    resetMocks()
    service = new EnterprisesService()
  })

  function mockByContent(overrides: Record<string, any>) {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
      for (const [pattern, result] of Object.entries(overrides)) {
        if (sqlStr.includes(pattern)) {
          return typeof result === 'function' ? result(tpl) : Promise.resolve(result)
        }
      }
      return Promise.resolve({ rows: [] })
    })
  }

  // Capture all execute calls so we can assert payload values.
  // Wave 2A-1 H12: updateEnterprise now uses pool.query for the UPDATE, so we
  // also record mockPoolQuery calls under the same shape.
  function captureExecutes() {
    const calls: Array<{ sql: string; values: any[] }> = []
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
      const values = tpl?.values ?? []
      calls.push({ sql: sqlStr, values })

      if (sqlStr.includes('SELECT id FROM enterprises WHERE company_id')) {
        return Promise.resolve({ rows: [] })
      }
      if (sqlStr.includes('SELECT id FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1' }] })
      }
      if (sqlStr.includes('SELECT * FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'X', default_fiscal_type: 'fiscal' }] })
      }
      return Promise.resolve({ rows: [] })
    })
    mockPoolQuery.mockImplementation((sqlStr: string, values: any[]) => {
      calls.push({ sql: sqlStr, values: values ?? [] })
      return Promise.resolve({ rows: [] })
    })
    return calls
  }

  describe('createEnterprise', () => {
    it('defaults default_fiscal_type to "fiscal" when not provided', async () => {
      const calls = captureExecutes()

      await service.createEnterprise('company-1', {
        name: 'Corp',
        razon_social: 'Corp SRL',
        cuit: '30-71234567-9',
        tax_condition: 'Responsable Inscripto',
        fiscal_address: 'Calle 1',
      })

      const insert = calls.find(c => c.sql.includes('INSERT INTO enterprises'))
      expect(insert).toBeDefined()
      // default_fiscal_type is the last interpolated value in the INSERT.
      expect(insert!.values[insert!.values.length - 2]).toBe('fiscal')
    })

    it('persists default_fiscal_type="no_fiscal" when explicitly provided', async () => {
      const calls = captureExecutes()

      await service.createEnterprise('company-1', {
        name: 'Corp',
        razon_social: 'Corp SRL',
        cuit: '30-71234567-9',
        tax_condition: 'Responsable Inscripto',
        fiscal_address: 'Calle 1',
        default_fiscal_type: 'no_fiscal',
      })

      const insert = calls.find(c => c.sql.includes('INSERT INTO enterprises'))
      expect(insert).toBeDefined()
      expect(insert!.values[insert!.values.length - 2]).toBe('no_fiscal')
    })

    it('rejects invalid default_fiscal_type with 400', async () => {
      // Mock SELECT for duplicate-CUIT check: no existing row.
      mockByContent({
        'SELECT id FROM enterprises WHERE company_id': { rows: [] },
      })

      await expect(
        service.createEnterprise('company-1', {
          name: 'Corp',
          razon_social: 'Corp SRL',
          cuit: '30-71234567-9',
          tax_condition: 'Responsable Inscripto',
          fiscal_address: 'Calle 1',
          default_fiscal_type: 'bogus',
        })
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/default_fiscal_type invalido/) })
    })

    it('rejects other truthy non-whitelisted values', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE company_id': { rows: [] },
      })

      await expect(
        service.createEnterprise('company-1', {
          name: 'Corp',
          razon_social: 'Corp SRL',
          cuit: '30-71234567-9',
          tax_condition: 'Responsable Inscripto',
          fiscal_address: 'Calle 1',
          default_fiscal_type: 'FISCAL', // case-sensitive whitelist
        })
      ).rejects.toThrow(/default_fiscal_type invalido/)
    })
  })

  describe('updateEnterprise', () => {
    it('persists default_fiscal_type when provided', async () => {
      const calls = captureExecutes()

      await service.updateEnterprise('company-1', 'ent-1', {
        name: 'Updated Corp',
        default_fiscal_type: 'no_fiscal',
      })

      const update = calls.find(c => c.sql.includes('UPDATE enterprises SET') && c.sql.includes('default_fiscal_type'))
      expect(update).toBeDefined()
      // Look for 'no_fiscal' in the interpolated values.
      expect(update!.values).toContain('no_fiscal')
    })

    it('does NOT touch default_fiscal_type when omitted from payload', async () => {
      const calls = captureExecutes()

      await service.updateEnterprise('company-1', 'ent-1', {
        name: 'Updated Corp',
      })

      const anyUpdate = calls.find(c => c.sql.includes('UPDATE enterprises SET'))
      expect(anyUpdate).toBeDefined()
      // Partial-update path must NOT mention default_fiscal_type in the SQL.
      expect(anyUpdate!.sql.includes('default_fiscal_type')).toBe(false)
    })

    it('rejects invalid default_fiscal_type with 400', async () => {
      // Enterprise exists check must pass so we reach the validation branch.
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [{ id: 'ent-1' }] },
      })

      await expect(
        service.updateEnterprise('company-1', 'ent-1', {
          name: 'Corp',
          default_fiscal_type: 'luna',
        })
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('getEnterprises', () => {
    it('returns default_fiscal_type in the row', async () => {
      mockByContent({
        'FROM enterprises e': {
          rows: [
            { id: 'ent-1', name: 'Corp A', default_fiscal_type: 'fiscal', contact_count: '0', tags: [] },
            { id: 'ent-2', name: 'Corp B', default_fiscal_type: 'no_fiscal', contact_count: '0', tags: [] },
          ],
        },
      })

      const result = await service.getEnterprises('company-1')

      expect(result).toHaveLength(2)
      expect(result[0].default_fiscal_type).toBe('fiscal')
      expect(result[1].default_fiscal_type).toBe('no_fiscal')
    })
  })
})
