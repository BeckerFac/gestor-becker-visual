import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { BusinessService } from '../src/modules/reports/business.service'

/**
 * PR7-T13 follow-up: business sales reports MUST exclude credit notes (NC%)
 * from revenue aggregations. Otherwise issuing a credit note inflates reported
 * revenue, which is a fiscal audit liability.
 *
 * Semantic: NCs are EXCLUDED entirely (not subtracted). Same as
 * reports.service.ts uninvoiced calculation in PR7-T13.
 */

function joinSqlStrings(call: any): string {
  // The drizzle-orm mock returns { strings, values } from the sql tag.
  const arg = call?.[0]
  if (!arg) return ''
  if (typeof arg === 'string') return arg
  const strings = arg.strings || []
  return Array.isArray(strings) ? strings.join(' ') : ''
}

function allCallsJoined(): string[] {
  return mockDbExecute.mock.calls.map(joinSqlStrings)
}

describe('BusinessService - NC exclusion in revenue aggregations', () => {
  let service: BusinessService

  beforeEach(() => {
    resetMocks()
    service = new BusinessService()
  })

  describe('getVentasReport', () => {
    it('excludes NCs from total_facturado (1 Factura A 100k + 1 NC_A 30k = 100k, NOT 130k or 70k)', async () => {
      // Mock 6 queries in order: current totals, prev totals, ventas_por_mes,
      // ventas_prev_mes, top_productos, ventas_por_dia.
      // The service filters NCs at the SQL level, so the mocked DB returns
      // already-filtered results (only the Factura A 100k).
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total_facturado: '100000', cantidad_facturas: '1', ticket_promedio: '100000' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total_facturado: '0', cantidad_facturas: '0', ticket_promedio: '0' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ periodo: '2026-04', total: '100000', cantidad: '1' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ nombre: 'Producto A', unidades: '1', revenue: '100000' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ dow: '1', total: '100000', cantidad: '1' }] })

      const report = await service.getVentasReport('company-1', '2026-04-01', '2026-04-30')

      expect(report.summary.total_facturado).toBe(100000)
      expect(report.summary.cantidad_pedidos).toBe(1)
      expect(report.summary.total_facturado).not.toBe(130000) // would be inflated if NCs counted
      expect(report.summary.total_facturado).not.toBe(70000)  // would be wrong if NCs subtracted

      // Verify all SQL queries that touch the invoices table include the NC exclusion clause
      const calls = allCallsJoined()
      const invoiceQueries = calls.filter(s => /\binvoices\b/i.test(s))
      expect(invoiceQueries.length).toBeGreaterThan(0)
      for (const q of invoiceQueries) {
        expect(q).toMatch(/invoice_type::text NOT LIKE 'NC%'/)
      }
    })

    it('top_productos query SQL excludes NCs via JOIN on invoices', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total_facturado: '0', cantidad_facturas: '0', ticket_promedio: '0' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total_facturado: '0', cantidad_facturas: '0', ticket_promedio: '0' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })

      await service.getVentasReport('company-1', '2026-04-01', '2026-04-30')

      const calls = allCallsJoined()
      // The top_productos query joins invoice_items with invoices
      const topProdQuery = calls.find(s => /invoice_items/.test(s) && /JOIN invoices/.test(s))
      expect(topProdQuery).toBeDefined()
      expect(topProdQuery!).toMatch(/i\.invoice_type::text NOT LIKE 'NC%'/)
    })

    it('ventas_por_mes monthly breakdown SQL excludes NCs', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total_facturado: '0', cantidad_facturas: '0', ticket_promedio: '0' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [{ total_facturado: '0', cantidad_facturas: '0', ticket_promedio: '0' }] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      mockDbExecute.mockResolvedValueOnce({ rows: [] })

      await service.getVentasReport('company-1', '2026-04-01', '2026-04-30')

      const calls = allCallsJoined()
      const monthlyQueries = calls.filter(s => /TO_CHAR\(invoice_date, 'YYYY-MM'\)/.test(s))
      expect(monthlyQueries.length).toBeGreaterThanOrEqual(1)
      for (const q of monthlyQueries) {
        expect(q).toMatch(/invoice_type::text NOT LIKE 'NC%'/)
      }
    })

    it('handles company with zero invoices: returns 0, not null, not error', async () => {
      // All 6 queries return empty
      for (let i = 0; i < 6; i++) {
        mockDbExecute.mockResolvedValueOnce({ rows: [] })
      }

      const report = await service.getVentasReport('company-empty', '2026-04-01', '2026-04-30')

      expect(report.summary.total_facturado).toBe(0)
      expect(report.summary.cantidad_pedidos).toBe(0)
      expect(report.summary.ticket_promedio).toBe(0)
      expect(report.ventas_por_mes).toEqual([])
      expect(report.top_productos).toEqual([])
    })
  })

  describe('getRentabilidadReport', () => {
    it('rentabilidad queries exclude NCs via JOIN on invoices', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // productos
      mockDbExecute.mockResolvedValueOnce({ rows: [{ revenue: '0', costo: '0' }] }) // prev

      await service.getRentabilidadReport('company-1', '2026-04-01', '2026-04-30')

      const calls = allCallsJoined()
      const invoiceJoinQueries = calls.filter(s => /JOIN invoices/.test(s))
      expect(invoiceJoinQueries.length).toBeGreaterThan(0)
      for (const q of invoiceJoinQueries) {
        expect(q).toMatch(/i\.invoice_type::text NOT LIKE 'NC%'/)
      }
    })
  })
})
