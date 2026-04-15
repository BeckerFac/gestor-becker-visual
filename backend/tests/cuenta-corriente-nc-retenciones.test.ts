import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

import { CuentaCorrienteService } from '../src/modules/cuenta-corriente/cuenta-corriente.service'

/**
 * Tests para los 3 bugs criticos resueltos en cuenta-corriente.service.ts:
 *
 * Bug A: NCs no deben contar como ventas en getResumen / getDetalle / getPdfData.
 * Bug B: Retenciones deben aparecer en getDetalle (eran data loss).
 * Bug C: Filtros anulado faltantes en cobros/pagos/purchase_invoices.
 *
 * Estos tests verifican que las queries SQL emitidas por el servicio
 * incluyen los filtros correctos. No se mockea data — solo se inspecciona
 * el SQL generado (que es la unidad realmente cambiada por estos fixes).
 */
describe('CuentaCorrienteService — NC exclusion + retenciones + anulado filters', () => {
  let service: CuentaCorrienteService
  // Cada query ejecutada queda registrada con su SQL aplanado.
  let executedSqls: string[]

  // Aplanado recursivo del SQL: el mock de drizzle-orm hace que sql`` retorne
  // {strings, values}, y los fragments anidados (ej. ${cobrosAnuladoFilter})
  // quedan como otro objeto en `values`. Aplanamos para inspeccionar el SQL final.
  function flattenSql(tpl: any): string {
    if (tpl == null) return ''
    if (typeof tpl === 'string') return tpl
    if (Array.isArray(tpl)) return tpl.map(flattenSql).join('')
    if (tpl.strings && Array.isArray(tpl.strings)) {
      const parts: string[] = []
      for (let i = 0; i < tpl.strings.length; i++) {
        parts.push(tpl.strings[i])
        if (i < (tpl.values?.length || 0)) parts.push(flattenSql(tpl.values[i]))
      }
      return parts.join('')
    }
    return ''
  }

  beforeEach(() => {
    resetMocks()
    service = new CuentaCorrienteService()
    executedSqls = []

    // Capturar y aplanar todos los SQL ejecutados via db.execute.
    mockDbExecute.mockImplementation((tpl: any) => {
      const sqlStr = flattenSql(tpl)
      executedSqls.push(sqlStr)
      // enterprise lookup: devolver row para no abortar getPdfData
      if (sqlStr.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
      }
      if (sqlStr.includes('FROM companies WHERE id')) {
        return Promise.resolve({ rows: [{ name: 'Co', cuit: '20-11111111-1' }] })
      }
      return Promise.resolve({ rows: [] })
    })

    // Capturar y registrar los SQL ejecutados via pool.query (getDetalle).
    mockPoolQuery.mockImplementation((sqlStr: string) => {
      executedSqls.push(sqlStr)
      if (sqlStr.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  })

  describe('Bug A — NC exclusion', () => {
    it('getResumen excluye NCs del subquery total_ventas', async () => {
      await service.getResumen('company-1')
      const ventasSql = executedSqls.find((s) => s.includes('total_ventas') && s.includes('FROM enterprises'))
      expect(ventasSql).toBeDefined()
      expect(ventasSql!).toContain("invoice_type::text NOT LIKE 'NC%'")
    })

    it('getResumen excluye NCs de total_cobros_aplicados', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_cobros_aplicados'))
      expect(sql).toBeDefined()
      // El subquery de cobros aplicados ahora filtra invoices NC.
      const cobrosBlock = sql!.split('total_cobros_aplicados')[0]
      expect(cobrosBlock).toContain("invoice_type::text NOT LIKE 'NC%'")
    })

    it('getDetalle excluye NCs de la rama de invoices', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const unionSql = executedSqls.find((s) => s.includes('UNION ALL') && s.includes('FROM invoices'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("i.invoice_type::text NOT LIKE 'NC%'")
    })

    it('getPdfData excluye NCs de invoices y cobros aplicados', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31')
      const invoicesSql = executedSqls.find((s) => s.includes("'factura' as tipo"))
      expect(invoicesSql).toBeDefined()
      expect(invoicesSql!).toContain("invoice_type::text NOT LIKE 'NC%'")

      const cobrosSql = executedSqls.find((s) => s.includes("'cobro' as tipo"))
      expect(cobrosSql).toBeDefined()
      expect(cobrosSql!).toContain("invoice_type::text NOT LIKE 'NC%'")
    })
  })

  describe('Bug B — Retenciones en getDetalle', () => {
    it('getDetalle incluye rama UNION para retenciones sufridas', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const unionSql = executedSqls.find((s) => s.includes("'retencion_sufrida'"))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("FROM retenciones r")
      expect(unionSql!).toContain("r.direction = 'sufrida'")
      // Sufrida va al haber (reduce deuda cliente)
      expect(unionSql!).toMatch(/0::decimal as debe[\s\S]*r\.amount[\s\S]*as haber[\s\S]*'sufrida'/)
    })

    it('getDetalle incluye rama UNION para retenciones practicadas', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const unionSql = executedSqls.find((s) => s.includes("'retencion_practicada'"))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("r.direction = 'practicada'")
      // Practicada va al debe (reduce deuda proveedor)
      const practicadaBlock = unionSql!.split("'retencion_practicada'")[1] || ''
      expect(practicadaBlock).toContain("AS decimal) as debe")
      expect(practicadaBlock).toContain("0::decimal as haber")
      expect(practicadaBlock).toContain("'practicada'")
    })
  })

  describe('Bug C — anulado filters', () => {
    it('getResumen filtra pagos anulados en total_adelantos_pagos', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_adelantos_pagos'))
      expect(sql).toBeDefined()
      // Antes del fix faltaba este filtro.
      expect(sql!).toContain("pa.status")
      expect(sql!).toContain("'anulado'")
    })

    it('getResumen filtra pagos anulados en total_pagos_aplicados', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_pagos_aplicados'))
      expect(sql).toBeDefined()
      // El bloque del subquery ahora joinea pagos y filtra anulado.
      const block = sql!.split('total_pagos_aplicados')[0]
      expect(block).toContain('JOIN pagos pa')
      expect(block).toContain("pi.status NOT IN ('cancelled', 'cancelado')")
    })

    it('getDetalle filtra cobros anulados', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const unionSql = executedSqls.find((s) => s.includes('FROM cobros c'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("c.status")
      expect(unionSql!).toContain("'anulado'")
    })

    it('getDetalle filtra purchase_invoices canceladas', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const unionSql = executedSqls.find((s) => s.includes('FROM purchase_invoices pi'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("pi.status NOT IN ('cancelled', 'cancelado')")
    })

    it('getDetalle filtra pagos anulados', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const unionSql = executedSqls.find((s) => s.includes('FROM pagos p'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("p.status")
      expect(unionSql!).toContain("'anulado'")
    })

    it('getPdfData filtra pagos anulados y purchase_invoices canceladas', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31')
      const sql = executedSqls.find((s) => s.includes("'pago' as tipo"))
      expect(sql).toBeDefined()
      expect(sql!).toContain("pa.status")
      expect(sql!).toContain("'anulado'")
      expect(sql!).toContain("pi.status NOT IN ('cancelled', 'cancelado')")
    })
  })

  describe('Integration — running balance with retenciones', () => {
    it('getDetalle calcula saldo corrido correctamente con retenciones', async () => {
      // Override pool.query para devolver mov sintéticos.
      mockPoolQuery.mockImplementation((sqlStr: string) => {
        if (sqlStr.includes('FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
        }
        // status checks
        if (sqlStr.includes('SELECT status FROM')) return Promise.resolve({ rows: [] })
        // UNION query: devolver factura $100k + retencion sufrida $10k
        return Promise.resolve({
          rows: [
            { fecha: '2025-01-01', tipo: 'fact_venta', nro_comprobante: 'A 0001-00000001', debe: '100000', haber: '0', descripcion: 'Factura A', reference_id: 'inv-1' },
            { fecha: '2025-01-02', tipo: 'retencion_sufrida', nro_comprobante: 'CERT-1', debe: '0', haber: '10000', descripcion: 'Ret. sufrida IIBB', reference_id: 'ret-1' },
          ],
        })
      })

      const result = await service.getDetalle('company-1', 'ent-1')
      expect(result.movimientos).toHaveLength(2)
      expect(result.movimientos[0].saldo).toBe(100000)
      expect(result.movimientos[1].saldo).toBe(90000) // 100k - 10k retencion
      expect(result.totales.debe).toBe(100000)
      expect(result.totales.haber).toBe(10000)
      expect(result.totales.saldo).toBe(90000)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // SUPPLIER-SIDE 7 BUG FIXES (C1, C2, H1, H2, H3, H4, H5)
  // ═══════════════════════════════════════════════════════════════════════
  describe('C1 — Purchase NCs excluded from compras/pagos_aplicados', () => {
    it('getResumen total_compras excludes purchase NCs', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_compras'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_compras')[0]
      // The purchase_invoices subquery for total_compras must filter NC_*
      expect(block).toContain("pi.invoice_type::text NOT LIKE 'NC%'")
    })

    it('getResumen total_pagos_aplicados excludes applications against NCs', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_pagos_aplicados'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_pagos_aplicados')[0]
      expect(block).toContain("pi.invoice_type::text NOT LIKE 'NC%'")
    })

    it('getDetalle purchase_invoices branch excludes NCs', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const union = executedSqls.find((s) => s.includes('FROM purchase_invoices pi'))
      expect(union).toBeDefined()
      expect(union!).toMatch(/pi\.invoice_type.*NOT LIKE 'NC%'/)
    })

    it('getPdfData purchase_invoices query excludes NCs', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31')
      const sql = executedSqls.find((s) => s.includes("'factura_compra' as tipo"))
      expect(sql).toBeDefined()
      expect(sql!).toMatch(/pi\.invoice_type.*NOT LIKE 'NC%'/)
    })
  })

  describe('C2 — Multi-currency detection', () => {
    it('getResumen probes for multi-currency purchase_invoices', async () => {
      await service.getResumen('company-1')
      const probe = executedSqls.find((s) => s.includes('COUNT(DISTINCT currency)'))
      expect(probe).toBeDefined()
    })
  })

  describe('H1 — adelantos_pagos only counts unassigned portion', () => {
    it('getResumen adelantos_pagos subtracts pia_inner.amount_applied from pago total', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_adelantos_pagos'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_adelantos_pagos')[0]
      // Must subtract already-applied portion so it doesn't overlap with total_pagos_aplicados
      expect(block).toMatch(/pa\.total_amount[\s\S]*pia_inner\.amount_applied/)
    })
  })

  describe('H2 — BU filter on retenciones + adjustments', () => {
    it('getResumen retenciones practicadas inherit BU from pago when bu filter is set', async () => {
      await service.getResumen('company-1', 'bu-1')
      const sql = executedSqls.find((s) => s.includes('total_retenciones_practicadas'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_retenciones_practicadas')[0]
      expect(block).toContain('LEFT JOIN pagos rp ON rp.id = r.pago_id')
      expect(block).toContain('rp.business_unit_id')
    })

    it('getResumen retenciones sufridas inherit BU from cobro when bu filter is set', async () => {
      await service.getResumen('company-1', 'bu-1')
      const sql = executedSqls.find((s) => s.includes('total_retenciones_sufridas'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_retenciones_sufridas')[0]
      expect(block).toContain('LEFT JOIN cobros rc ON rc.id = r.cobro_id')
      expect(block).toContain('rc.business_unit_id')
    })
  })

  describe('H3 — Opening balance with date range', () => {
    it('getDetalle with dateFrom issues an opening balance query and starts running balance from it', async () => {
      mockPoolQuery.mockImplementation((sqlStr: string) => {
        if (sqlStr.includes('FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
        }
        if (sqlStr.includes('SELECT status FROM')) return Promise.resolve({ rows: [] })
        if (sqlStr.includes('SELECT business_unit_id FROM account_adjustments')) return Promise.resolve({ rows: [] })
        if (sqlStr.includes('saldo_inicial')) {
          // Opening balance query: return 50k (prior debe balance)
          return Promise.resolve({ rows: [{ saldo_inicial: '50000' }] })
        }
        // Main UNION query: return one movement inside range
        return Promise.resolve({
          rows: [
            { fecha: '2025-06-01', tipo: 'fact_venta', nro_comprobante: 'A 0001', debe: '20000', haber: '0', descripcion: 'Factura A', reference_id: 'inv-1' },
          ],
        })
      })

      const result = await service.getDetalle('company-1', 'ent-1', { dateFrom: '2025-06-01', dateTo: '2025-12-31' })
      expect(result.opening_balance).toBe(50000)
      // Running balance must start at opening, so saldo after +20k = 70k
      expect(result.movimientos[0].saldo).toBe(70000)
      expect(result.closing_balance).toBe(70000)
      // totales.saldo should match closing balance (unified with running)
      expect(result.totales.saldo).toBe(70000)
    })

    it('getDetalle without dateFrom returns opening_balance = 0', async () => {
      mockPoolQuery.mockImplementation((sqlStr: string) => {
        if (sqlStr.includes('FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
        }
        if (sqlStr.includes('SELECT status FROM')) return Promise.resolve({ rows: [] })
        if (sqlStr.includes('SELECT business_unit_id FROM account_adjustments')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      })
      const result = await service.getDetalle('company-1', 'ent-1')
      expect(result.opening_balance).toBe(0)
      // No opening balance query should have been issued
      const openingQuery = executedSqls.find((s) => s.includes('saldo_inicial'))
      expect(openingQuery).toBeUndefined()
    })
  })

  describe('H4 — getDetalle and getPdfData agree on sign convention', () => {
    it('both endpoints compute running balance as +debe -haber (no isPagar flip)', async () => {
      // Same 2 movements: one fact_compra $100k, one pago $40k.
      // Under the unified convention: saldo goes 0 -> +100k -> +60k.
      mockPoolQuery.mockImplementation((sqlStr: string) => {
        if (sqlStr.includes('FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
        }
        if (sqlStr.includes('SELECT status FROM')) return Promise.resolve({ rows: [] })
        if (sqlStr.includes('SELECT business_unit_id FROM account_adjustments')) return Promise.resolve({ rows: [] })
        return Promise.resolve({
          rows: [
            { fecha: '2025-01-01', tipo: 'fact_compra', nro_comprobante: 'A', debe: '100000', haber: '0', descripcion: 'Fact Compra', reference_id: 'pi-1' },
            { fecha: '2025-01-02', tipo: 'orden_pago', nro_comprobante: 'OP-1', debe: '0', haber: '40000', descripcion: 'Pago', reference_id: 'pa-1' },
          ],
        })
      })
      const detalle = await service.getDetalle('company-1', 'ent-1')
      expect(detalle.movimientos[0].saldo).toBe(100000)
      expect(detalle.movimientos[1].saldo).toBe(60000)
      expect(detalle.totales.saldo).toBe(60000)

      // getPdfData uses db.execute for its 8 queries. We mock empty rows for
      // most, but seed purchaseInvoices and pagos to reconstruct the same scenario.
      mockDbExecute.mockImplementation((tpl: any) => {
        const s = flattenSql(tpl)
        if (s.includes('FROM enterprises WHERE id')) return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
        if (s.includes('FROM companies WHERE id')) return Promise.resolve({ rows: [{ name: 'Co', cuit: '20-11111111-1' }] })
        if (s.includes("'factura_compra' as tipo")) {
          return Promise.resolve({ rows: [{ id: 'pi-1', tipo: 'factura_compra', fecha: '2025-01-01', descripcion: 'Fact Compra', monto: '100000' }] })
        }
        if (s.includes("'pago' as tipo")) {
          return Promise.resolve({ rows: [{ id: 'pa-1', tipo: 'pago', fecha: '2025-01-02', descripcion: 'Pago', monto: '40000' }] })
        }
        return Promise.resolve({ rows: [] })
      })
      const pdf = await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31')
      // totalBalance is the final runningBalance with the unified convention: +100k -40k = +60k
      expect(pdf.totalBalance).toBe(60000)
    })
  })

  describe('H5 — Retenciones exclude entries linked to anulado pago/cobro', () => {
    it('getResumen practicadas subquery joins pagos and filters anulado', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_retenciones_practicadas'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_retenciones_practicadas')[0]
      expect(block).toContain('LEFT JOIN pagos rp ON rp.id = r.pago_id')
      expect(block).toMatch(/rp\.status.*!=.*'anulado'/)
    })

    it('getResumen sufridas subquery joins cobros and filters anulado', async () => {
      await service.getResumen('company-1')
      const sql = executedSqls.find((s) => s.includes('total_retenciones_sufridas'))
      expect(sql).toBeDefined()
      const block = sql!.split('total_retenciones_sufridas')[0]
      expect(block).toContain('LEFT JOIN cobros rc ON rc.id = r.cobro_id')
      expect(block).toMatch(/rc\.status.*!=.*'anulado'/)
    })

    it('getDetalle retencion branches filter anulado on linked pago/cobro', async () => {
      await service.getDetalle('company-1', 'ent-1')
      const sql = executedSqls.find((s) => s.includes("'retencion_practicada'"))
      expect(sql).toBeDefined()
      expect(sql!).toContain('LEFT JOIN pagos rp ON rp.id = r.pago_id')
      expect(sql!).toMatch(/rp\.status.*!=.*'anulado'/)
      expect(sql!).toContain('LEFT JOIN cobros rc ON rc.id = r.cobro_id')
      expect(sql!).toMatch(/rc\.status.*!=.*'anulado'/)
    })

    it('getPdfData retencion queries filter anulado on linked pago/cobro', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31')
      const practicadas = executedSqls.find((s) => s.includes("'retencion_practicada' as tipo"))
      expect(practicadas).toBeDefined()
      expect(practicadas!).toContain('LEFT JOIN pagos rp')
      expect(practicadas!).toMatch(/rp\.status.*!=.*'anulado'/)

      const sufridas = executedSqls.find((s) => s.includes("'retencion_sufrida' as tipo"))
      expect(sufridas).toBeDefined()
      expect(sufridas!).toContain('LEFT JOIN cobros rc')
      expect(sufridas!).toMatch(/rc\.status.*!=.*'anulado'/)
    })
  })
})
