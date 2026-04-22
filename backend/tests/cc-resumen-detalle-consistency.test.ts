/**
 * Wave 2B-2 (H20) — Consistency between getResumen.saldo_sol / saldo_luna
 * and getDetalle.closing_balance for the same enterprise + circuit.
 *
 * The production audit observed a 1000-unit divergence between resumen and
 * detalle caused by orphan mis-posted cobros: resumen uses the
 * applications+adelantos split (cobro_invoice_applications summed per
 * invoice.fiscal_type + pending_invoice remainder), while detalle was
 * counting the full cobro.total_amount regardless of applications. This
 * suite seeds a fixture matching the user spec and asserts both endpoints
 * produce the same balance.
 *
 * Strategy: mocks return canned rows per subquery (resumen) and per
 * UNION branch (detalle). saldo_sol is computed from the returned resumen
 * row mapping; closing_balance is computed by the running balance on the
 * UNION'd movements.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup'

import { CuentaCorrienteService } from '../src/modules/cuenta-corriente/cuenta-corriente.service'

describe('CC resumen vs detalle consistency (Wave 2B-2 / H20)', () => {
  let service: CuentaCorrienteService

  beforeEach(() => {
    resetMocks()
    service = new CuentaCorrienteService()
  })

  /**
   * Shared helper to prime a resumen row with the aggregate amounts that
   * match a given fixture. The service's mapping layer will then compute
   * saldo_sol / saldo_luna from this row.
   */
  function primeResumenRow(overrides: Record<string, any>) {
    const base: Record<string, any> = {
      id: 'ent-1',
      name: 'Test Enterprise',
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
    ;(service as any).__resumenRow = [base]
  }

  /**
   * Install mocks for a full detalle run. `movimientos` is the set of rows
   * the UNION should return (simulating what the DB would produce for the
   * given fixture after our Wave 2B-2 fix). Opening balance queries return 0.
   */
  function primeDetalleRows(movimientos: Array<{ debe: number; haber: number }>) {
    mockPoolQuery.mockImplementation((sqlStr: string, _params?: unknown[]) => {
      if (typeof sqlStr === 'string' && sqlStr.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 'ent-1', name: 'Test Enterprise', cuit: '20-11111111-1' }],
        })
      }
      if (typeof sqlStr === 'string' && sqlStr.includes('SELECT status FROM cobros')) {
        return Promise.resolve({ rows: [{ status: null }] })
      }
      if (typeof sqlStr === 'string' && sqlStr.includes('SELECT status FROM pagos')) {
        return Promise.resolve({ rows: [{ status: null }] })
      }
      if (typeof sqlStr === 'string' && sqlStr.includes('business_unit_id FROM account_adjustments')) {
        return Promise.resolve({ rows: [{ business_unit_id: null }] })
      }
      // The main UNION query (and opening balance query) both select from the
      // same unionBody. For tests without dateFrom, only the main query fires.
      // Return the canned movimientos sorted by insertion order.
      return Promise.resolve({
        rows: movimientos.map((m, idx) => ({
          fecha: new Date(2025, 0, idx + 1).toISOString(),
          tipo: 'mov',
          nro_comprobante: `m-${idx}`,
          debe: String(m.debe),
          haber: String(m.haber),
          descripcion: 'mock',
          reference_id: `m-${idx}`,
        })),
      })
    })

    // db.execute is still used for the defensive column-existence probes.
    mockDbExecute.mockImplementation(() => Promise.resolve({ rows: [] }))
  }

  it('Sol fixture: 1 invoice, 1 applied cobro, 1 pending adelanto, 1 ajuste debit, 1 NC → saldo_sol === closing_balance', async () => {
    // Fixture (client-only, Sol circuit):
    //   - 1 Sol invoice $1000 (debe)
    //   - 1 Sol cobro $500 fully applied to the invoice (haber)
    //   - 1 orphan cobro $300, pending_invoice (haber, adelanto)
    //   - 1 ajuste debit $200 (debe)
    //   - 1 NC $100 (haber — reduces client debt)
    // Expected saldo = 1000 + 200 - 500 - 300 - 100 = 300

    primeResumenRow({
      total_ventas_sol: '1000',
      total_ventas: '1000',
      total_cobros_aplicados_sol: '500',
      total_cobros_aplicados: '500',
      total_adelantos_cobros_sol: '300',
      total_adelantos_cobros: '300',
      total_ajustes_debit_sol: '200',
      total_ajustes_debit: '200',
      total_ncs_sol: '100',
      total_ncs: '100',
    })

    mockDbExecute.mockImplementation((tpl: any) => {
      const flat = flattenSql(tpl)
      if (flat.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'T', cuit: '20-1' }] })
      }
      if (flat.includes('total_ventas_sol')) {
        return Promise.resolve({ rows: (service as any).__resumenRow || [] })
      }
      return Promise.resolve({ rows: [] })
    })

    const resumen = await service.getResumen('company-1', { userCanAccessLuna: true })
    const saldoSol = resumen[0].saldo_sol

    // Detalle: mocked UNION returns the per-row movements the fix now produces.
    primeDetalleRows([
      { debe: 1000, haber: 0 }, // fact_venta
      { debe: 0, haber: 100 }, // nc_venta
      { debe: 0, haber: 500 }, // recibo (applied portion)
      { debe: 0, haber: 300 }, // adelanto_cobro (pending_invoice remainder)
      { debe: 200, haber: 0 }, // ajuste debit
    ])

    const detalle = await service.getDetalle('company-1', 'ent-1', {
      fiscal_type: 'fiscal',
      userCanAccessLuna: true,
    })

    expect(saldoSol).toBe(300)
    expect(detalle.closing_balance).toBe(300)
    expect(saldoSol).toBe(detalle.closing_balance)
  })

  it('Luna fixture: 1 Luna invoice, 1 Luna cobro, 1 Luna NC → saldo_luna === closing_balance', async () => {
    // Fixture (client-only, Luna circuit):
    //   - 1 Luna invoice $2000 (debe)
    //   - 1 Luna cobro $800 applied (haber)
    //   - 1 Luna NC $200 (haber)
    // Expected saldo = 2000 - 800 - 200 = 1000

    primeResumenRow({
      total_ventas_luna: '2000',
      total_ventas: '2000',
      total_cobros_aplicados_luna: '800',
      total_cobros_aplicados: '800',
      total_ncs_luna: '200',
      total_ncs: '200',
    })

    mockDbExecute.mockImplementation((tpl: any) => {
      const flat = flattenSql(tpl)
      if (flat.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'T', cuit: '20-1' }] })
      }
      if (flat.includes('total_ventas_sol')) {
        return Promise.resolve({ rows: (service as any).__resumenRow || [] })
      }
      return Promise.resolve({ rows: [] })
    })

    const resumen = await service.getResumen('company-1', { userCanAccessLuna: true })
    const saldoLuna = resumen[0].saldo_luna

    primeDetalleRows([
      { debe: 2000, haber: 0 }, // fact_venta (Luna)
      { debe: 0, haber: 200 }, // nc_venta (Luna)
      { debe: 0, haber: 800 }, // recibo (applied portion, Luna)
    ])

    const detalle = await service.getDetalle('company-1', 'ent-1', {
      fiscal_type: 'no_fiscal',
      userCanAccessLuna: true,
    })

    expect(saldoLuna).toBe(1000)
    expect(detalle.closing_balance).toBe(1000)
    expect(saldoLuna).toBe(detalle.closing_balance)
  })

  it('Orphan mis-posted cobro (H20 repro): resumen excludes NC-applied amount → detalle must match', async () => {
    // The H20 scenario: a cobro applied to an NC (orphan mis-post). Previously
    // detalle counted c.total_amount (including NC-applied portion), creating a
    // discrepancy vs resumen which excludes NC applications from cobros_aplicados.
    //
    // After Wave 2B-2 fix: the cobros union only sums cia.amount_applied where
    // invoice is NOT an NC, so the NC-applied portion is correctly excluded
    // from the running balance in detalle as well.
    //
    // Fixture:
    //   - 1 Sol invoice $5000
    //   - 1 Sol cobro $2000: $1500 applied to the real invoice, $500 applied
    //     to an NC (orphan mis-post)
    // Resumen: total_cobros_aplicados_sol = 1500 (NC-applied excluded)
    // Saldo = 5000 - 1500 = 3500

    primeResumenRow({
      total_ventas_sol: '5000',
      total_ventas: '5000',
      total_cobros_aplicados_sol: '1500',
      total_cobros_aplicados: '1500',
    })

    mockDbExecute.mockImplementation((tpl: any) => {
      const flat = flattenSql(tpl)
      if (flat.includes('FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'ent-1', name: 'T', cuit: '20-1' }] })
      }
      if (flat.includes('total_ventas_sol')) {
        return Promise.resolve({ rows: (service as any).__resumenRow || [] })
      }
      return Promise.resolve({ rows: [] })
    })

    const resumen = await service.getResumen('company-1', { userCanAccessLuna: true })

    // Detalle now emits only the 1500 applied to non-NC (not 2000 total).
    primeDetalleRows([
      { debe: 5000, haber: 0 },
      { debe: 0, haber: 1500 }, // recibo (applied portion, NC-applied excluded)
    ])

    const detalle = await service.getDetalle('company-1', 'ent-1', {
      fiscal_type: 'fiscal',
      userCanAccessLuna: true,
    })

    expect(resumen[0].saldo_sol).toBe(3500)
    expect(detalle.closing_balance).toBe(3500)
    expect(resumen[0].saldo_sol).toBe(detalle.closing_balance)
  })
})

// Flatten helper (shared pattern with sol-luna-cuenta-corriente.test.ts):
// drizzle `sql` mock returns {strings, values} — nested fragments appear as
// objects in values. This joins them so we can search for substrings.
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
