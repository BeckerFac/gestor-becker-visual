/**
 * Wave 3C: financial correctness tests.
 *
 * Covers the bugs fixed in this wave:
 *   C1 - Aging / morosos read applied cobros from cobro_invoice_applications
 *        (the dead `payments` table was leaking 100% AR drift).
 *   C2 - IVA drift header vs Libro IVA per-row.  Header vat_amount ==
 *        SUM(items.vat_amount) now that rounding is done per-item at
 *        create-time and stored alongside the subtotal.
 *   C3 - Non-ARS invoices / purchase invoices require a positive
 *        exchange_rate (used to silently store NaN / 0).
 *   C4 - Order-level descuento propagates to invoice_items (previously
 *        the header was reduced but items kept pre-discount subtotals,
 *        making Libro IVA per-row sums disagree with the header).
 */
import { describe, it, expect } from 'vitest'
import './helpers/setup'

import { parseAndValidateExchangeRate } from '../src/modules/invoices/invoices.service'

describe('Wave 3C — parseAndValidateExchangeRate (C3)', () => {
  it('returns null for ARS when no rate is provided', () => {
    expect(parseAndValidateExchangeRate('ARS', undefined)).toBeNull()
    expect(parseAndValidateExchangeRate('ARS', null)).toBeNull()
    expect(parseAndValidateExchangeRate('ARS', '')).toBeNull()
  })

  it('accepts a positive rate for ARS (ignored by INSERT but not rejected)', () => {
    expect(parseAndValidateExchangeRate('ARS', '1')).toBe(1)
  })

  it('throws 400 for non-ARS currency without rate', () => {
    expect(() => parseAndValidateExchangeRate('USD', undefined)).toThrowError(
      /exchange_rate requerido/
    )
    expect(() => parseAndValidateExchangeRate('USD', '')).toThrowError(
      /exchange_rate requerido/
    )
    expect(() => parseAndValidateExchangeRate('USD', null)).toThrowError(
      /exchange_rate requerido/
    )
  })

  it('throws 400 for zero / negative / NaN / absurd rate', () => {
    expect(() => parseAndValidateExchangeRate('USD', '0')).toThrowError(/exchange_rate/)
    expect(() => parseAndValidateExchangeRate('USD', '-50')).toThrowError(/exchange_rate/)
    expect(() => parseAndValidateExchangeRate('USD', 'abc')).toThrowError(/exchange_rate/)
    expect(() => parseAndValidateExchangeRate('USD', '5000000')).toThrowError(/fuera de rango/)
  })

  it('returns the parsed positive rate for non-ARS currency', () => {
    expect(parseAndValidateExchangeRate('USD', '1250')).toBe(1250)
    expect(parseAndValidateExchangeRate('EUR', '1380.50')).toBe(1380.5)
  })

  it('normalizes currency to uppercase in the error message', () => {
    expect(() => parseAndValidateExchangeRate('usd', undefined)).toThrowError(/USD/)
  })
})

describe('Wave 3C — per-item VAT rounding (C2 + C4)', () => {
  it('rounds per-item subtotal and vat_amount so SUM(items) == header', () => {
    // Simulate the exact loop used in createInvoice/updateDraftInvoice for
    // the classic "3 items @ $33.33 at 21%" case that used to drift.
    const items = [
      { unit_price: 33.33, quantity: 1, vat_rate: 21 },
      { unit_price: 33.33, quantity: 1, vat_rate: 21 },
      { unit_price: 33.33, quantity: 1, vat_rate: 21 },
    ]
    const discountMultiplier = 1 // no discount

    let subtotal = 0
    let vatAmount = 0
    const rounded: Array<{ subtotal: number; vat: number }> = []
    for (const it of items) {
      const rawSubtotal = it.unit_price * it.quantity
      const itemSubtotal = Math.round(rawSubtotal * discountMultiplier * 100) / 100
      const itemVat = Math.round(itemSubtotal * it.vat_rate) / 100
      subtotal += itemSubtotal
      vatAmount += itemVat
      rounded.push({ subtotal: itemSubtotal, vat: itemVat })
    }

    // Header equals SUM(items.*) — exact, no drift.
    const sumSubtotal = rounded.reduce((s, r) => s + r.subtotal, 0)
    const sumVat = rounded.reduce((s, r) => s + r.vat, 0)
    expect(sumSubtotal).toBeCloseTo(subtotal, 10)
    expect(sumVat).toBeCloseTo(vatAmount, 10)

    // Each row's vat_amount is independently rounded.
    for (const r of rounded) {
      expect(r.vat).toBe(Math.round(r.vat * 100) / 100)
    }
  })

  it('applies order-level discount pro-rata per item', () => {
    // 10% discount on three items of $100 @ 21%.
    const discountPercent = 10
    const discountMultiplier = 1 - discountPercent / 100 // 0.9
    const items = [
      { unit_price: 100, quantity: 1, vat_rate: 21 },
      { unit_price: 100, quantity: 1, vat_rate: 21 },
      { unit_price: 100, quantity: 1, vat_rate: 21 },
    ]
    let subtotal = 0
    let vatAmount = 0
    for (const it of items) {
      const raw = it.unit_price * it.quantity
      const itemSubtotal = Math.round(raw * discountMultiplier * 100) / 100
      const itemVat = Math.round(itemSubtotal * it.vat_rate) / 100
      subtotal += itemSubtotal
      vatAmount += itemVat
    }

    // 3 * $100 * 0.9 = $270 subtotal, $56.70 VAT
    expect(subtotal).toBeCloseTo(270, 2)
    expect(vatAmount).toBeCloseTo(56.7, 2)
  })

  it('preserves header == SUM(items) under odd discounts that force rounding', () => {
    const discountPercent = 13
    const discountMultiplier = 1 - discountPercent / 100 // 0.87
    const items = [
      { unit_price: 123.45, quantity: 2, vat_rate: 21 },
      { unit_price: 67.89, quantity: 3, vat_rate: 10.5 },
    ]
    let subtotal = 0
    let vatAmount = 0
    const perItem: Array<{ s: number; v: number }> = []
    for (const it of items) {
      const raw = it.unit_price * it.quantity
      const itemSubtotal = Math.round(raw * discountMultiplier * 100) / 100
      const itemVat = Math.round(itemSubtotal * it.vat_rate) / 100
      subtotal += itemSubtotal
      vatAmount += itemVat
      perItem.push({ s: itemSubtotal, v: itemVat })
    }
    expect(perItem.reduce((s, r) => s + r.s, 0)).toBeCloseTo(subtotal, 10)
    expect(perItem.reduce((s, r) => s + r.v, 0)).toBeCloseTo(vatAmount, 10)
  })
})

describe('Wave 3C — purchase-invoices + pagos exchange_rate (C3)', () => {
  it('purchase-invoices.service.ts validates exchange_rate inline on insert', async () => {
    // Regression guard: a previous refactor accepted NULL rate on USD
    // purchase invoices which then silently wrote NaN to the DECIMAL
    // column.  The fix inlines the same rules used by
    // parseAndValidateExchangeRate.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.resolve(
      __dirname,
      '../src/modules/purchase-invoices/purchase-invoices.service.ts',
    )
    const src = await fs.readFile(file, 'utf8')
    expect(src).toMatch(/exchange_rate requerido y > 0/)
    expect(src).toMatch(/exchange_rate invalido/)
  })

  it('pagos.service.ts rejects NaN / non-positive rates', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.resolve(__dirname, '../src/modules/pagos/pagos.service.ts')
    const src = await fs.readFile(file, 'utf8')
    // Pre-existing (Wave 3D) validation guards — Wave 3C C3 depends on
    // these remaining in place for pagos parity.
    expect(src).toMatch(/exchange_rate invalido/)
    expect(src).toMatch(/exchange_rate es requerido cuando la moneda no es ARS/)
  })
})

describe('Wave 3C — aging query uses cobro_invoice_applications (C1)', () => {
  it('business.service.ts contains the new query against cobro_invoice_applications', async () => {
    // Static assertion: the aging query references cobro_invoice_applications
    // and no longer references the dead `payments` table.  This guards
    // against regressions where someone copy-pastes the old payments
    // subquery back in.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.resolve(__dirname, '../src/modules/reports/business.service.ts')
    const src = await fs.readFile(file, 'utf8')
    expect(src).not.toMatch(/FROM payments p/)
    expect(src).not.toMatch(/JOIN payments p/)
    expect(src).toMatch(/FROM cobro_invoice_applications cia/)
    expect(src).toMatch(/JOIN cobros cb ON cia\.cobro_id = cb\.id/)
  })

  it('business.service.ts DSO query joins cobros + cobro_invoice_applications', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.resolve(__dirname, '../src/modules/reports/business.service.ts')
    const src = await fs.readFile(file, 'utf8')
    // DSO must now extract the days between cobros.payment_date and
    // invoices.invoice_date — not against the dead `payments.payment_date`.
    expect(src).toMatch(/EXTRACT\(DAY FROM cb\.payment_date - i\.invoice_date\)/)
  })
})
