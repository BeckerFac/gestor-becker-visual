import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { EnterprisesService } from '../src/modules/enterprises/enterprises.service'

describe('EnterprisesService', () => {
  let service: EnterprisesService

  beforeEach(() => {
    resetMocks()
    service = new EnterprisesService()
  })

  // Enterprise ensureTables does ~9 migration DB calls.
  // Use SQL content matching to distinguish business calls from migrations.

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

  describe('createEnterprise', () => {
    it('creates enterprise with all new fields (razon_social, postal_code, fiscal address)', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE company_id': { rows: [] }, // no duplicate
        'INSERT INTO enterprises': { rows: [] },
        'SELECT * FROM enterprises WHERE id': { rows: [{
          id: 'ent-1', name: 'BECKER SRL',
          razon_social: 'BECKER SRL',
          postal_code: '1425',
          fiscal_address: 'Av. Santa Fe 1234',
          fiscal_city: 'CABA',
          fiscal_province: 'Buenos Aires',
          fiscal_postal_code: '1425',
        }] },
      })

      const result = await service.createEnterprise('company-1', {
        name: 'BECKER SRL',
        razon_social: 'BECKER SRL',
        cuit: '30-71234567-9',
        postal_code: '1425',
        fiscal_address: 'Av. Santa Fe 1234',
        fiscal_city: 'CABA',
        fiscal_province: 'Buenos Aires',
        fiscal_postal_code: '1425',
      })

      expect(result.name).toBe('BECKER SRL')
      expect(result.razon_social).toBe('BECKER SRL')
      expect(result.postal_code).toBe('1425')
      expect(result.fiscal_address).toBe('Av. Santa Fe 1234')
    })

    it('throws 409 on duplicate CUIT', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE company_id': { rows: [{ id: 'existing-ent' }] },
      })

      await expect(
        service.createEnterprise('company-1', {
          name: 'Duplicate Corp',
          cuit: '30-71234567-9',
        })
      ).rejects.toThrow('Enterprise with this CUIT already exists')
    })

    it('allows creation without CUIT (skips duplicate check)', async () => {
      mockByContent({
        'INSERT INTO enterprises': { rows: [] },
        'SELECT * FROM enterprises WHERE id': { rows: [{ id: 'ent-2', name: 'No CUIT Corp' }] },
      })

      const result = await service.createEnterprise('company-1', {
        name: 'No CUIT Corp',
      })

      expect(result.name).toBe('No CUIT Corp')
    })
  })

  describe('updateEnterprise', () => {
    it('updates fiscal address fields correctly', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [{ id: 'ent-1' }] },
        'UPDATE enterprises SET': { rows: [] },
        'SELECT * FROM enterprises WHERE id': { rows: [{
          id: 'ent-1', name: 'Updated Corp',
          fiscal_address: 'New Address 456',
          fiscal_city: 'Rosario',
          fiscal_province: 'Santa Fe',
        }] },
      })

      const result = await service.updateEnterprise('company-1', 'ent-1', {
        name: 'Updated Corp',
        fiscal_address: 'New Address 456',
        fiscal_city: 'Rosario',
        fiscal_province: 'Santa Fe',
      })

      expect(result.fiscal_address).toBe('New Address 456')
      expect(result.fiscal_city).toBe('Rosario')
    })

    it('sets null fiscal fields when same_as_company', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [{ id: 'ent-1' }] },
        'UPDATE enterprises SET': { rows: [] },
        'SELECT * FROM enterprises WHERE id': { rows: [{
          id: 'ent-1', name: 'Corp',
          fiscal_address: null,
          fiscal_city: null,
          fiscal_province: null,
          fiscal_postal_code: null,
        }] },
      })

      const result = await service.updateEnterprise('company-1', 'ent-1', {
        name: 'Corp',
        fiscal_address: '',
        fiscal_city: '',
        fiscal_province: '',
        fiscal_postal_code: '',
      })

      expect(result.fiscal_address).toBeNull()
    })

    it('throws 404 when enterprise not found', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [] },
      })

      await expect(
        service.updateEnterprise('company-1', 'nonexistent', { name: 'X' })
      ).rejects.toThrow('Enterprise not found')
    })
  })

  describe('deleteEnterprise', () => {
    it('unlinks customers before deleting', async () => {
      const executedOps: string[] = []
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT id FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1' }] })
        }
        if (sqlStr.includes('UPDATE customers SET enterprise_id')) {
          executedOps.push('UNLINK_CUSTOMERS')
        }
        if (sqlStr.includes('DELETE FROM enterprises')) {
          executedOps.push('DELETE_ENTERPRISE')
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.deleteEnterprise('company-1', 'ent-1')

      expect(result.success).toBe(true)
      expect(executedOps).toContain('UNLINK_CUSTOMERS')
      expect(executedOps).toContain('DELETE_ENTERPRISE')
      expect(executedOps.indexOf('UNLINK_CUSTOMERS')).toBeLessThan(executedOps.indexOf('DELETE_ENTERPRISE'))
    })

    it('throws 404 when enterprise not found', async () => {
      mockByContent({
        'SELECT id FROM enterprises WHERE id': { rows: [] },
      })

      await expect(
        service.deleteEnterprise('company-1', 'nonexistent')
      ).rejects.toThrow('Enterprise not found')
    })
  })

  describe('getEnterprises', () => {
    it('returns list of enterprises with contact count and tags', async () => {
      mockByContent({
        'FROM enterprises e': { rows: [
          { id: 'ent-1', name: 'Corp A', contact_count: '3', tags: [{ id: 't1', name: 'VIP', color: '#FF0000' }] },
          { id: 'ent-2', name: 'Corp B', contact_count: '0', tags: [] },
        ] },
      })

      const result = await service.getEnterprises('company-1')

      expect(result).toHaveLength(2)
      expect(result[0].contact_count).toBe('3')
    })
  })

  describe('getEnterprise', () => {
    it('returns enterprise with contacts', async () => {
      let callNum = 0
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''

        if (sqlStr.includes('SELECT * FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Corp A', cuit: '30-71234567-9' }] })
        }
        if (sqlStr.includes('SELECT * FROM customers WHERE enterprise_id')) {
          return Promise.resolve({ rows: [
            { id: 'contact-1', name: 'Juan Perez', enterprise_id: 'ent-1' },
          ] })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.getEnterprise('company-1', 'ent-1')

      expect(result.name).toBe('Corp A')
      expect(result.contacts).toHaveLength(1)
      expect(result.contacts[0].name).toBe('Juan Perez')
    })

    it('throws 404 when not found', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] })

      await expect(
        service.getEnterprise('company-1', 'nonexistent')
      ).rejects.toThrow('Enterprise not found')
    })
  })
})
