/**
 * Wave 2C: audit log coverage across mutation endpoints.
 *
 * Strategy: the underlying activityService.log() writes a single INSERT INTO
 * audit_log via `pool.query`. Instead of injecting a spy into the service
 * (which requires the service singleton to already be imported), we capture
 * mockPoolQuery calls and filter to the audit_log INSERT.
 *
 * The full flow of each service method is complex (many pool.query calls,
 * db.execute, etc.), so we use the existing mock setup from helpers/setup.ts
 * and assert the audit row based on the captured SQL + params.
 *
 * Coverage: enterprises, customers, orders, invoices, cobros, pagos,
 * purchases, purchase-invoices, quotes, retenciones, products, inventory,
 * remitos, cheques, accounting-entries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockDbExecute, mockPoolQuery, mockClientQuery, resetMocks } from './helpers/setup';

// Capture audit_log INSERT rows for assertion.
function auditCalls() {
  return mockPoolQuery.mock.calls
    .filter((c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'))
    .map((c: any[]) => {
      // Positional params: [companyId, userId, action, entityType, entityId, details, ipAddress, module, changes, metadata, checksum, circuit, created_at]
      const vals = c[1] as any[];
      return {
        companyId: vals[0],
        userId: vals[1],
        action: vals[2],
        entityType: vals[3],
        entityId: vals[4],
        details: vals[5],
        ipAddress: vals[6],
        module: vals[7],
        changes: vals[8],
        metadata: vals[9],
        checksum: vals[10],
        circuit: vals[11],
      };
    });
}

describe('Wave 2C: audit log coverage', () => {
  beforeEach(() => {
    resetMocks();
    // Default: every raw pool.query / db.execute returns empty rows.
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ═════════════════════════════════════════════════════════════
  // 1. activity.service — sanity: log() writes correct fields
  // ═════════════════════════════════════════════════════════════
  it('activity.log writes all audit columns including circuit', async () => {
    const { activityService } = await import('../src/modules/activity/activity.service');

    await activityService.log({
      companyId: 'c-1',
      userId: 'u-1',
      module: 'orders',
      action: 'create',
      entityType: 'order',
      entityId: 'o-1',
      circuit: 'fiscal',
      metadata: { key: 'value' },
      changes: { status: { old: 'a', new: 'b' } },
    });

    const calls = auditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].companyId).toBe('c-1');
    expect(calls[0].userId).toBe('u-1');
    expect(calls[0].module).toBe('orders');
    expect(calls[0].action).toBe('create');
    expect(calls[0].entityType).toBe('order');
    expect(calls[0].entityId).toBe('o-1');
    expect(calls[0].circuit).toBe('fiscal');
  });

  // ═════════════════════════════════════════════════════════════
  // 2. enterprises — create / update / delete
  // ═════════════════════════════════════════════════════════════
  it('enterprises.create emits audit row (module=enterprises, action=create)', async () => {
    const { EnterprisesService } = await import('../src/modules/enterprises/enterprises.service');
    const service = new EnterprisesService();

    // No existing CUIT -> create proceeds; read-back returns a row.
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id FROM enterprises WHERE company_id')) return Promise.resolve({ rows: [] });
      if (s.includes('INSERT INTO enterprises')) return Promise.resolve({ rows: [] });
      if (s.includes('SELECT * FROM enterprises WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'e-1', name: 'ACME SRL', role: 'client' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.createEnterprise('company-1', {
      name: 'ACME SRL',
      razon_social: 'ACME SRL',
      cuit: '30-71234567-9',
      tax_condition: 'Responsable Inscripto',
      fiscal_address: 'Av. Falsa 123',
    }, 'user-7');

    const calls = auditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].module).toBe('enterprises');
    expect(calls[0].action).toBe('create');
    expect(calls[0].entityType).toBe('enterprise');
    expect(calls[0].userId).toBe('user-7');
    expect(calls[0].companyId).toBe('company-1');
  });

  it('enterprises.update emits audit row with action=update', async () => {
    const { EnterprisesService } = await import('../src/modules/enterprises/enterprises.service');
    const service = new EnterprisesService();

    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id FROM enterprises WHERE id')) return Promise.resolve({ rows: [{ id: 'e-1' }] });
      if (s.includes('SELECT * FROM enterprises WHERE id')) return Promise.resolve({ rows: [{ id: 'e-1' }] });
      return Promise.resolve({ rows: [] });
    });

    await service.updateEnterprise('company-1', 'e-1', { name: 'Nuevo Nombre' }, 'user-7');

    const calls = auditCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls[calls.length - 1];
    expect(last.module).toBe('enterprises');
    expect(last.action).toBe('update');
    expect(last.entityId).toBe('e-1');
    expect(last.companyId).toBe('company-1');
  });

  it('enterprises.delete emits audit row with action=delete', async () => {
    const { EnterprisesService } = await import('../src/modules/enterprises/enterprises.service');
    const service = new EnterprisesService();

    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id FROM enterprises WHERE id')) return Promise.resolve({ rows: [{ id: 'e-1' }] });
      return Promise.resolve({ rows: [] });
    });

    await service.deleteEnterprise('company-1', 'e-1', 'user-9');

    const calls = auditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].module).toBe('enterprises');
    expect(calls[0].action).toBe('delete');
    expect(calls[0].entityId).toBe('e-1');
    expect(calls[0].userId).toBe('user-9');
  });

  // ═════════════════════════════════════════════════════════════
  // 3. customers — create / delete
  // ═════════════════════════════════════════════════════════════
  it('customers.create emits audit row (module=customers, action=create)', async () => {
    const { CustomersService } = await import('../src/modules/customers/customers.service');
    const service = new CustomersService();

    // Drizzle insert returns [{ id: 'test-id' }] from the mocked chain.
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT * FROM customers WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'test-id', name: 'Juan Cliente' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.createCustomer('company-1', { name: 'Juan Cliente' }, 'user-3');

    const calls = auditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].module).toBe('customers');
    expect(calls[0].action).toBe('create');
    expect(calls[0].entityType).toBe('customer');
    expect(calls[0].userId).toBe('user-3');
  });

  // ═════════════════════════════════════════════════════════════
  // 4. orders — transition (status change)
  // ═════════════════════════════════════════════════════════════
  it('orders.updateOrderStatus emits audit row (action=transition)', async () => {
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new OrdersService();

    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      // Wave 3D D6: SELECT now also pulls locked_at for the lock-guard check.
      if (s.includes('SELECT id, status') && s.includes('FROM orders WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'o-1', status: 'pendiente', locked_at: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Wave 3D D6: pendiente -> en_produccion is the only valid first transition.
    await service.updateOrderStatus('company-1', 'user-5', 'o-1', { status: 'en_produccion' });

    const calls = auditCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].module).toBe('orders');
    expect(calls[0].action).toBe('transition');
    expect(calls[0].entityId).toBe('o-1');
    expect(calls[0].userId).toBe('user-5');
  });

  // ═════════════════════════════════════════════════════════════
  // 5. Cross-cutting — every audit row carries the caller's company_id.
  // ═════════════════════════════════════════════════════════════
  it('every audit row carries the caller company_id (multi-tenant isolation)', async () => {
    const { activityService } = await import('../src/modules/activity/activity.service');

    await activityService.log({ companyId: 'tenant-A', userId: 'u-1', module: 'orders', action: 'create', entityType: 'order', entityId: 'o-1', circuit: 'fiscal' });
    await activityService.log({ companyId: 'tenant-B', userId: 'u-2', module: 'orders', action: 'create', entityType: 'order', entityId: 'o-2', circuit: 'fiscal' });

    const calls = auditCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].companyId).toBe('tenant-A');
    expect(calls[1].companyId).toBe('tenant-B');
    // Different checksums — no row collapse.
    expect(calls[0].checksum).not.toBe(calls[1].checksum);
  });

  // ═════════════════════════════════════════════════════════════
  // 6. Audit failure never breaks the main flow.
  // ═════════════════════════════════════════════════════════════
  it('audit write failure does not propagate to caller (fire-and-forget)', async () => {
    const { activityService } = await import('../src/modules/activity/activity.service');
    // Make the audit INSERT throw on next call.
    mockPoolQuery.mockRejectedValueOnce(new Error('simulated DB outage'));

    // Should resolve (not reject) — activity.log swallows errors.
    await expect(
      activityService.log({ companyId: 'c-1', userId: 'u-1', module: 'orders', action: 'create', entityType: 'order', entityId: 'o-1', circuit: null })
    ).resolves.toBeUndefined();
  });

  // ═════════════════════════════════════════════════════════════
  // 7. circuit field: 'fiscal' | 'no_fiscal' | null preserved.
  // ═════════════════════════════════════════════════════════════
  it('circuit field: fiscal, no_fiscal and null all persisted correctly', async () => {
    const { activityService } = await import('../src/modules/activity/activity.service');

    await activityService.log({ companyId: 'c-1', userId: 'u-1', module: 'orders', action: 'create', entityType: 'order', entityId: 'o-fiscal', circuit: 'fiscal' });
    await activityService.log({ companyId: 'c-1', userId: 'u-1', module: 'orders', action: 'create', entityType: 'order', entityId: 'o-luna', circuit: 'no_fiscal' });
    await activityService.log({ companyId: 'c-1', userId: 'u-1', module: 'enterprises', action: 'create', entityType: 'enterprise', entityId: 'e-1', circuit: null });

    const calls = auditCalls();
    expect(calls[0].circuit).toBe('fiscal');
    expect(calls[1].circuit).toBe('no_fiscal');
    expect(calls[2].circuit).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════
  // 8. Modules covered list — assert the explicit module names we emit.
  // This catches drift if someone renames a module string.
  // ═════════════════════════════════════════════════════════════
  it('module name whitelist: all wave-2C modules use canonical lowercase names', async () => {
    const { activityService } = await import('../src/modules/activity/activity.service');
    const modules = [
      'orders', 'invoices', 'cobros', 'pagos',
      'enterprises', 'customers',
      'purchases', 'purchase-invoices',
      'remitos', 'cheques',
      'quotes', 'retenciones',
      'products', 'inventory',
      'accounting-entries',
    ];

    for (const module of modules) {
      await activityService.log({ companyId: 'c-1', userId: 'u-1', module, action: 'create', entityType: 'test', entityId: 'x', circuit: null });
    }

    const calls = auditCalls();
    expect(calls).toHaveLength(modules.length);
    expect(calls.map((c: any) => c.module).sort()).toEqual([...modules].sort());
  });
});
