import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { EnterprisesService } from '../src/modules/enterprises/enterprises.service'

// Wave 2B-1 H22: enterprises.role (client / supplier / both).
// Validates default handling, filter semantics (incl. NULL-as-client),
// update path, and 400 on invalid enum values.
describe('EnterprisesService -- role (client/supplier/both)', () => {
  let service: EnterprisesService

  beforeEach(() => {
    resetMocks()
    service = new EnterprisesService()
  })

  function captureSqlAndValues() {
    const captured: Array<{ sql: string; values: any[] }> = []
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('?') : ''
      const values = tpl?.values || []
      captured.push({ sql: sqlStr, values })

      if (sqlStr.includes('SELECT id FROM enterprises WHERE company_id')) {
        return Promise.resolve({ rows: [] })
      }
      if (sqlStr.includes('SELECT id FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1' }] })
      }
      if (sqlStr.includes('SELECT * FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Corp', role: 'client' }] })
      }
      return Promise.resolve({ rows: [] })
    })
    return captured
  }

  it('defaults role to client when createEnterprise omits it', async () => {
    const captured = captureSqlAndValues()

    await service.createEnterprise('company-1', {
      name: 'Corp SRL',
      razon_social: 'Corp SRL',
      cuit: '30-71234567-9',
      tax_condition: 'Responsable Inscripto',
      fiscal_address: 'Av. Ejemplo 1234',
    })

    const insert = captured.find((c) => c.sql.includes('INSERT INTO enterprises'))
    expect(insert).toBeDefined()
    expect(insert!.values).toContain('client')
  })

  it('filters to suppliers when getEnterprises is called with role=supplier', async () => {
    const captured = captureSqlAndValues()

    await service.getEnterprises('company-1', 'supplier')

    const select = captured.find((c) => c.sql.includes('FROM enterprises e') && !c.sql.includes('INSERT'))
    expect(select).toBeDefined()
    expect(select!.sql).toContain(`e.role IN ('supplier', 'both')`)
  })

  it('filters to clients and treats NULL role as client for backward compat', async () => {
    const captured = captureSqlAndValues()

    await service.getEnterprises('company-1', 'client')

    const select = captured.find((c) => c.sql.includes('FROM enterprises e') && !c.sql.includes('INSERT'))
    expect(select).toBeDefined()
    expect(select!.sql).toContain(`e.role IN ('client', 'both')`)
    expect(select!.sql).toContain('e.role IS NULL')
  })

  it('updates role on updateEnterprise and persists the new value', async () => {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('?') : ''
      if (sqlStr.includes('SELECT id FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1' }] })
      }
      if (sqlStr.includes('SELECT * FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Corp', role: 'supplier' }] })
      }
      return Promise.resolve({ rows: [] })
    })

    const result = await service.updateEnterprise('company-1', 'ent-1', { role: 'supplier' })

    expect(result.role).toBe('supplier')
  })

  it('rejects invalid role value with a 400 error', async () => {
    captureSqlAndValues()

    await expect(
      service.createEnterprise('company-1', {
        name: 'Corp SRL',
        razon_social: 'Corp SRL',
        cuit: '30-71234567-9',
        tax_condition: 'Responsable Inscripto',
        fiscal_address: 'Av. Ejemplo 1234',
        role: 'invalid_role',
      })
    ).rejects.toThrow(/role invalido/)
  })
})
