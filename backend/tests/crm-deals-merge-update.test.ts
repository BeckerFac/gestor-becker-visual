import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

import { CrmService } from '../src/modules/crm/crm.service'

/**
 * Wave 2A-1 H23: PUT /crm/deals/:id silently ignored stage_id and also
 * clobbered enterprise_id → NULL whenever notes/value-only edits were sent.
 *
 * New semantics:
 *   - MERGE: unsent fields are never touched.
 *   - stage_id in payload: validated against crm_stages for the same company.
 *     Valid → update stage_id AND denormalized stage name. Invalid → 400.
 */
describe('CrmService - deal merge update (Wave 2A-1 H23)', () => {
  let service: CrmService

  beforeEach(() => {
    resetMocks()
    service = new CrmService()
  })

  type Captured = { sql: string; values: any[] }

  function setup(opts: { stageExists?: boolean }) {
    const calls: Captured[] = []
    const stageExists = opts.stageExists !== false

    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0]
      const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
      const values = tpl?.values ?? []
      calls.push({ sql: sqlStr, values })

      // Initial deal existence check.
      if (sqlStr.includes('SELECT id, stage FROM crm_deals WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'deal-1', stage: 'contacto' }] })
      }
      // stage validation against crm_stages.
      if (sqlStr.includes('SELECT id, name FROM crm_stages') && sqlStr.includes('WHERE id =')) {
        return Promise.resolve({
          rows: stageExists ? [{ id: 'stage-2', name: 'Cotizacion' }] : [],
        })
      }
      // Final SELECT JOIN for the return payload.
      if (sqlStr.includes('FROM crm_deals d')) {
        return Promise.resolve({
          rows: [{
            id: 'deal-1',
            stage: 'cotizacion',
            stage_id: 'stage-2',
            enterprise_id: 'ent-existing',
            notes: 'updated note',
            value: 1000,
          }],
        })
      }
      return Promise.resolve({ rows: [] })
    })

    mockPoolQuery.mockImplementation((sqlStr: string, values: any[]) => {
      calls.push({ sql: sqlStr, values: values ?? [] })
      return Promise.resolve({ rows: [] })
    })

    return calls
  }

  it('persists stage_id when valid — updates both stage_id and denormalized stage name', async () => {
    const calls = setup({ stageExists: true })

    await service.updateDeal('company-1', 'deal-1', {
      stage_id: '11111111-2222-4333-8444-555555555555',
    })

    const update = calls.find(c => c.sql.includes('UPDATE crm_deals SET'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain('stage_id = $')
    expect(update!.sql).toContain('stage = $')
    // Resolved from stage lookup: id 'stage-2' + lowercased name 'cotizacion'.
    expect(update!.values).toContain('stage-2')
    expect(update!.values).toContain('cotizacion')
  })

  it('rejects invalid stage_id with 400', async () => {
    setup({ stageExists: false })

    await expect(
      service.updateDeal('company-1', 'deal-1', {
        stage_id: '99999999-9999-4999-8999-999999999999',
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/stage_id invalido/) })
  })

  it('stage_id absent from payload → no-op on stage (not touched)', async () => {
    const calls = setup({ stageExists: true })

    await service.updateDeal('company-1', 'deal-1', {
      notes: 'just updating notes',
    })

    const update = calls.find(c => c.sql.includes('UPDATE crm_deals SET'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain('notes = $')
    expect(update!.sql).not.toContain('stage_id = $')
    expect(update!.sql).not.toContain('stage = $')
  })

  it('partial update preserves enterprise_id — does NOT write it to NULL when absent', async () => {
    const calls = setup({ stageExists: true })

    await service.updateDeal('company-1', 'deal-1', {
      notes: 'n',
      value: 500,
    })

    const update = calls.find(c => c.sql.includes('UPDATE crm_deals SET'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain('notes = $')
    expect(update!.sql).toContain('value = $')
    // CRITICAL: unsent enterprise_id must NOT appear in SET (would wipe to NULL).
    expect(update!.sql).not.toContain('enterprise_id = $')
    expect(update!.sql).not.toContain('customer_id = $')
  })

  it('notes-only update does not touch stage_id/stage — preserves current stage', async () => {
    const calls = setup({ stageExists: true })

    await service.updateDeal('company-1', 'deal-1', {
      notes: 'quick follow-up call',
    })

    const update = calls.find(c => c.sql.includes('UPDATE crm_deals SET'))
    expect(update).toBeDefined()
    expect(update!.sql).not.toContain('stage_id = $')
    expect(update!.sql).not.toContain(' stage = $')
  })
})
