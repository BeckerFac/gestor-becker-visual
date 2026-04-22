import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'
import { pool } from '../src/config/db'

import { QuotesService } from '../src/modules/quotes/quotes.service'

// Build a fake pg client with a query log so each test can drive return values
// by inspecting the SQL string. Mirrors the style used by orders.service.test.ts
// for db.execute mocking.
type ClientImpl = (sqlStr: string, params: any[]) => any

function makeClient(impl: ClientImpl) {
  const calls: { sql: string; params: any[] }[] = []
  const client = {
    query: vi.fn(async (sqlStr: string, params: any[] = []) => {
      calls.push({ sql: sqlStr, params })
      const r = impl(sqlStr, params)
      if (r && typeof r.then === 'function') return r
      return r ?? { rows: [] }
    }),
    release: vi.fn(),
  }
  return { client, calls }
}

function installPoolConnect(client: any) {
  ;(pool as any).connect = vi.fn(async () => client)
}

describe('QuotesService', () => {
  let service: QuotesService

  beforeEach(() => {
    resetMocks()
    service = new QuotesService()
    // Skip ensureMigrations side effects
    ;(service as any).migrationsRun = true
    mockDbExecute.mockResolvedValue({ rows: [] })
  })

  // -------------------------------------------------------------------------
  // Bug A + B: updateQuoteStatus transaction + idempotency
  // -------------------------------------------------------------------------
  describe('updateQuoteStatus -> accepted', () => {
    function buildAcceptImpl(opts: { initialStatus?: string; existingOrder?: any; failOnInsertOrder?: boolean } = {}): ClientImpl {
      const initialStatus = opts.initialStatus ?? 'draft'
      let quoteRow: any = {
        id: 'q1', status: initialStatus, company_id: 'c1',
        customer_id: 'cust-1', enterprise_id: 'ent-1',
        total_amount: '1000.00', title: 'Q', notes: null,
        quote_number: 1, created_by: 'u1',
      }
      return (sqlStr: string, _params: any[]) => {
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(sqlStr.trim())) return { rows: [] }
        if (sqlStr.includes('FOR UPDATE')) return { rows: [{ id: quoteRow.id, status: quoteRow.status }] }
        if (sqlStr.includes('SELECT id, order_number FROM orders WHERE quote_id')) {
          return { rows: opts.existingOrder ? [opts.existingOrder] : [] }
        }
        if (sqlStr.includes('UPDATE quotes SET status')) {
          quoteRow.status = 'accepted'
          return { rows: [] }
        }
        if (sqlStr.startsWith('SELECT q.* FROM quotes q')) return { rows: [quoteRow] }
        if (sqlStr.includes('FROM quote_items')) {
          return { rows: [{ id: 'qi-1', product_name: 'P', quantity: 1, unit_price: '1000', subtotal: '1000', product_id: null }] }
        }
        if (sqlStr.includes('SELECT enterprise_id FROM customers')) return { rows: [{ enterprise_id: 'ent-1' }] }
        if (sqlStr.includes('SELECT COALESCE(MAX(order_number)')) return { rows: [{ next_number: 7 }] }
        if (sqlStr.startsWith('INSERT INTO orders')) {
          if (opts.failOnInsertOrder) throw new Error('boom: order insert failed')
          return { rows: [] }
        }
        if (sqlStr.startsWith('INSERT INTO order_items')) return { rows: [] }
        if (sqlStr.startsWith('INSERT INTO order_status_history')) return { rows: [] }
        return { rows: [] }
      }
    }

    it('Bug B: accepting twice short-circuits and returns the existing order (no duplicate)', async () => {
      // First accept: status starts as 'draft', creates order
      const first = makeClient(buildAcceptImpl({ initialStatus: 'draft' }))
      installPoolConnect(first.client)
      const r1 = await service.updateQuoteStatus('c1', 'q1', 'accepted')
      expect(r1.order).toBeTruthy()
      expect((r1 as any).already).toBe(false)
      const insertOrderCalls1 = first.calls.filter(c => c.sql.startsWith('INSERT INTO orders'))
      expect(insertOrderCalls1.length).toBe(1)

      // Second accept: status is already 'accepted'; service must NOT insert again
      // and must return the pre-existing order row.
      const second = makeClient(buildAcceptImpl({
        initialStatus: 'accepted',
        existingOrder: { id: 'order-existing', order_number: 7 },
      }))
      installPoolConnect(second.client)
      const r2 = await service.updateQuoteStatus('c1', 'q1', 'accepted')
      expect((r2 as any).already).toBe(true)
      expect(r2.order).toEqual({ id: 'order-existing', order_number: 7 })
      const insertOrderCalls2 = second.calls.filter(c => c.sql.startsWith('INSERT INTO orders'))
      expect(insertOrderCalls2.length).toBe(0)
    })

    it('Bug A: rolls back the quote status update when convertQuoteToOrderInTx fails', async () => {
      const { client, calls } = makeClient(buildAcceptImpl({ failOnInsertOrder: true }))
      installPoolConnect(client)

      await expect(service.updateQuoteStatus('c1', 'q1', 'accepted')).rejects.toThrow()

      // Verify ROLLBACK was issued and COMMIT was not
      const rollback = calls.find(c => /^ROLLBACK/i.test(c.sql.trim()))
      const commit = calls.find(c => /^COMMIT/i.test(c.sql.trim()))
      expect(rollback).toBeTruthy()
      expect(commit).toBeFalsy()
    })

    it('Bug A: 404 when quote not found (no commit, releases client)', async () => {
      const { client, calls } = makeClient((sqlStr: string) => {
        if (sqlStr.includes('FOR UPDATE')) return { rows: [] }
        return { rows: [] }
      })
      installPoolConnect(client)
      await expect(service.updateQuoteStatus('c1', 'missing', 'accepted')).rejects.toMatchObject({ statusCode: 404 })
      expect(client.release).toHaveBeenCalled()
      expect(calls.find(c => /^COMMIT/i.test(c.sql.trim()))).toBeFalsy()
    })
  })

  // -------------------------------------------------------------------------
  // Bug C: cross-tenant validation on createQuote / updateQuote
  // -------------------------------------------------------------------------
  describe('createQuote tenant validation', () => {
    it('rejects enterprise_id from another company', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('FROM enterprises WHERE id =')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      })
      await expect(
        service.createQuote('c1', 'u1', { enterprise_id: 'ent-other', items: [] })
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('rejects customer_id from another company', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('FROM customers WHERE id =')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      })
      await expect(
        service.createQuote('c1', 'u1', { customer_id: 'cust-other', items: [] })
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('rejects product_id from another company', async () => {
      // PR7-T22: products tenant check now uses pool.query (drizzle ANY(uuid[]) bug fix).
      mockPoolQuery.mockImplementation((sqlStr: string) => {
        if (sqlStr.includes('FROM products WHERE id = ANY')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      })
      await expect(
        service.createQuote('c1', 'u1', {
          items: [{ product_id: '00000000-0000-0000-0000-000000000abc', product_name: 'X', quantity: 1, unit_price: 100 }],
        })
      ).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  // -------------------------------------------------------------------------
  // Bug D: updateQuote partial PATCH must not delete items
  // -------------------------------------------------------------------------
  describe('updateQuote items preservation (Bug D)', () => {
    it('does NOT touch quote_items when data.items is undefined', async () => {
      // Mock getQuote() (uses db.execute) to return an existing quote
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('FROM quotes q') && sqlStr.includes('LEFT JOIN customers')) {
          return Promise.resolve({ rows: [{
            id: 'q1', company_id: 'c1', customer_id: 'cust-1', enterprise_id: 'ent-1',
            title: 'T', notes: 'old notes', subtotal: '1000', vat_amount: '210',
            total_amount: '1210', valid_until: null, custom_company_name: null,
          }] })
        }
        if (sqlStr.includes('FROM quote_items')) {
          return Promise.resolve({ rows: [{ id: 'qi-1' }] })
        }
        return Promise.resolve({ rows: [] })
      })

      const { client, calls } = makeClient(() => ({ rows: [] }))
      installPoolConnect(client)

      const result = await service.updateQuote('c1', 'q1', { notes: 'new notes' })
      expect(result.id).toBe('q1')

      // The transactional client must NOT issue any DELETE on quote_items
      const deletedItems = calls.find(c => c.sql.includes('DELETE FROM quote_items'))
      expect(deletedItems).toBeFalsy()
      // Total must be preserved from existing quote, not zeroed
      expect(result.total_amount).toBe(1210)
    })

    it('DOES delete + reinsert items when data.items is an explicit array (even empty)', async () => {
      mockDbExecute.mockImplementation((...args: any[]) => {
        const tpl = args[0]
        const sqlStr = tpl?.strings ? tpl.strings.join('') : ''
        if (sqlStr.includes('FROM quotes q') && sqlStr.includes('LEFT JOIN customers')) {
          return Promise.resolve({ rows: [{
            id: 'q1', company_id: 'c1', customer_id: 'cust-1', enterprise_id: 'ent-1',
            title: 'T', notes: null, subtotal: '1000', vat_amount: '210',
            total_amount: '1210', valid_until: null, custom_company_name: null,
          }] })
        }
        if (sqlStr.includes('FROM quote_items')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      })

      const { client, calls } = makeClient(() => ({ rows: [] }))
      installPoolConnect(client)

      const result = await service.updateQuote('c1', 'q1', { items: [] })
      expect(result.id).toBe('q1')
      const deletedItems = calls.find(c => c.sql.includes('DELETE FROM quote_items'))
      expect(deletedItems).toBeTruthy()
      // Empty items => totals zeroed (intentional clear)
      expect(result.total_amount).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // DELETE /api/quotes/:id — soft-delete
  // -------------------------------------------------------------------------
  // Double-delete semantics: second call is a no-op and returns { already: true }.
  // We intentionally do NOT return 404 on the second call because the caller has
  // already observed the row (it's still in the table as 'cancelled'); a 404
  // would be misleading. An "already cancelled" state is idempotent on purpose.
  describe('deleteQuote (soft-delete)', () => {
    type DeleteOpts = { status?: string; hasOrder?: boolean; missing?: boolean }

    function buildDeleteImpl(opts: DeleteOpts = {}): ClientImpl {
      const status = opts.status ?? 'draft'
      return (sqlStr: string, _params: any[]) => {
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(sqlStr.trim())) return { rows: [] }
        if (sqlStr.includes('FOR UPDATE')) {
          if (opts.missing) return { rows: [] }
          return { rows: [{ id: 'q1', status }] }
        }
        if (sqlStr.includes('FROM orders WHERE quote_id')) {
          return { rows: opts.hasOrder ? [{ id: 'order-1' }] : [] }
        }
        if (sqlStr.includes("UPDATE quotes") && sqlStr.includes("cancelled_at")) {
          return { rows: [] }
        }
        return { rows: [] }
      }
    }

    it('soft-deletes an active (draft) quote -> status=cancelled and records audit fields', async () => {
      const { client, calls } = makeClient(buildDeleteImpl({ status: 'draft' }))
      installPoolConnect(client)

      const res = await service.deleteQuote('c1', 'q1', 'u1', 'cliente canceló')
      expect(res).toMatchObject({ quote_id: 'q1', status: 'cancelled', already: false })

      // UPDATE must include cancelled_at, cancelled_by, cancellation_reason
      const updateCall = calls.find(c => c.sql.includes('UPDATE quotes') && c.sql.includes('cancelled_at'))
      expect(updateCall).toBeTruthy()
      // Params: [userId, reason, quoteId, companyId]
      expect(updateCall!.params).toEqual(['u1', 'cliente canceló', 'q1', 'c1'])

      // COMMIT ran, no ROLLBACK
      expect(calls.find(c => /^COMMIT/i.test(c.sql.trim()))).toBeTruthy()
      expect(calls.find(c => /^ROLLBACK/i.test(c.sql.trim()))).toBeFalsy()
      expect(client.release).toHaveBeenCalled()
    })

    it('blocks delete of an accepted quote with a linked order (400)', async () => {
      const { client, calls } = makeClient(buildDeleteImpl({ status: 'accepted', hasOrder: true }))
      installPoolConnect(client)

      await expect(service.deleteQuote('c1', 'q1', 'u1')).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('pedido vinculado'),
      })

      // Must ROLLBACK (we opened BEGIN) and NOT issue the UPDATE
      expect(calls.find(c => /^ROLLBACK/i.test(c.sql.trim()))).toBeTruthy()
      expect(calls.find(c => /^COMMIT/i.test(c.sql.trim()))).toBeFalsy()
      expect(calls.find(c => c.sql.includes('UPDATE quotes') && c.sql.includes('cancelled_at'))).toBeFalsy()
      expect(client.release).toHaveBeenCalled()
    })

    it('allows delete of accepted quote WITHOUT a linked order (data-shape anomaly recovery)', async () => {
      const { client, calls } = makeClient(buildDeleteImpl({ status: 'accepted', hasOrder: false }))
      installPoolConnect(client)

      const res = await service.deleteQuote('c1', 'q1', 'u1')
      expect(res.status).toBe('cancelled')
      expect(calls.find(c => c.sql.includes('UPDATE quotes') && c.sql.includes('cancelled_at'))).toBeTruthy()
    })

    it('404 when quote does not exist', async () => {
      const { client } = makeClient(buildDeleteImpl({ missing: true }))
      installPoolConnect(client)

      await expect(service.deleteQuote('c1', 'missing', 'u1')).rejects.toMatchObject({ statusCode: 404 })
      expect(client.release).toHaveBeenCalled()
    })

    it('second delete is an idempotent no-op (already=true, no UPDATE issued)', async () => {
      const { client, calls } = makeClient(buildDeleteImpl({ status: 'cancelled' }))
      installPoolConnect(client)

      const res = await service.deleteQuote('c1', 'q1', 'u1', 'ignored')
      expect(res).toMatchObject({ quote_id: 'q1', status: 'cancelled', already: true })
      // Must NOT re-issue the UPDATE (preserves original cancelled_at / by / reason)
      expect(calls.find(c => c.sql.includes('UPDATE quotes') && c.sql.includes('cancelled_at'))).toBeFalsy()
      // Still commits the transaction cleanly (SELECT FOR UPDATE took a row lock)
      expect(calls.find(c => /^COMMIT/i.test(c.sql.trim()))).toBeTruthy()
    })

    it('tenant isolation: SELECT FOR UPDATE uses (id, company_id) tuple', async () => {
      const { client, calls } = makeClient(buildDeleteImpl({ status: 'draft' }))
      installPoolConnect(client)

      await service.deleteQuote('c1', 'q1', 'u1')
      const lockCall = calls.find(c => c.sql.includes('FOR UPDATE'))
      expect(lockCall).toBeTruthy()
      // quoteId is $1, companyId is $2
      expect(lockCall!.params).toEqual(['q1', 'c1'])
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/quotes/:id/duplicate — duplicate endpoint
  // -------------------------------------------------------------------------
  describe('duplicateQuote', () => {
    type DupOpts = { missing?: boolean; items?: any[]; source?: any }

    function buildDuplicateImpl(opts: DupOpts = {}): ClientImpl {
      const source = opts.source ?? {
        id: 'q-src',
        company_id: 'c1',
        customer_id: 'cust-1',
        enterprise_id: 'ent-1',
        title: 'Original',
        notes: 'Cliente requiere entrega urgente',
        custom_company_name: 'BV-Alt',
        subtotal: '1000',
        vat_amount: '210',
        total_amount: '1210',
        status: 'sent',
      }
      const items = opts.items ?? [
        { id: 'qi-1', product_id: 'p1', product_name: 'Banner', description: 'Vinilo', quantity: 2, unit_price: '500', vat_rate: '21', subtotal: '1000' },
        { id: 'qi-2', product_id: null, product_name: 'Servicio', description: null, quantity: 1, unit_price: '300', vat_rate: '10.5', subtotal: '300' },
      ]
      return (sqlStr: string, _params: any[]) => {
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(sqlStr.trim())) return { rows: [] }
        if (sqlStr.includes('SELECT * FROM quotes WHERE id')) {
          return { rows: opts.missing ? [] : [source] }
        }
        if (sqlStr.includes('FROM quote_items')) {
          return { rows: items }
        }
        if (sqlStr.startsWith('INSERT INTO quotes')) return { rows: [] }
        if (sqlStr.startsWith('INSERT INTO quote_items')) return { rows: [] }
        return { rows: [] }
      }
    }

    it('creates a new draft quote preserving enterprise, customer, notes and items', async () => {
      const { client, calls } = makeClient(buildDuplicateImpl())
      installPoolConnect(client)

      const res = await service.duplicateQuote('c1', 'q-src', 'u1')

      // New id is a fresh uuid (different from source)
      expect(res.id).toBeTruthy()
      expect(res.id).not.toBe('q-src')
      expect(res.status).toBe('draft')
      expect(res.title).toBe('Original (copia)')

      // INSERT INTO quotes: check values by parameters.
      // Params order in service: [newId, companyId, customer_id, enterprise_id, title, valid_until,
      //                           subtotal, vat, total, notes, custom_company_name, created_by]
      const quoteInsert = calls.find(c => c.sql.startsWith('INSERT INTO quotes'))
      expect(quoteInsert).toBeTruthy()
      const p = quoteInsert!.params
      expect(p[1]).toBe('c1')            // companyId
      expect(p[2]).toBe('cust-1')        // customer_id preserved
      expect(p[3]).toBe('ent-1')         // enterprise_id preserved
      expect(p[4]).toBe('Original (copia)') // title + " (copia)"
      expect(p[5]).toMatch(/^\d{4}-\d{2}-\d{2}$/) // valid_until ISO date
      expect(p[9]).toBe('Cliente requiere entrega urgente') // notes preserved
      expect(p[10]).toBe('BV-Alt')       // custom_company_name preserved
      expect(p[11]).toBe('u1')           // created_by = caller

      // All source items copied (2 inserts into quote_items)
      const itemInserts = calls.filter(c => c.sql.startsWith('INSERT INTO quote_items'))
      expect(itemInserts.length).toBe(2)
      // First item params: [id, quoteId, product_id, product_name, description, qty, unit_price, vat, subtotal]
      expect(itemInserts[0].params[2]).toBe('p1')
      expect(itemInserts[0].params[3]).toBe('Banner')
      expect(itemInserts[0].params[5]).toBe(2) // quantity preserved
      expect(itemInserts[1].params[2]).toBeNull() // null product_id preserved
      expect(itemInserts[1].params[7]).toBe('10.5') // vat_rate preserved

      // COMMIT (no rollback)
      expect(calls.find(c => /^COMMIT/i.test(c.sql.trim()))).toBeTruthy()
      expect(calls.find(c => /^ROLLBACK/i.test(c.sql.trim()))).toBeFalsy()
      expect(client.release).toHaveBeenCalled()
    })

    it('resets valid_until to 30 days from today', async () => {
      const { client, calls } = makeClient(buildDuplicateImpl())
      installPoolConnect(client)

      await service.duplicateQuote('c1', 'q-src', 'u1')

      const quoteInsert = calls.find(c => c.sql.startsWith('INSERT INTO quotes'))
      const validUntilStr = quoteInsert!.params[5] as string
      const validUntil = new Date(validUntilStr + 'T00:00:00')
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const diffDays = Math.round((validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      expect(diffDays).toBe(30)
    })

    it('recalculates totals from source items (does not trust stored aggregates)', async () => {
      // Source has stored total_amount '9999' but items would recalc to 1000 + 300 with their own VAT
      const { client } = makeClient(buildDuplicateImpl({
        source: {
          id: 'q-src', company_id: 'c1', customer_id: null, enterprise_id: null,
          title: 'X', notes: null, custom_company_name: null,
          subtotal: '9999', vat_amount: '9999', total_amount: '9999',
        },
      }))
      installPoolConnect(client)

      const res = await service.duplicateQuote('c1', 'q-src', 'u1')
      // items recalc: 2*500=1000 @21% = 210 vat; 1*300=300 @10.5% = 31.5 vat
      // subtotal = 1300, vat = 241.5, total = 1541.5
      expect(res.total_amount).toBeCloseTo(1541.5, 2)
    })

    it('returns 404 when source quote does not exist', async () => {
      const { client } = makeClient(buildDuplicateImpl({ missing: true }))
      installPoolConnect(client)

      await expect(service.duplicateQuote('c1', 'missing', 'u1')).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(client.release).toHaveBeenCalled()
    })

    it('rolls back on insert failure and does not leak half-populated quote', async () => {
      const { client, calls } = makeClient((sqlStr: string, _params: any[]) => {
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(sqlStr.trim())) return { rows: [] }
        if (sqlStr.includes('SELECT * FROM quotes WHERE id')) {
          return { rows: [{
            id: 'q-src', company_id: 'c1', customer_id: 'cust-1', enterprise_id: 'ent-1',
            title: 'T', notes: null, custom_company_name: null,
          }] }
        }
        if (sqlStr.includes('FROM quote_items')) return { rows: [] }
        if (sqlStr.startsWith('INSERT INTO quotes')) {
          throw new Error('boom: insert failed')
        }
        return { rows: [] }
      })
      installPoolConnect(client)

      await expect(service.duplicateQuote('c1', 'q-src', 'u1')).rejects.toThrow()

      expect(calls.find(c => /^ROLLBACK/i.test(c.sql.trim()))).toBeTruthy()
      expect(calls.find(c => /^COMMIT/i.test(c.sql.trim()))).toBeFalsy()
      expect(client.release).toHaveBeenCalled()
    })
  })
})
