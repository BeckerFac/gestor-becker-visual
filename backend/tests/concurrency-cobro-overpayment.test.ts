import { describe, it, expect, beforeEach } from 'vitest';
import {
  mockDbExecute,
  mockClientQuery,
  mockPoolQuery,
  resetMocks,
} from './helpers/setup';

import { CobrosService } from '../src/modules/cobros/cobros.service';

/**
 * Wave 3A — concurrency tests for createCobro (over-payment prevention).
 *
 * Goal: confirm that applying a cobro to an invoice:
 *   1. Acquires an advisory lock scoped to receipt_num:<companyId>.
 *   2. Generates receipt_number INSIDE the tx (not before BEGIN).
 *   3. SELECTs the invoice FOR UPDATE on the SAME pool client.
 *   4. Rejects applications that would exceed the remaining balance
 *      as-of the locked snapshot.
 *
 * These invariants together serialize concurrent cobros against the same
 * invoice and prevent the "receipt $200k, applied $605k" over-payment bug.
 */
describe('CobrosService - concurrency / over-payment (Wave 3A)', () => {
  let service: CobrosService;
  const companyId = 'company-A';
  const userId = 'user-1';
  const enterpriseId = 'ent-1';
  const businessUnitId = 'bu-1';
  const invoiceId = 'inv-1';

  beforeEach(() => {
    resetMocks();
    service = new CobrosService();
    (service as any).tablesEnsured = true;
  });

  function sqlOf(call: any): string {
    const tpl = call?.[0];
    return tpl?.strings ? tpl.strings.join('') : '';
  }

  // All pre-tx db.execute calls used by createCobro: default BU, bank
  // validation, legacy invoice_id check. validateInvoiceCircuit uses
  // pool.query, not db.execute — so we don't need to mock it here for the
  // invoice_items[] paths that skip legacy invoice_id.
  function setupPreTxMocks() {
    mockDbExecute.mockImplementation((...args: any[]) => {
      const s = sqlOf(args);
      if (s.includes('FROM business_units')) {
        return Promise.resolve({ rows: [{ id: businessUnitId }] });
      }
      if (s.includes('FROM banks WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'b-1' }] });
      }
      // Final SELECT after tx
      if (s.includes('FROM cobros c') && s.includes('LEFT JOIN enterprises')) {
        return Promise.resolve({ rows: [{ id: 'cobro-x', fiscal_type: 'fiscal' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // validateInvoiceCircuit uses pool.query with ANY($1::uuid[]) to check
    // that all invoices in the cobro share the cobro's fiscal circuit.
    mockPoolQuery.mockImplementation((sqlStr: string, _params?: any[]) => {
      const s = String(sqlStr);
      if (/FROM invoices/.test(s) && /fiscal_type/.test(s)) {
        return Promise.resolve({ rows: [{ id: invoiceId, fiscal_type: 'fiscal' }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it('runs BEGIN, advisory lock, MAX receipt_number, FOR UPDATE on SAME client', async () => {
    setupPreTxMocks();

    const calls: Array<{ sql: string; params: any[] }> = [];
    mockClientQuery.mockImplementation((sqlStr: string, params?: any[]) => {
      calls.push({ sql: String(sqlStr), params: params || [] });
      const s = String(sqlStr);
      if (/COALESCE\(MAX\(receipt_number/.test(s)) {
        return Promise.resolve({ rows: [{ next_number: '7' }] });
      }
      if (/SELECT id, enterprise_id, business_unit_id, status, payment_status/.test(s) && /FOR UPDATE/.test(s)) {
        return Promise.resolve({
          rows: [{
            id: invoiceId,
            enterprise_id: enterpriseId,
            business_unit_id: businessUnitId,
            status: 'authorized',
            payment_status: 'pendiente',
            invoice_type: 'B',
            invoice_number: 100,
            total_amount: '1000',
            currency: 'ARS',
          }],
        });
      }
      if (/applied_cash/.test(s) && /retenciones_total/.test(s)) {
        return Promise.resolve({ rows: [{ total: '1000', applied_cash: '0', retenciones_total: '0' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.createCobro(companyId, userId, {
      enterprise_id: enterpriseId,
      business_unit_id: businessUnitId,
      currency: 'ARS',
      payment_methods: [{ method: 'efectivo', amount: 500 }],
      invoice_items: [{ invoice_id: invoiceId, amount: 500 }],
    });

    const orderedSqls = calls.map((c) => c.sql.trim().split('\n')[0]);
    const beginIdx = orderedSqls.findIndex((s) => /^BEGIN/i.test(s));
    const lockIdx = orderedSqls.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    const maxIdx = orderedSqls.findIndex((s) => /COALESCE\(MAX\(receipt_number/.test(s));
    const insertCobroIdx = orderedSqls.findIndex((s) => /INSERT INTO cobros/.test(s));
    const forUpdateIdx = calls.findIndex((c) => /FOR UPDATE/.test(c.sql));
    const commitIdx = orderedSqls.findIndex((s) => /^COMMIT/i.test(s));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(maxIdx).toBeGreaterThan(lockIdx);
    expect(insertCobroIdx).toBeGreaterThan(maxIdx);
    expect(forUpdateIdx).toBeGreaterThan(insertCobroIdx);
    expect(commitIdx).toBeGreaterThan(forUpdateIdx);

    // Advisory key
    const lockCall = calls.find((c) => /pg_advisory_xact_lock/.test(c.sql));
    expect(lockCall!.params[0]).toBe(`receipt_num:${companyId}`);
  });

  it('rejects application that would exceed remaining balance (serialized second cobro)', async () => {
    setupPreTxMocks();

    // Simulate: invoice $1000 already has $900 applied by a previously
    // committed cobro. Our second cobro tries to apply $500 — remaining is
    // $100, so we should get an over-payment ApiError.
    mockClientQuery.mockImplementation((sqlStr: string) => {
      const s = String(sqlStr);
      if (/COALESCE\(MAX\(receipt_number/.test(s)) {
        return Promise.resolve({ rows: [{ next_number: '8' }] });
      }
      if (/SELECT id, enterprise_id, business_unit_id, status, payment_status/.test(s) && /FOR UPDATE/.test(s)) {
        return Promise.resolve({
          rows: [{
            id: invoiceId,
            enterprise_id: enterpriseId,
            business_unit_id: businessUnitId,
            status: 'authorized',
            payment_status: 'parcial',
            invoice_type: 'B',
            invoice_number: 100,
            total_amount: '1000',
            currency: 'ARS',
          }],
        });
      }
      if (/applied_cash/.test(s) && /retenciones_total/.test(s)) {
        return Promise.resolve({ rows: [{ total: '1000', applied_cash: '900', retenciones_total: '0' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.createCobro(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
        currency: 'ARS',
        payment_methods: [{ method: 'efectivo', amount: 500 }],
        invoice_items: [{ invoice_id: invoiceId, amount: 500 }],
      })
    ).rejects.toThrow(/pendiente/);

    // Verify ROLLBACK was issued instead of COMMIT.
    const sqls = mockClientQuery.mock.calls.map((c: any) => String(c[0]));
    expect(sqls.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/i.test(s))).toBe(false);
  });

  it('rejects when FOR UPDATE returns "pagado" (post-lock snapshot observes a fully-paid invoice)', async () => {
    setupPreTxMocks();

    mockClientQuery.mockImplementation((sqlStr: string) => {
      const s = String(sqlStr);
      if (/COALESCE\(MAX\(receipt_number/.test(s)) {
        return Promise.resolve({ rows: [{ next_number: '9' }] });
      }
      if (/SELECT id, enterprise_id, business_unit_id, status, payment_status/.test(s) && /FOR UPDATE/.test(s)) {
        return Promise.resolve({
          rows: [{
            id: invoiceId,
            enterprise_id: enterpriseId,
            business_unit_id: businessUnitId,
            status: 'authorized',
            payment_status: 'pagado',
            invoice_type: 'B',
            invoice_number: 100,
            total_amount: '1000',
            currency: 'ARS',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.createCobro(companyId, userId, {
        enterprise_id: enterpriseId,
        business_unit_id: businessUnitId,
        currency: 'ARS',
        payment_methods: [{ method: 'efectivo', amount: 100 }],
        invoice_items: [{ invoice_id: invoiceId, amount: 100 }],
      })
    ).rejects.toThrow(/ya esta completamente pagada/);
  });
});
