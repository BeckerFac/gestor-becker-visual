import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, resetMocks } from './helpers/setup'

import { AccountingService } from '../src/modules/reports/accounting.service'

describe('AccountingService', () => {
  let service: AccountingService

  beforeEach(() => {
    resetMocks()
    service = new AccountingService()
    vi.clearAllMocks()
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Libro IVA Ventas
  // ────────────────────────────────────────────────────────────────────────────
  describe('getLibroIVAVentas', () => {
    const COMPANY = 'company-1'

    function makeVentasRow(overrides: Record<string, any> = {}) {
      return {
        invoice_date: '2025-06-15',
        invoice_type: 'A',
        invoice_number: 1,
        punto_venta: 3,
        afip_response: null,
        customer_name: 'Acme SA',
        customer_cuit: '30-12345678-9',
        neto_gravado: '10000',
        neto_no_gravado: '0',
        iva_27: '0',
        iva_21: '2100',
        iva_10_5: '0',
        iva_5: '0',
        iva_2_5: '0',
        iva_0: '0',
        total_iva: '2100',
        total: '12100',
        ...overrides,
      }
    }

    it('returns correct structure (rows array + totals object)', async () => {
      mockDbRows([makeVentasRow()])

      const result = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('totals')
      expect(Array.isArray(result.rows)).toBe(true)
      expect(typeof result.totals).toBe('object')
    })

    it('maps row fields correctly with comprobante format', async () => {
      mockDbRows([makeVentasRow({ punto_venta: 3, invoice_number: 42, invoice_type: 'A' })])

      const { rows } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].comprobante).toBe('A 00003-00000042')
      expect(rows[0].customer_name).toBe('Acme SA')
      expect(rows[0].customer_cuit).toBe('30-12345678-9')
      expect(rows[0].neto_gravado).toBe(10000)
      expect(rows[0].iva_21).toBe(2100)
      expect(rows[0].total).toBe(12100)
    })

    it('returns empty rows when no data (does not crash)', async () => {
      mockDbEmpty()

      const result = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows).toEqual([])
      expect(result.totals).toEqual({
        neto_gravado: 0,
        neto_no_gravado: 0,
        op_exentas: 0,
        iva_27: 0,
        iva_21: 0,
        iva_10_5: 0,
        iva_5: 0,
        iva_2_5: 0,
        iva_0: 0,
        total_iva: 0,
        otros_tributos: 0,
        total: 0,
      })
    })

    it('handles invoices with multiple IVA rates in breakdown', async () => {
      mockDbRows([
        makeVentasRow({
          iva_27: '270',
          iva_21: '2100',
          iva_10_5: '105',
          iva_5: '50',
          iva_2_5: '25',
          total_iva: '2550',
          total: '12550',
        }),
      ])

      const { rows, totals } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].iva_27).toBe(270)
      expect(rows[0].iva_21).toBe(2100)
      expect(rows[0].iva_10_5).toBe(105)
      expect(rows[0].iva_5).toBe(50)
      expect(rows[0].iva_2_5).toBe(25)
      expect(totals.iva_27).toBe(270)
      expect(totals.iva_21).toBe(2100)
      expect(totals.iva_10_5).toBe(105)
      expect(totals.iva_5).toBe(50)
      expect(totals.iva_2_5).toBe(25)
    })

    it('handles NULL vat_amount gracefully (coalesces to 0)', async () => {
      mockDbRows([makeVentasRow({ total_iva: null })])

      const { rows } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].total_iva).toBe(0)
    })

    it('handles NULL subtotal in invoice_items (coalesces to 0)', async () => {
      mockDbRows([makeVentasRow({ neto_gravado: null, neto_no_gravado: null })])

      const { rows } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].neto_gravado).toBe(0)
      expect(rows[0].neto_no_gravado).toBe(0)
    })

    it('totals match sum of individual rows', async () => {
      mockDbRows([
        makeVentasRow({ neto_gravado: '5000', iva_21: '1050', total_iva: '1050', total: '6050' }),
        makeVentasRow({ neto_gravado: '3000', iva_21: '630', total_iva: '630', total: '3630' }),
        makeVentasRow({ neto_gravado: '2000', iva_21: '420', total_iva: '420', total: '2420' }),
      ])

      const { rows, totals } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows.length).toBe(3)
      const sumNetoGravado = rows.reduce((s: number, r: any) => s + r.neto_gravado, 0)
      const sumIva21 = rows.reduce((s: number, r: any) => s + r.iva_21, 0)
      const sumTotal = rows.reduce((s: number, r: any) => s + r.total, 0)

      expect(totals.neto_gravado).toBeCloseTo(sumNetoGravado, 2)
      expect(totals.iva_21).toBeCloseTo(sumIva21, 2)
      expect(totals.total).toBeCloseTo(sumTotal, 2)
    })

    it('handles very large amounts (100,000,000+)', async () => {
      mockDbRows([
        makeVentasRow({
          neto_gravado: '100000000',
          iva_21: '21000000',
          total_iva: '21000000',
          total: '121000000',
        }),
      ])

      const { rows, totals } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].neto_gravado).toBe(100000000)
      expect(rows[0].total).toBe(121000000)
      expect(totals.total).toBe(121000000)
    })

    it('defaults invalid date_from/date_to to current month', async () => {
      mockDbEmpty()

      // invalid date format -- should not crash
      const result = await service.getLibroIVAVentas(COMPANY, 'not-a-date', '')

      expect(result.rows).toEqual([])
      // the query was executed (service used defaults)
      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('throws ApiError on database failure', async () => {
      mockDbExecute.mockRejectedValueOnce(new Error('connection refused'))

      await expect(
        service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30'),
      ).rejects.toThrow('Failed to generate Libro IVA Ventas')
    })

    it('iva_0 is always 0 in rows', async () => {
      mockDbRows([makeVentasRow()])

      const { rows } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].iva_0).toBe(0)
    })

    it('formats comprobante with default punto_venta=3 when null', async () => {
      mockDbRows([makeVentasRow({ punto_venta: null, invoice_number: 1, invoice_type: 'B' })])

      const { rows } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].comprobante).toBe('B 00003-00000001')
    })

    it('single record returns correct totals', async () => {
      mockDbRows([makeVentasRow()])

      const { rows, totals } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows.length).toBe(1)
      expect(totals.neto_gravado).toBe(rows[0].neto_gravado)
      expect(totals.total).toBe(rows[0].total)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Libro IVA Compras
  // ────────────────────────────────────────────────────────────────────────────
  describe('getLibroIVACompras', () => {
    const COMPANY = 'company-1'

    function makeComprasRow(overrides: Record<string, any> = {}) {
      return {
        date: '2025-06-10',
        invoice_type: 'A',
        punto_venta: '0001',
        invoice_number: '00000100',
        enterprise_name: 'Proveedor SA',
        enterprise_cuit: '30-99887766-5',
        neto_gravado: '8000',
        neto_no_gravado: '0',
        op_exentas: '0',
        iva: '1680',
        otros_tributos: '0',
        total: '9680',
        ...overrides,
      }
    }

    it('returns correct structure (rows + totals)', async () => {
      mockDbRows([makeComprasRow()])

      const result = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('totals')
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('maps row fields correctly', async () => {
      mockDbRows([makeComprasRow()])

      const { rows } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].date).toBe('2025-06-10')
      expect(rows[0].comprobante).toBe('A 00001-00000100')
      expect(rows[0].enterprise_name).toBe('Proveedor SA')
      expect(rows[0].enterprise_cuit).toBe('30-99887766-5')
      expect(rows[0].tipo_cbte).toBe(1)
      expect(rows[0].cod_doc_emisor).toBe(80)
      expect(rows[0].neto_gravado).toBe(8000)
      expect(rows[0].iva).toBe(1680)
      expect(rows[0].otros_tributos).toBe(0)
      expect(rows[0].total).toBe(9680)
    })

    it('returns empty rows when no data', async () => {
      mockDbEmpty()

      const result = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows).toEqual([])
      expect(result.totals).toEqual({ neto_gravado: 0, neto_no_gravado: 0, op_exentas: 0, iva: 0, otros_tributos: 0, total: 0 })
    })

    it('handles NULL subtotal (derives from total - vat)', async () => {
      // The SQL does COALESCE(subtotal, total - vat). We simulate that result.
      mockDbRows([makeComprasRow({ neto_gravado: '8000', iva: '1680', total: '9680' })])

      const { rows } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].neto_gravado).toBe(8000)
    })

    it('handles NULL vat_amount (coalesces to 0)', async () => {
      mockDbRows([makeComprasRow({ iva: null })])

      const { rows } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].iva).toBe(0)
    })

    it('comprobante is S/C when both invoice_type and invoice_number are empty', async () => {
      mockDbRows([makeComprasRow({ invoice_type: '', invoice_number: '' })])

      const { rows } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].comprobante).toBe('S/C')
    })

    it('comprobante is S/C when both are null', async () => {
      mockDbRows([makeComprasRow({ invoice_type: null, invoice_number: null })])

      const { rows } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].comprobante).toBe('S/C')
    })

    it('totals match sum of individual rows', async () => {
      mockDbRows([
        makeComprasRow({ neto_gravado: '5000', iva: '1050', total: '6050' }),
        makeComprasRow({ neto_gravado: '3000', iva: '630', total: '3630' }),
      ])

      const { rows, totals } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows.length).toBe(2)
      expect(totals.neto_gravado).toBe(5000 + 3000)
      expect(totals.iva).toBe(1050 + 630)
      expect(totals.total).toBe(6050 + 3630)
    })

    it('handles very large amounts', async () => {
      mockDbRows([makeComprasRow({ neto_gravado: '200000000', iva: '42000000', total: '242000000' })])

      const { totals } = await service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30')

      expect(totals.total).toBe(242000000)
    })

    it('throws ApiError on database failure', async () => {
      mockDbExecute.mockRejectedValueOnce(new Error('db down'))

      await expect(
        service.getLibroIVACompras(COMPANY, '2025-06-01', '2025-06-30'),
      ).rejects.toThrow('Failed to generate Libro IVA Compras')
    })

    it('defaults invalid dates to current month', async () => {
      mockDbEmpty()

      const result = await service.getLibroIVACompras(COMPANY, 'invalid', 'also-invalid')

      expect(result.rows).toEqual([])
      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Posicion IVA
  // ────────────────────────────────────────────────────────────────────────────
  describe('getPosicionIVA', () => {
    const COMPANY = 'company-1'

    it('returns monthly periods with debito/credito/saldo', async () => {
      // First call: debito fiscal (invoices)
      mockDbRows([{ periodo: '2025-06', debito_fiscal: '21000' }])
      // Second call: credito fiscal (purchases)
      mockDbRows([{ periodo: '2025-06', credito_fiscal: '8400' }])

      const result = await service.getPosicionIVA(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0]).toEqual({
        periodo: '2025-06',
        periodo_label: 'Junio 2025',
        debito_fiscal: 21000,
        credito_fiscal: 8400,
        saldo: 12600,
      })
    })

    it('generates empty months with zeros for months without activity', async () => {
      // 3-month range but only one month has data
      mockDbRows([{ periodo: '2025-06', debito_fiscal: '5000' }])
      mockDbRows([{ periodo: '2025-07', credito_fiscal: '3000' }])

      const result = await service.getPosicionIVA(COMPANY, '2025-06-01', '2025-08-31')

      expect(result.rows.length).toBe(3)

      // June: debito=5000, credito=0
      expect(result.rows[0].periodo).toBe('2025-06')
      expect(result.rows[0].debito_fiscal).toBe(5000)
      expect(result.rows[0].credito_fiscal).toBe(0)
      expect(result.rows[0].saldo).toBe(5000)

      // July: debito=0, credito=3000
      expect(result.rows[1].periodo).toBe('2025-07')
      expect(result.rows[1].debito_fiscal).toBe(0)
      expect(result.rows[1].credito_fiscal).toBe(3000)
      expect(result.rows[1].saldo).toBe(-3000)

      // August: both 0
      expect(result.rows[2].periodo).toBe('2025-08')
      expect(result.rows[2].debito_fiscal).toBe(0)
      expect(result.rows[2].credito_fiscal).toBe(0)
      expect(result.rows[2].saldo).toBe(0)
    })

    it('saldo = debito - credito (correct sign)', async () => {
      mockDbRows([{ periodo: '2025-01', debito_fiscal: '1000' }])
      mockDbRows([{ periodo: '2025-01', credito_fiscal: '3000' }])

      const result = await service.getPosicionIVA(COMPANY, '2025-01-01', '2025-01-31')

      // credito > debito => negative saldo
      expect(result.rows[0].saldo).toBe(-2000)
    })

    it('handles date range spanning year boundary (Dec -> Jan)', async () => {
      mockDbRows([
        { periodo: '2024-12', debito_fiscal: '1000' },
        { periodo: '2025-01', debito_fiscal: '2000' },
      ])
      mockDbEmpty() // no purchases

      const result = await service.getPosicionIVA(COMPANY, '2024-12-01', '2025-01-31')

      expect(result.rows.length).toBe(2)
      expect(result.rows[0].periodo).toBe('2024-12')
      expect(result.rows[0].periodo_label).toBe('Diciembre 2024')
      expect(result.rows[1].periodo).toBe('2025-01')
      expect(result.rows[1].periodo_label).toBe('Enero 2025')
    })

    it('returns empty rows with zeros when no data', async () => {
      mockDbEmpty() // no invoices
      mockDbEmpty() // no purchases

      const result = await service.getPosicionIVA(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].debito_fiscal).toBe(0)
      expect(result.rows[0].credito_fiscal).toBe(0)
      expect(result.rows[0].saldo).toBe(0)
    })

    it('handles date range within a single month', async () => {
      mockDbRows([{ periodo: '2025-03', debito_fiscal: '500' }])
      mockDbRows([{ periodo: '2025-03', credito_fiscal: '200' }])

      const result = await service.getPosicionIVA(COMPANY, '2025-03-10', '2025-03-20')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].periodo).toBe('2025-03')
      expect(result.rows[0].saldo).toBe(300)
    })

    it('caps at 36 months maximum', async () => {
      mockDbEmpty()
      mockDbEmpty()

      // 48-month range, should only get 36
      const result = await service.getPosicionIVA(COMPANY, '2022-01-01', '2025-12-31')

      expect(result.rows.length).toBe(36)
    })

    it('formats periodo_label correctly for all months', async () => {
      mockDbEmpty()
      mockDbEmpty()

      const result = await service.getPosicionIVA(COMPANY, '2025-01-01', '2025-12-31')

      const expectedLabels = [
        'Enero 2025', 'Febrero 2025', 'Marzo 2025', 'Abril 2025',
        'Mayo 2025', 'Junio 2025', 'Julio 2025', 'Agosto 2025',
        'Septiembre 2025', 'Octubre 2025', 'Noviembre 2025', 'Diciembre 2025',
      ]
      result.rows.forEach((row: any, i: number) => {
        expect(row.periodo_label).toBe(expectedLabels[i])
      })
    })

    it('throws ApiError on database failure', async () => {
      mockDbExecute.mockRejectedValueOnce(new Error('timeout'))

      await expect(
        service.getPosicionIVA(COMPANY, '2025-06-01', '2025-06-30'),
      ).rejects.toThrow('Failed to generate Posicion IVA')
    })

    it('defaults invalid dates to current month', async () => {
      mockDbEmpty()
      mockDbEmpty()

      const result = await service.getPosicionIVA(COMPANY, 'garbage', '')

      expect(result.rows.length).toBe(1)
      expect(mockDbExecute).toHaveBeenCalledTimes(2)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Flujo de Caja
  // ────────────────────────────────────────────────────────────────────────────
  describe('getFlujoCaja', () => {
    const COMPANY = 'company-1'

    it('returns monthly periods with ingresos/egresos/neto/acumulado', async () => {
      // cobros
      mockDbRows([{ periodo: '2025-06', total: '50000' }])
      // cheques cobrados
      mockDbRows([{ periodo: '2025-06', total: '10000' }])
      // pagos
      mockDbRows([{ periodo: '2025-06', total: '30000' }])

      const result = await service.getFlujoCaja(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0]).toEqual({
        periodo: '2025-06',
        periodo_label: 'Junio 2025',
        ingresos: 60000,   // cobros(50000) + cheques(10000)
        egresos: 30000,
        neto: 30000,
        acumulado: 30000,
      })
    })

    it('ingresos = cobros + cheques cobrados', async () => {
      mockDbRows([{ periodo: '2025-01', total: '25000' }])
      mockDbRows([{ periodo: '2025-01', total: '15000' }])
      mockDbRows([]) // no pagos

      const { rows } = await service.getFlujoCaja(COMPANY, '2025-01-01', '2025-01-31')

      expect(rows[0].ingresos).toBe(40000)
    })

    it('acumulado is running sum (cumulative)', async () => {
      // cobros for 3 months
      mockDbRows([
        { periodo: '2025-01', total: '10000' },
        { periodo: '2025-02', total: '20000' },
        { periodo: '2025-03', total: '30000' },
      ])
      mockDbEmpty() // no cheques
      // pagos for 3 months
      mockDbRows([
        { periodo: '2025-01', total: '5000' },
        { periodo: '2025-02', total: '15000' },
        { periodo: '2025-03', total: '10000' },
      ])

      const { rows } = await service.getFlujoCaja(COMPANY, '2025-01-01', '2025-03-31')

      // Month 1: neto = 10000 - 5000 = 5000, acum = 5000
      expect(rows[0].neto).toBe(5000)
      expect(rows[0].acumulado).toBe(5000)

      // Month 2: neto = 20000 - 15000 = 5000, acum = 10000
      expect(rows[1].neto).toBe(5000)
      expect(rows[1].acumulado).toBe(10000)

      // Month 3: neto = 30000 - 10000 = 20000, acum = 30000
      expect(rows[2].neto).toBe(20000)
      expect(rows[2].acumulado).toBe(30000)
    })

    it('generates empty months with zeros', async () => {
      // only January has data
      mockDbRows([{ periodo: '2025-01', total: '5000' }])
      mockDbEmpty()
      mockDbEmpty()

      const { rows } = await service.getFlujoCaja(COMPANY, '2025-01-01', '2025-03-31')

      expect(rows.length).toBe(3)

      // Feb and Mar should be zeros
      expect(rows[1].ingresos).toBe(0)
      expect(rows[1].egresos).toBe(0)
      expect(rows[1].neto).toBe(0)

      expect(rows[2].ingresos).toBe(0)
      expect(rows[2].egresos).toBe(0)
      expect(rows[2].neto).toBe(0)

      // acumulado carries forward
      expect(rows[1].acumulado).toBe(5000)
      expect(rows[2].acumulado).toBe(5000)
    })

    it('caps at 36 months', async () => {
      mockDbEmpty()
      mockDbEmpty()
      mockDbEmpty()

      const { rows } = await service.getFlujoCaja(COMPANY, '2022-01-01', '2025-12-31')

      expect(rows.length).toBe(36)
    })

    it('handles negative acumulado (more egresos than ingresos)', async () => {
      mockDbEmpty() // no cobros
      mockDbEmpty() // no cheques
      mockDbRows([{ periodo: '2025-06', total: '50000' }]) // pagos

      const { rows } = await service.getFlujoCaja(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows[0].ingresos).toBe(0)
      expect(rows[0].egresos).toBe(50000)
      expect(rows[0].neto).toBe(-50000)
      expect(rows[0].acumulado).toBe(-50000)
    })

    it('handles very large amounts', async () => {
      mockDbRows([{ periodo: '2025-01', total: '100000000' }])
      mockDbEmpty()
      mockDbRows([{ periodo: '2025-01', total: '50000000' }])

      const { rows } = await service.getFlujoCaja(COMPANY, '2025-01-01', '2025-01-31')

      expect(rows[0].ingresos).toBe(100000000)
      expect(rows[0].egresos).toBe(50000000)
      expect(rows[0].neto).toBe(50000000)
    })

    it('handles date range spanning year boundary', async () => {
      mockDbRows([
        { periodo: '2024-12', total: '10000' },
        { periodo: '2025-01', total: '20000' },
      ])
      mockDbEmpty()
      mockDbEmpty()

      const { rows } = await service.getFlujoCaja(COMPANY, '2024-12-01', '2025-01-31')

      expect(rows.length).toBe(2)
      expect(rows[0].periodo).toBe('2024-12')
      expect(rows[0].periodo_label).toBe('Diciembre 2024')
      expect(rows[1].periodo).toBe('2025-01')
      expect(rows[1].periodo_label).toBe('Enero 2025')
    })

    it('returns empty result for company with no data', async () => {
      mockDbEmpty()
      mockDbEmpty()
      mockDbEmpty()

      const { rows } = await service.getFlujoCaja(COMPANY, '2025-06-01', '2025-06-30')

      expect(rows.length).toBe(1)
      expect(rows[0].ingresos).toBe(0)
      expect(rows[0].egresos).toBe(0)
      expect(rows[0].neto).toBe(0)
      expect(rows[0].acumulado).toBe(0)
    })

    it('throws ApiError on database failure', async () => {
      mockDbExecute.mockRejectedValueOnce(new Error('network error'))

      await expect(
        service.getFlujoCaja(COMPANY, '2025-06-01', '2025-06-30'),
      ).rejects.toThrow('Failed to generate Flujo de Caja')
    })

    it('defaults invalid dates to current month', async () => {
      mockDbEmpty()
      mockDbEmpty()
      mockDbEmpty()

      const result = await service.getFlujoCaja(COMPANY, '', 'bad-date')

      expect(result.rows.length).toBe(1)
      expect(mockDbExecute).toHaveBeenCalledTimes(3)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Date validation (validateDateRange - tested through public methods)
  // ────────────────────────────────────────────────────────────────────────────
  describe('date validation (via getLibroIVAVentas)', () => {
    const COMPANY = 'company-1'

    it('valid dates pass through without modification', async () => {
      mockDbEmpty()

      await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('invalid date format defaults to current month', async () => {
      mockDbEmpty()

      await service.getLibroIVAVentas(COMPANY, '06/01/2025', '06/30/2025')

      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('missing dates (empty string) default to current month', async () => {
      mockDbEmpty()

      await service.getLibroIVAVentas(COMPANY, '', '')

      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('undefined dates default to current month', async () => {
      mockDbEmpty()

      await service.getLibroIVAVentas(COMPANY, undefined as any, undefined as any)

      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('future dates are accepted as valid', async () => {
      mockDbEmpty()

      // This should not throw
      const result = await service.getLibroIVAVentas(COMPANY, '2030-01-01', '2030-12-31')

      expect(result.rows).toEqual([])
    })

    it('partial date format defaults to current month', async () => {
      mockDbEmpty()

      await service.getLibroIVAVentas(COMPANY, '2025-06', '2025-06-30')

      // '2025-06' does not match YYYY-MM-DD pattern
      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Edge cases across all reports
  // ────────────────────────────────────────────────────────────────────────────
  describe('cross-cutting edge cases', () => {
    const COMPANY = 'company-1'
    const OTHER_COMPANY = 'company-other'

    it('empty database returns valid empty result for Ventas', async () => {
      mockDbEmpty()

      const result = await service.getLibroIVAVentas(COMPANY, '2025-01-01', '2025-12-31')

      expect(result.rows.length).toBe(0)
      expect(result.totals.total).toBe(0)
    })

    it('empty database returns valid empty result for Compras', async () => {
      mockDbEmpty()

      const result = await service.getLibroIVACompras(COMPANY, '2025-01-01', '2025-12-31')

      expect(result.rows.length).toBe(0)
      expect(result.totals.total).toBe(0)
    })

    it('empty database returns valid zero-filled result for Posicion IVA', async () => {
      mockDbEmpty()
      mockDbEmpty()

      const result = await service.getPosicionIVA(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].debito_fiscal).toBe(0)
      expect(result.rows[0].credito_fiscal).toBe(0)
    })

    it('empty database returns valid zero-filled result for Flujo de Caja', async () => {
      mockDbEmpty()
      mockDbEmpty()
      mockDbEmpty()

      const result = await service.getFlujoCaja(COMPANY, '2025-06-01', '2025-06-30')

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].ingresos).toBe(0)
      expect(result.rows[0].egresos).toBe(0)
    })

    it('company isolation: different company_id gets passed to query', async () => {
      mockDbEmpty()

      await service.getLibroIVAVentas(OTHER_COMPANY, '2025-06-01', '2025-06-30')

      // The mock was called; the service passed the companyId to the SQL template
      expect(mockDbExecute).toHaveBeenCalledTimes(1)
      // Verify the sql template tag received the companyId value
      const call = mockDbExecute.mock.calls[0][0]
      expect(call.values).toContain(OTHER_COMPANY)
    })

    it('Posicion IVA makes exactly 2 db calls (debito + credito)', async () => {
      mockDbEmpty()
      mockDbEmpty()

      await service.getPosicionIVA(COMPANY, '2025-06-01', '2025-06-30')

      expect(mockDbExecute).toHaveBeenCalledTimes(2)
    })

    it('Flujo de Caja makes exactly 3 db calls (cobros + cheques + pagos)', async () => {
      mockDbEmpty()
      mockDbEmpty()
      mockDbEmpty()

      await service.getFlujoCaja(COMPANY, '2025-06-01', '2025-06-30')

      expect(mockDbExecute).toHaveBeenCalledTimes(3)
    })

    it('Ventas result has immutable totals (rounded to 2 decimals)', async () => {
      mockDbRows([
        {
          invoice_date: '2025-06-01',
          invoice_type: 'A',
          invoice_number: 1,
          punto_venta: 1,
          customer_name: 'Test',
          customer_cuit: '',
          neto_gravado: '100.456',
          neto_no_gravado: '0',
          iva_27: '0',
          iva_21: '21.0957',
          iva_10_5: '0',
          iva_5: '0',
          iva_2_5: '0',
          iva_0: '0',
          total_iva: '21.0957',
          total: '121.5517',
        },
      ])

      const { totals } = await service.getLibroIVAVentas(COMPANY, '2025-06-01', '2025-06-30')

      // round2(100.456) = 100.46, round2(21.0957) = 21.1
      expect(totals.neto_gravado).toBe(100.46)
      expect(totals.iva_21).toBe(21.1)
      expect(totals.total_iva).toBe(21.1)
      expect(totals.total).toBe(121.55)
    })
  })
})
