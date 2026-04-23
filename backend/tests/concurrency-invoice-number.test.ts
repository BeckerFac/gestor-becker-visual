import { describe, it, expect, beforeEach } from 'vitest';
import {
  mockDbExecute,
  mockDbRows,
  mockClientQuery,
  resetMocks,
} from './helpers/setup';

import { InvoicesService } from '../src/modules/invoices/invoices.service';

/**
 * Wave 3A — concurrency tests for createInvoice.
 *
 * Goal: confirm that invoice_number generation runs on a SINGLE pool client
 * with:
 *   BEGIN -> pg_advisory_xact_lock -> SELECT MAX() -> INSERT -> COMMIT
 * all targeting the SAME pg client so the advisory lock effectively
 * serializes concurrent creators.
 *
 * Previous pattern issued `db.execute(sql`BEGIN`)` / `db.execute(sql`COMMIT`)`
 * via drizzle's pool connection, which picks a fresh client from the pool on
 * every call — the lock was effectively discarded between statements.
 */
describe('InvoicesService - concurrency (Wave 3A)', () => {
  let service: InvoicesService;

  beforeEach(() => {
    resetMocks();
    service = new InvoicesService();
    // Skip ensureMigrations DDL noise.
    (service as any).migrationsRun = true;
  });

  it('acquires advisory lock, reads MAX, INSERTs, and COMMITs on a single pool client', async () => {
    // db.execute is used for: resolveInvoiceFiscalIdentity customer lookup,
    // default BU lookup, per-item order availability check, enterprise/customer
    // validation, etc. Provide open-ended impl that returns rows for any query.
    mockDbExecute.mockImplementation((tpl: any) => {
      const s = tpl?.strings ? tpl.strings.join('') : '';
      // Default BU lookup
      if (/FROM business_units/.test(s)) return Promise.resolve({ rows: [{ id: 'bu-1' }] });
      // Customer tenant check
      if (/FROM customers WHERE id/.test(s)) return Promise.resolve({ rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] });
      // Enterprise tenant check
      if (/FROM enterprises WHERE id/.test(s)) return Promise.resolve({ rows: [{ id: 'ent-1' }] });
      // No order linking, so order_items check shouldn't fire
      return Promise.resolve({ rows: [] });
    });

    // Capture all client.query calls to verify ordering.
    const clientCalls: Array<{ sql: string; params: any[] }> = [];
    mockClientQuery.mockImplementation((sqlStr: string, params?: any[]) => {
      clientCalls.push({ sql: String(sqlStr), params: params || [] });
      const s = String(sqlStr);
      if (/COALESCE\(MAX\(invoice_number\)/.test(s)) {
        return Promise.resolve({ rows: [{ next_number: '42' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.createInvoice('company-A', 'user-1', {
      customer_id: 'cust-1',
      fiscal_type: 'fiscal',
      invoice_type: 'B',
      items: [{ product_name: 'X', quantity: 1, unit_price: 100, vat_rate: 21 }],
    });

    // Find relevant calls
    const sqls = clientCalls.map((c) => c.sql.trim().split('\n')[0]);
    const beginIdx = sqls.findIndex((c) => /^BEGIN/i.test(c));
    const lockIdx = sqls.findIndex((c) => /pg_advisory_xact_lock/.test(c));
    const maxIdx = sqls.findIndex((c) => /COALESCE\(MAX\(invoice_number/.test(c));
    const insertIdx = sqls.findIndex((c) => /INSERT INTO invoices/.test(c));
    const commitIdx = sqls.findIndex((c) => /^COMMIT/i.test(c));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(maxIdx).toBeGreaterThan(lockIdx);
    expect(insertIdx).toBeGreaterThan(maxIdx);
    expect(commitIdx).toBeGreaterThan(insertIdx);

    // Advisory lock key must be scoped by company + fiscal + type
    const lockCall = clientCalls.find((c) => /pg_advisory_xact_lock/.test(c.sql));
    expect(lockCall).toBeDefined();
    expect(lockCall!.params[0]).toBe('invoice_num:company-A:fiscal:B');

    // Number MAX query must be scoped by company.
    const maxCall = clientCalls.find((c) => /COALESCE\(MAX\(invoice_number/.test(c.sql));
    expect(maxCall).toBeDefined();
    expect(maxCall!.params).toContain('company-A');
  });

  it('issues ROLLBACK on failure (not COMMIT) so the connection stays consistent', async () => {
    mockDbExecute.mockImplementation(() => Promise.resolve({ rows: [] }));

    // Client.query: advisory lock ok, then MAX throws simulating a DB error.
    mockClientQuery.mockImplementation((sqlStr: string) => {
      const s = String(sqlStr);
      if (/^BEGIN/i.test(s)) return Promise.resolve({ rows: [] });
      if (/pg_advisory_xact_lock/.test(s)) return Promise.resolve({ rows: [] });
      if (/COALESCE\(MAX\(invoice_number/.test(s)) {
        return Promise.reject(new Error('simulated DB failure'));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.createInvoice('company-A', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'B',
        items: [{ product_name: 'X', quantity: 1, unit_price: 100 }],
      })
    ).rejects.toThrow(/Failed to create invoice/);

    const sqls = mockClientQuery.mock.calls.map((c: any) => String(c[0]));
    expect(sqls.some((s) => /^BEGIN/i.test(s))).toBe(true);
    expect(sqls.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(sqls.some((s) => /^COMMIT/i.test(s))).toBe(false);
  });
});
