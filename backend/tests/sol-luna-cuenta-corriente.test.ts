/**
 * Sol/Luna dual-circuit — Cuenta Corriente service tests (CAT-6).
 *
 * Strategy: we mock `db.execute` and `pool.query` and assert the SQL
 * emitted by the service, plus the returned shape. Since the service is
 * now SQL-layer-dual-circuit (SUM(CASE WHEN fiscal_type=...) aggregates
 * per row), SQL inspection is both necessary and sufficient for most
 * invariants. For the mapping layer (saldo_sol/saldo_luna) we also
 * stub out DB rows and assert the returned objects.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

import { CuentaCorrienteService } from '../src/modules/cuenta-corriente/cuenta-corriente.service'

describe('CuentaCorrienteService — Sol/Luna dual-circuit (CAT-6)', () => {
  let service: CuentaCorrienteService
  let executedSqls: string[]

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

    mockDbExecute.mockImplementation((tpl: any) => {
      const sqlStr = flattenSql(tpl)
      executedSqls.push(sqlStr)
      if (sqlStr.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
      }
      if (sqlStr.includes('FROM companies WHERE id')) {
        return Promise.resolve({ rows: [{ name: 'Co', cuit: '20-11111111-1' }] })
      }
      // The main getResumen query is uniquely identifiable — when found,
      // return the injected fake row via __resumenRow (set per-test).
      if (sqlStr.includes('FROM enterprises') && sqlStr.includes('total_ventas_sol')) {
        return Promise.resolve({ rows: (service as any).__resumenRow || [] })
      }
      return Promise.resolve({ rows: [] })
    })

    mockPoolQuery.mockImplementation((sqlStr: string) => {
      executedSqls.push(sqlStr)
      if (sqlStr.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  })

  // Helper: produce a fake resumen row with full column coverage for mapping.
  function makeResumenRow(overrides: Record<string, any> = {}) {
    return {
      id: 'ent-1',
      name: 'Acme',
      cuit: '20-11111111-1',
      status: 'active',
      total_ventas: '0',
      total_ventas_sol: '0',
      total_ventas_luna: '0',
      total_cobros_aplicados: '0',
      total_cobros_aplicados_sol: '0',
      total_cobros_aplicados_luna: '0',
      total_adelantos_cobros: '0',
      total_adelantos_cobros_sol: '0',
      total_adelantos_cobros_luna: '0',
      total_compras: '0',
      total_pagos_aplicados: '0',
      total_adelantos_pagos: '0',
      total_ajustes_debit: '0',
      total_ajustes_debit_sol: '0',
      total_ajustes_debit_luna: '0',
      total_ajustes_credit: '0',
      total_ajustes_credit_sol: '0',
      total_ajustes_credit_luna: '0',
      total_retenciones_sufridas: '0',
      total_retenciones_sufridas_sol: '0',
      total_retenciones_practicadas: '0',
      total_ncs: '0',
      total_ncs_sol: '0',
      total_ncs_luna: '0',
      ...overrides,
    }
  }

  // ────────────────────────────────────────────────────────────────
  // getResumen
  // ────────────────────────────────────────────────────────────────

  describe('getResumen — shape and Luna gating', () => {
    function primeRow(row: Record<string, any>) {
      (service as any).__resumenRow = [row]
    }

    it('user with canAccessLuna=true receives saldo_sol and saldo_luna', async () => {
      primeRow(makeResumenRow({ total_ventas_sol: '1000', total_ventas_luna: '500' }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0]).toHaveProperty('saldo_sol')
      expect(result[0]).toHaveProperty('saldo_luna')
      expect(result[0].saldo_sol).toBe(1000)
      expect(result[0].saldo_luna).toBe(500)
    })

    it('user with canAccessLuna=false receives only saldo_sol (no saldo_luna key)', async () => {
      primeRow(makeResumenRow({ total_ventas_sol: '1000', total_ventas_luna: '500' }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: false })
      expect(result[0]).toHaveProperty('saldo_sol')
      expect(Object.prototype.hasOwnProperty.call(result[0], 'saldo_luna')).toBe(false)
    })

    it('enterprise with only Sol activity yields saldo_luna=0 for Luna users', async () => {
      primeRow(makeResumenRow({ total_ventas_sol: '5000', total_cobros_aplicados_sol: '1000' }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_sol).toBe(4000)
      expect(result[0].saldo_luna).toBe(0)
    })

    it('enterprise with only Luna activity yields saldo_sol=0', async () => {
      primeRow(makeResumenRow({ total_ventas_luna: '7000', total_cobros_aplicados_luna: '2500' }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_sol).toBe(0)
      expect(result[0].saldo_luna).toBe(4500)
    })

    it('saldo calculation is independent per circuit (no cross-contamination)', async () => {
      primeRow(makeResumenRow({
        total_ventas_sol: '10000',
        total_cobros_aplicados_sol: '3000',
        total_ventas_luna: '4000',
        total_cobros_aplicados_luna: '1000',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_sol).toBe(7000)
      expect(result[0].saldo_luna).toBe(3000)
    })

    it('retenciones sufridas only reduce Sol saldo (Luna has no retenciones)', async () => {
      primeRow(makeResumenRow({
        total_ventas_sol: '10000',
        total_retenciones_sufridas_sol: '500',
        total_ventas_luna: '10000',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_sol).toBe(9500)
      expect(result[0].saldo_luna).toBe(10000)
    })

    it('SQL aggregates both Sol and Luna columns in a single query', async () => {
      await service.getResumen('company-1', { userCanAccessLuna: true })
      const sql = executedSqls.find((s) => s.includes('FROM enterprises') && s.includes('total_ventas'))
      expect(sql).toBeDefined()
      expect(sql!).toContain('total_ventas_sol')
      expect(sql!).toContain('total_ventas_luna')
      expect(sql!).toContain("COALESCE(i.fiscal_type,'fiscal')='fiscal'")
      expect(sql!).toContain("COALESCE(i.fiscal_type,'fiscal')='no_fiscal'")
    })

    it('BU filter and fiscal_type compose correctly', async () => {
      await service.getResumen('company-1', { businessUnitId: 'bu-1', userCanAccessLuna: true })
      const sql = executedSqls.find((s) => s.includes('FROM enterprises'))
      expect(sql).toBeDefined()
      // Per-circuit aggregates still appear.
      expect(sql!).toContain('total_ventas_sol')
      expect(sql!).toContain('total_ventas_luna')
    })

    it('legacy positional signature (companyId, buId) still works', async () => {
      (service as any).__resumenRow = [makeResumenRow()]
      const result = await service.getResumen('company-1', 'bu-1')
      // No saldo_luna because legacy signature = no Luna access.
      expect(Object.prototype.hasOwnProperty.call(result[0], 'saldo_luna')).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getDetalle
  // ────────────────────────────────────────────────────────────────

  describe('getDetalle — fiscal_type required and leak defense', () => {
    it('Luna-only user requesting Luna succeeds', async () => {
      const result = await service.getDetalle('company-1', 'ent-1', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: true,
      })
      expect(result).toBeDefined()
      const unionSql = executedSqls.find((s) => s.includes('UNION ALL'))
      expect(unionSql).toBeDefined()
      // Invoices union adds the fiscal_type filter
      expect(unionSql!).toContain("COALESCE(i.fiscal_type,'fiscal')")
    })

    it('non-Luna user requesting Luna throws 404 (leak defense)', async () => {
      await expect(
        service.getDetalle('company-1', 'ent-1', {
          fiscal_type: 'no_fiscal',
          userCanAccessLuna: false,
        })
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('Sol request filters invoices by fiscal_type=fiscal', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes("FROM invoices i"))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("COALESCE(i.fiscal_type,'fiscal') = $")
    })

    it('Luna request excludes purchase_invoices (AND FALSE gate)', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes('FROM purchase_invoices pi'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain('AND FALSE')
    })

    it('Luna request excludes pagos (AND FALSE gate)', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes('FROM pagos p'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain('AND FALSE')
    })

    it('Luna request excludes retenciones sufridas and practicadas', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      const sufridaSql = executedSqls.find((s) => s.includes("'retencion_sufrida'"))
      const practicadaSql = executedSqls.find((s) => s.includes("'retencion_practicada'"))
      expect(sufridaSql).toBeDefined()
      expect(sufridaSql!).toContain('AND FALSE')
      expect(practicadaSql).toBeDefined()
      expect(practicadaSql!).toContain('AND FALSE')
    })

    it('account_adjustments filtered by fiscal_type', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes('FROM account_adjustments aa'))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain("COALESCE(aa.fiscal_type,'fiscal') = $")
    })

    it('opening balance query is built independently per circuit (dateFrom)', async () => {
      await service.getDetalle('company-1', 'ent-1', {
        fiscal_type: 'fiscal',
        userCanAccessLuna: true,
        dateFrom: '2025-06-01',
      })
      // Two main SQL executions should have happened: opening + main.
      const unionCount = executedSqls.filter((s) => s.includes("COALESCE(i.fiscal_type,'fiscal')")).length
      expect(unionCount).toBeGreaterThanOrEqual(2)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getPdfData
  // ────────────────────────────────────────────────────────────────

  describe('getPdfData — circuit banner and filters', () => {
    it('Sol PDF data includes circuit=fiscal', async () => {
      const data = await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
        fiscal_type: 'fiscal',
        userCanAccessLuna: true,
      })
      expect(data.circuit).toBe('fiscal')
    })

    it('Luna PDF data includes circuit=no_fiscal', async () => {
      const data = await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: true,
      })
      expect(data.circuit).toBe('no_fiscal')
    })

    it('Luna PDF by non-Luna user throws 404', async () => {
      await expect(
        service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
          fiscal_type: 'no_fiscal',
          userCanAccessLuna: false,
        })
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('Sol PDF filters invoices by fiscal_type in SQL', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
        fiscal_type: 'fiscal',
        userCanAccessLuna: true,
      })
      const sql = executedSqls.find((s) => s.includes("'factura' as tipo"))
      expect(sql).toBeDefined()
      expect(sql!).toContain("COALESCE(i.fiscal_type,'fiscal')")
    })

    it('Luna PDF excludes purchase_invoices via AND FALSE', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: true,
      })
      const sql = executedSqls.find((s) => s.includes("'factura_compra' as tipo"))
      expect(sql).toBeDefined()
      expect(sql!).toContain('FALSE')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // createAdjustment
  // ────────────────────────────────────────────────────────────────

  describe('createAdjustment — fiscal_type required and validated', () => {
    beforeEach(() => {
      mockDbExecute.mockImplementation((tpl: any) => {
        const sqlStr = flattenSql(tpl)
        executedSqls.push(sqlStr)
        if (sqlStr.includes('FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1' }] })
        }
        if (sqlStr.includes('INSERT INTO account_adjustments')) {
          return Promise.resolve({ rows: [{ id: 'adj-1', fiscal_type: 'fiscal' }] })
        }
        return Promise.resolve({ rows: [] })
      })
    })

    it('inserts fiscal_type column in SQL', async () => {
      await service.createAdjustment('c-1', 'ent-1', {
        amount: 100,
        reason: 'test',
        adjustment_type: 'debit',
        fiscal_type: 'fiscal',
        userCanAccessLuna: true,
      })
      const insertSql = executedSqls.find((s) => s.includes('INSERT INTO account_adjustments'))
      expect(insertSql).toBeDefined()
      expect(insertSql!).toContain('fiscal_type')
    })

    it('non-Luna user creating Luna adjustment throws 403', async () => {
      await expect(
        service.createAdjustment('c-1', 'ent-1', {
          amount: 100,
          reason: 'test',
          adjustment_type: 'debit',
          fiscal_type: 'no_fiscal',
          userCanAccessLuna: false,
        })
      ).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  // ────────────────────────────────────────────────────────────────
  // NCs (Notas de Credito) en CC — nuevo semantic (issue: NC anula factura).
  // ────────────────────────────────────────────────────────────────

  describe('getResumen — NCs reducen saldo del cliente', () => {
    function primeRow(row: Record<string, any>) {
      (service as any).__resumenRow = [row]
    }

    it('T-NC1: Sol invoice + Sol NC → saldo_sol = ventas - ncs', async () => {
      primeRow(makeResumenRow({
        total_ventas_sol: '10000',
        total_ncs_sol: '3000',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_sol).toBe(7000)
    })

    it('T-NC2: Luna invoice + Luna NC → saldo_luna = ventas - ncs', async () => {
      primeRow(makeResumenRow({
        total_ventas_luna: '8000',
        total_ncs_luna: '1500',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_luna).toBe(6500)
    })

    it('total_ncs is exposed in output and reduces legacy saldo', async () => {
      primeRow(makeResumenRow({
        total_ventas: '5000',
        total_ncs: '2000',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].total_ncs).toBe(2000)
      // balanceReal = ventas - totalCobros - retSufridas - ajCredit - ncs - (compras - ...) = 5000 - 2000 = 3000
      expect(result[0].saldo).toBe(3000)
    })

    it('SQL aggregates total_ncs_sol and total_ncs_luna in main query', async () => {
      await service.getResumen('company-1', { userCanAccessLuna: true })
      const sqlStr = executedSqls.find((s) => s.includes('FROM enterprises') && s.includes('total_ncs_sol'))
      expect(sqlStr).toBeDefined()
      expect(sqlStr!).toContain('total_ncs_sol')
      expect(sqlStr!).toContain('total_ncs_luna')
      // Critical: NC subquery MUST include `LIKE 'NC%'` (not NOT LIKE).
      const ncsSection = sqlStr!.substring(sqlStr!.indexOf('total_ncs_sol') - 500, sqlStr!.indexOf('total_ncs_sol'))
      expect(ncsSection).toContain("LIKE 'NC%'")
    })

    it('T-NC6: NCs with status draft/cancelled are excluded (status NOT IN filter)', async () => {
      await service.getResumen('company-1', { userCanAccessLuna: true })
      const sqlStr = executedSqls.find((s) => s.includes('total_ncs_sol'))
      expect(sqlStr).toBeDefined()
      // The NC subquery must reuse the same status filter as regular invoices.
      const ncsStart = sqlStr!.indexOf('total_ncs_sol')
      const ncsBlock = sqlStr!.substring(Math.max(0, ncsStart - 400), ncsStart)
      expect(ncsBlock).toContain("status NOT IN ('cancelled', 'draft')")
    })

    it('NC only applies to its own circuit (Sol NC does NOT reduce Luna saldo)', async () => {
      primeRow(makeResumenRow({
        total_ventas_sol: '10000',
        total_ventas_luna: '10000',
        total_ncs_sol: '4000',
        total_ncs_luna: '0',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].saldo_sol).toBe(6000)
      expect(result[0].saldo_luna).toBe(10000)
    })
  })

  describe('getDetalle — NC movements in UNION', () => {
    it('T-NC3: Sol getDetalle UNION includes nc_venta branch with haber > 0', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes("'nc_venta' as tipo"))
      expect(unionSql).toBeDefined()
      // Haber column populated from total_amount, debe is 0.
      expect(unionSql!).toContain("'nc_venta' as tipo")
      expect(unionSql!).toContain("CAST(i.total_amount AS decimal) as haber")
      // Must filter by status (emitidas only) and invoice_type LIKE 'NC%'
      expect(unionSql!).toContain("status NOT IN ('cancelled', 'draft')")
      expect(unionSql!).toContain("invoice_type::text LIKE 'NC%'")
    })

    it('T-NC3b: NC branch filters by fiscal_type (circuit isolation)', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes("'nc_venta' as tipo"))
      expect(unionSql).toBeDefined()
      // Every branch should apply the circuit param.
      expect(unionSql!).toMatch(/COALESCE\(i\.fiscal_type,'fiscal'\) = \$/)
    })

    it('T-NC4: Luna getDetalle excludes Sol NCs via fiscal_type param binding', async () => {
      // circuit='no_fiscal' is passed as last param; the UNION uses fiscalFilter(alias)
      // which applies to the NC branch as well.
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'no_fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes("'nc_venta' as tipo"))
      expect(unionSql).toBeDefined()
      // The $circuit param is bound and applied to all fiscal_type filters.
      expect(unionSql!).toContain("COALESCE(i.fiscal_type,'fiscal') = $")
    })

    it('NC branch LEFT JOINs related invoice to compose descripcion', async () => {
      await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'fiscal', userCanAccessLuna: true })
      const unionSql = executedSqls.find((s) => s.includes("'nc_venta' as tipo"))
      expect(unionSql).toBeDefined()
      expect(unionSql!).toContain('LEFT JOIN invoices ri ON ri.id = i.related_invoice_id')
    })
  })

  describe('getDetalle — running balance with NC (T-NC5)', () => {
    it('T-NC5: running balance correctly decreases on NC row', async () => {
      // Simulate 1 factura (debe=10000) + 1 NC (haber=3000) returned by pool.query.
      mockPoolQuery.mockImplementation((sqlStr: string) => {
        executedSqls.push(sqlStr)
        if (sqlStr.includes('FROM enterprises WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'ent-1', name: 'Test', cuit: '20-12345678-9' }] })
        }
        if (sqlStr.includes('SELECT * FROM') && sqlStr.includes('movimientos')) {
          return Promise.resolve({
            rows: [
              {
                fecha: '2025-06-01',
                tipo: 'fact_venta',
                nro_comprobante: 'A 00001',
                debe: '10000',
                haber: '0',
                descripcion: 'Factura A 00001',
                reference_id: 'inv-1',
              },
              {
                fecha: '2025-06-15',
                tipo: 'nc_venta',
                nro_comprobante: 'NC_A 00001',
                debe: '0',
                haber: '3000',
                descripcion: 'NC NC_A 00001',
                reference_id: 'nc-1',
              },
            ],
          })
        }
        return Promise.resolve({ rows: [] })
      })

      const result = await service.getDetalle('company-1', 'ent-1', { fiscal_type: 'fiscal', userCanAccessLuna: true })
      expect(result.movimientos).toHaveLength(2)
      expect(result.movimientos[0].saldo).toBe(10000)
      expect(result.movimientos[1].saldo).toBe(7000)
      expect(result.totales.saldo).toBe(7000)
    })
  })

  describe('getPdfData — NC movements (T-NC7)', () => {
    it('T-NC7: PDF data includes nc_venta query', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
        fiscal_type: 'fiscal',
        userCanAccessLuna: true,
      })
      const ncSql = executedSqls.find((s) => s.includes("'nc_venta' as tipo"))
      expect(ncSql).toBeDefined()
      expect(ncSql!).toContain("status NOT IN ('cancelled', 'draft')")
      expect(ncSql!).toContain("invoice_type::text LIKE 'NC%'")
      expect(ncSql!).toContain("COALESCE(i.fiscal_type,'fiscal') =")
    })

    it('Luna PDF fetches NCs with circuit=no_fiscal', async () => {
      await service.getPdfData('company-1', 'ent-1', '2025-01-01', '2025-12-31', {
        fiscal_type: 'no_fiscal',
        userCanAccessLuna: true,
      })
      const ncSql = executedSqls.find((s) => s.includes("'nc_venta' as tipo"))
      expect(ncSql).toBeDefined()
      // The circuit param in the prepared statement should be 'no_fiscal'.
      // Since drizzle tagged template renders values separately, look at the mock tpl object:
      expect(ncSql!).toContain('no_fiscal')
    })
  })

  // T-NC8: regression — existing shape/gating still holds with NC columns present.
  describe('T-NC8: regression — non-NC scenarios unchanged', () => {
    function primeRow(row: Record<string, any>) {
      (service as any).__resumenRow = [row]
    }

    it('saldo_sol with no NCs matches legacy formula', async () => {
      primeRow(makeResumenRow({
        total_ventas_sol: '5000',
        total_cobros_aplicados_sol: '1500',
        total_retenciones_sufridas_sol: '500',
      }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      // 5000 - 1500 - 500 - 0 (no NCs) = 3000
      expect(result[0].saldo_sol).toBe(3000)
    })

    it('enterprise with no NCs exposes total_ncs=0 in output', async () => {
      primeRow(makeResumenRow({ total_ventas: '1000' }))
      const result = await service.getResumen('company-1', { userCanAccessLuna: true })
      expect(result[0].total_ncs).toBe(0)
      expect(result[0].total_ncs_sol).toBe(0)
      expect(result[0].total_ncs_luna).toBe(0)
    })
  })
})
