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
})
