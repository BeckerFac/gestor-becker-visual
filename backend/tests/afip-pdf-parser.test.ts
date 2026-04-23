import { describe, it, expect } from 'vitest'
import { parseAfipInvoicePdfText } from '../src/modules/invoices/afip-pdf-parser'

// Sample from a real ARCA/AFIP "Factura A" PDF (template used by GRUPO BECKER
// S.R.L. — client 20369013603 / Factura 00002-00001852). The string below
// mirrors what `pdf-parse` produces from that PDF.
const SAMPLE_AFIP_A = `
ORIGINAL
GRUPO BECKER S.R.L.
Mitre 27 - Villa Martelli, Buenos Aires
Período Facturado Desde: Hasta: Fecha de Vto. para el pago:
CUIT:
Condición de venta:
Condición frente al IVA:
Apellido y Nombre / Razón Social:
Domicilio Comercial:
22/04/2026 22/04/2026 22/04/2026
Fecha de Emisión: 22/04/2026
30712854509
20369013603 KINZTLER ALAN JOEL
Hipólito Yrigoyen 3501 - Florida, Buenos Aires
Transferencia Bancaria
CUIT:
Ingresos Brutos:
Fecha de Inicio de Actividades:
Punto de Venta: 00002 Comp. Nro: 00001852
Domicilio Comercial:
Razón Social:
GRUPO BECKER S.R.L.
Condición frente al IVA:
A FACTURA
COD. 01
IVA Responsable Inscripto
IVA Responsable Inscripto
01/01/2013
30712854509
Código Producto / Servicio Cantidad U. medida Precio Unit. % Bonif Subtotal Alicuota
IVA Subtotal c/IVA
006 Bandera sublimada COCO 145x90 con lazos 3,00 unidades 23553,72 0,00 70661,16 21% 85500,00
CAE N°: 86162609903543
Fecha de Vto. de CAE: 02/05/2026
Comprobante Autorizado
Importe Otros Tributos: $ 0,00
Importe Neto Gravado: $ 70661,16
IVA 27%: $ 0,00
IVA 21%: $ 14838,84
IVA 10.5%: $ 0,00
IVA 5%: $ 0,00
IVA 2.5%: $ 0,00
IVA 0%: $ 0,00
Importe Otros Tributos: $ 0,00
Importe Total: $ 85500,00
`

describe('parseAfipInvoicePdfText — Factura A sample', () => {
  const parsed = parseAfipInvoicePdfText(SAMPLE_AFIP_A)

  it('detects Factura A', () => {
    expect(parsed.invoice_type).toBe('A')
  })

  it('extracts punto de venta and comp. nro with zero-padding', () => {
    expect(parsed.punto_venta).toBe('00002')
    expect(parsed.invoice_number).toBe('00001852')
    expect(parsed.invoice_number_full).toBe('00002-00001852')
  })

  it('extracts fecha de emisión as ISO', () => {
    expect(parsed.invoice_date).toBe('2026-04-22')
  })

  it('extracts CAE and its vencimiento', () => {
    expect(parsed.cae).toBe('86162609903543')
    expect(parsed.cae_expiry_date).toBe('2026-05-02')
  })

  it('separates issuer CUIT from customer CUIT', () => {
    expect(parsed.seller_cuit).toBe('30712854509')
    expect(parsed.customer_cuit).toBe('20369013603')
  })

  it('extracts customer name stripping trailing address/labels', () => {
    expect(parsed.customer_name).toBe('KINZTLER ALAN JOEL')
  })

  it('parses the single line item with numeric fields', () => {
    expect(parsed.items).toHaveLength(1)
    const item = parsed.items[0]
    expect(item.code).toBe('006')
    expect(item.product_name).toBe('Bandera sublimada COCO 145x90 con lazos')
    expect(item.quantity).toBe(3)
    expect(item.unit_price).toBe(23553.72)
    expect(item.vat_rate).toBe(21)
    expect(item.subtotal).toBe(70661.16)
    expect(item.subtotal_with_vat).toBe(85500)
  })

  it('extracts totals: neto, iva, total', () => {
    expect(parsed.totals.neto).toBe(70661.16)
    expect(parsed.totals.iva).toBeCloseTo(14838.84, 2)
    expect(parsed.totals.total).toBe(85500)
  })

  it('reports no warnings when everything parsed', () => {
    expect(parsed.warnings).toEqual([])
  })
})

describe('parseAfipInvoicePdfText — Factura B via COD. 06 fallback', () => {
  const SAMPLE_B = `
    Fecha de Emisión: 15/03/2026
    CUIT: 30712854509
    20123456789 JUAN PEREZ
    Punto de Venta: 00003 Comp. Nro: 00000042
    FACTURA COD. 06
    CAE N°: 12345678901234
    Fecha de Vto. de CAE: 25/03/2026
    001 Producto test 1,00 unidades 1000,00 0,00 1000,00 21% 1210,00
    Importe Neto Gravado: $ 1000,00
    IVA 21%: $ 210,00
    Importe Total: $ 1210,00
  `
  const parsed = parseAfipInvoicePdfText(SAMPLE_B)

  it('falls back to COD. 06 → type B', () => {
    expect(parsed.invoice_type).toBe('B')
  })

  it('still extracts punto de venta + numero', () => {
    expect(parsed.invoice_number_full).toBe('00003-00000042')
  })

  it('extracts the customer CUIT (skipping issuer)', () => {
    expect(parsed.customer_cuit).toBe('20123456789')
  })

  it('parses the item', () => {
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].unit_price).toBe(1000)
    expect(parsed.items[0].vat_rate).toBe(21)
    expect(parsed.items[0].subtotal).toBe(1000)
    expect(parsed.items[0].subtotal_with_vat).toBe(1210)
  })
})

describe('parseAfipInvoicePdfText — defensive: bad input', () => {
  it('returns nulls and warnings on empty text', () => {
    const parsed = parseAfipInvoicePdfText('')
    expect(parsed.invoice_type).toBeNull()
    expect(parsed.punto_venta).toBeNull()
    expect(parsed.invoice_number).toBeNull()
    expect(parsed.cae).toBeNull()
    expect(parsed.items).toEqual([])
    expect(parsed.warnings.length).toBeGreaterThan(0)
  })

  it('tolerates unparseable dates without crashing', () => {
    const parsed = parseAfipInvoicePdfText('Fecha de Emisión: 99/99/9999')
    expect(parsed.invoice_date).toBeNull()
  })
})
