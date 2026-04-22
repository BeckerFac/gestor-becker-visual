import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

import { EnterprisesService } from '../src/modules/enterprises/enterprises.service'

/**
 * Wave 2A-1 H12: PUT /enterprises/:id destroyed unsent fields.
 *
 * The previous updateEnterprise issued a full-replace UPDATE that clobbered
 * razon_social/cuit/fiscal_address/etc. to NULL whenever the UI edit modal
 * sent a partial payload like {name, default_fiscal_type}.
 *
 * These tests lock in MERGE semantics: only columns explicitly present in
 * the payload are written; everything else is untouched. UPDATEs now run
 * through pool.query with numbered params.
 */
describe('EnterprisesService - merge update (Wave 2A-1 H12)', () => {
  let service: EnterprisesService

  beforeEach(() => {
    resetMocks()
    service = new EnterprisesService()
  })

  // Capture all SELECT/INSERT calls (db.execute) AND UPDATE calls (pool.query).
  function captureAll() {
    const calls: Array<{ sql: string; values: any[] }> = []
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
      const values = tpl?.values ?? []
      calls.push({ sql: sqlStr, values })

      if (sqlStr.includes('SELECT id FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1' }] })
      }
      if (sqlStr.includes('SELECT * FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Existing' }] })
      }
      return Promise.resolve({ rows: [] })
    })
    mockPoolQuery.mockImplementation((sqlStr: string, values: any[]) => {
      calls.push({ sql: sqlStr, values: values ?? [] })
      return Promise.resolve({ rows: [] })
    })
    return calls
  }

  it('partial update only touches sent columns — preserves unsent fields', async () => {
    const calls = captureAll()

    await service.updateEnterprise('company-1', 'ent-1', {
      name: 'New Name',
      default_fiscal_type: 'no_fiscal',
    })

    const update = calls.find(c => c.sql.includes('UPDATE enterprises SET'))
    expect(update).toBeDefined()

    // Only name + default_fiscal_type must be in the SET clause.
    expect(update!.sql).toContain('name = $')
    expect(update!.sql).toContain('default_fiscal_type = $')

    // Unsent fields must NOT appear — if they did, they'd be overwritten to NULL.
    expect(update!.sql).not.toContain('razon_social = $')
    expect(update!.sql).not.toContain('cuit = $')
    expect(update!.sql).not.toContain('fiscal_address = $')
    expect(update!.sql).not.toContain('tax_condition = $')
    expect(update!.sql).not.toContain('phone = $')
    expect(update!.sql).not.toContain('email = $')

    // Only the sent values + id + company_id are in the params.
    expect(update!.values).toContain('New Name')
    expect(update!.values).toContain('no_fiscal')
    expect(update!.values).toContain('ent-1')
    expect(update!.values).toContain('company-1')
  })

  it('full update sets all provided fields', async () => {
    const calls = captureAll()

    await service.updateEnterprise('company-1', 'ent-1', {
      name: 'Full Corp',
      razon_social: 'Full Corp SRL',
      cuit: '30-71234567-9',
      fiscal_address: 'Av. Libertador 1000',
      fiscal_city: 'CABA',
      tax_condition: 'Responsable Inscripto',
      phone: '011-4444-5555',
      email: 'hi@full.com',
    })

    const update = calls.find(c => c.sql.includes('UPDATE enterprises SET'))
    expect(update).toBeDefined()

    expect(update!.sql).toContain('name = $')
    expect(update!.sql).toContain('razon_social = $')
    expect(update!.sql).toContain('cuit = $')
    expect(update!.sql).toContain('fiscal_address = $')
    expect(update!.sql).toContain('fiscal_city = $')
    expect(update!.sql).toContain('tax_condition = $')
    expect(update!.sql).toContain('phone = $')
    expect(update!.sql).toContain('email = $')

    expect(update!.values).toContain('Full Corp')
    expect(update!.values).toContain('Full Corp SRL')
    expect(update!.values).toContain('30-71234567-9')
    expect(update!.values).toContain('Av. Libertador 1000')
  })

  it('empty payload is a no-op — no UPDATE is issued', async () => {
    const calls = captureAll()

    await service.updateEnterprise('company-1', 'ent-1', {})

    const update = calls.find(c => c.sql.includes('UPDATE enterprises SET'))
    expect(update).toBeUndefined()
  })

  it('unknown fields are ignored — do not appear in the UPDATE', async () => {
    const calls = captureAll()

    await service.updateEnterprise('company-1', 'ent-1', {
      name: 'Known Corp',
      foo_bar_baz: 'should be dropped',
      some_random_col: 42,
    })

    const update = calls.find(c => c.sql.includes('UPDATE enterprises SET'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain('name = $')
    expect(update!.sql).not.toContain('foo_bar_baz')
    expect(update!.sql).not.toContain('some_random_col')
    expect(update!.values).not.toContain('should be dropped')
    expect(update!.values).not.toContain(42)
  })
})
