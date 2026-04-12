/**
 * Tests for Plan 11: Remitos ↔ Pedidos ↔ Facturas Linking
 * Tests Fases 1-4 (DB migrations, queries, createRemito, invoice linking)
 *
 * Uses the same mock pattern as existing tests (mock pool.query)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, resetMocks } from './helpers/setup';
import { pool } from '../src/config/db';

// Mock logger
vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ═══════════════════════════════════════════════════════════════════
// FASE 1: Migration checks (verify SQL statements are correct)
// ═══════════════════════════════════════════════════════════════════

describe('Fase 1: DB Migrations (code verification)', () => {
  it('remitos.service.ts contains all required migration SQL', async () => {
    // Verify migration SQL exists in source code (static analysis)
    const fs = await import('fs');
    const source = fs.readFileSync(
      require('path').join(__dirname, '../src/modules/remitos/remitos.service.ts'), 'utf-8'
    );

    // N:N tables
    expect(source).toContain('CREATE TABLE IF NOT EXISTS remito_orders');

    // remito_items columns
    expect(source).toContain('order_item_id');
    expect(source).toContain('unit_price');
    expect(source).toContain('vat_rate');

    // order_items.qty_delivered
    expect(source).toContain('qty_delivered');

    // Company config fields
    expect(source).toContain('punto_venta_remito');
    expect(source).toContain('cai_remito');

    // Indices
    expect(source).toContain('idx_remito_items_order_item');

    // ON DELETE RESTRICT for orders
    expect(source).toContain('ON DELETE RESTRICT');
    // Plan 12: invoice_remitos and invoice_item_id REMOVED
    // Remitos are independent of invoicing
  });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 2: Availability queries return correct data
// ═══════════════════════════════════════════════════════════════════

describe('Fase 2: Availability Queries', () => {
  beforeEach(() => resetMocks());

  it('getAvailableOrderItemsForRemito returns items with qty_available > 0', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('qty_delivered') && sql.includes('order_items') && sql.includes('qty_available')) {
        return {
          rows: [
            { order_item_id: 'oi-1', product_name: 'Pintura', quantity: 10, qty_delivered: 3, qty_available: 7, order_number: 3, enterprise_name: 'Garcia' },
            { order_item_id: 'oi-2', product_name: 'Cemento', quantity: 5, qty_delivered: 5, qty_available: 0 },
          ].filter(r => r.qty_available > 0),
        };
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const items = await service.getAvailableOrderItemsForRemito('comp-1', 'order-1');
    expect(items).toHaveLength(1);
    expect(items[0].product_name).toBe('Pintura');
    expect(items[0].qty_available).toBe(7);
  });

  // getAvailableInvoiceItemsForRemito REMOVED in Plan 12 (remitos independent of invoicing)

  it('getRemitoContextData returns item status', async () => {
    mockPoolQuery.mockImplementation(async () => {
      return { rows: [
        { id: 'ri-1', product_name: 'Pintura', quantity: 5, order_item_id: 'oi-1', source_ref: 'Pedido #0003' },
      ]};
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const data = await service.getRemitoContextData('comp-1', 'rem-1');
    expect(data.items_status).toHaveLength(1);
    expect(data.items_status[0].source_ref).toBe('Pedido #0003');
  });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 3: createRemito with linking
// ═══════════════════════════════════════════════════════════════════

describe('Fase 3: createRemito with linking', () => {
  beforeEach(() => resetMocks());

  it('createRemito validates qty against available and rejects excess', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    // Setup mock client responses
    let queryNum = 0;
    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      queryNum++;
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };

      // Get next remito number
      if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };

      // FOR UPDATE lock on order_items — return item with only 3 available
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 7, enterprise_id: 'ent-1', order_id: 'ord-1' }] };
      }

      return { rows: [] };
    });

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });

    // Mock pool.connect to return our mock client
    const { pool } = await import('../src/config/db');
    vi.spyOn(pool, 'connect').mockResolvedValue(mockClient as any);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    // Try to remit 5 when only 3 available → should throw
    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 5, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/No se pueden remitar 5/);
  });

  it('createRemito updates qty_delivered on order_items', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 5 }] };
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-1' }] };
        if (sql.includes('SELECT order_id FROM order_items')) return { rows: [{ order_id: 'ord-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' }],
    });

    // Verify qty_delivered was updated
    const updateQuery = executedQueries.find(q => q.sql.includes('UPDATE order_items SET qty_delivered'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.params).toContain(3); // quantity
    expect(updateQuery!.params).toContain('oi-1'); // order_item_id
  });

  it('createRemito creates remito_orders entries', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' }],
    });

    const remitoOrdersInsert = executedQueries.find(q => q.sql.includes('INSERT INTO remito_orders'));
    expect(remitoOrdersInsert).toBeDefined();
  });

  // Plan 12: invoice_item resolution REMOVED (remitos independent)
  it.skip('createRemito resolves transitive order_item_id from invoice_item', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        // Invoice item availability check
        if (sql.includes('invoice_items') && sql.includes('qty_available')) {
          return { rows: [{ qty_available: 5, enterprise_id: 'ent-1' }] };
        }
        // Transitive order_item_id lookup
        if (sql.includes('SELECT order_item_id FROM invoice_items WHERE id')) {
          return { rows: [{ order_item_id: 'oi-transitive' }] };
        }
        // Lock for transitive order_item
        if (sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'oi-transitive', quantity: 10, qty_delivered: 0 }] };
        }
        if (sql.includes('SELECT order_id FROM order_items')) return { rows: [{ order_id: 'ord-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'GoBecker', quantity: 2, invoice_item_id: 'ii-1' }],
    });

    // Should have resolved order_item_id transitively and updated qty_delivered
    const updateQty = executedQueries.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered') && q.params?.includes('oi-transitive')
    );
    expect(updateQty).toBeDefined();
  });

  // Plan 12: invoice_item validation REMOVED (remitos independent)
  it.skip('createRemito validates same enterprise for invoice items', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        // Invoice item from DIFFERENT enterprise
        if (sql.includes('invoice_items') && sql.includes('qty_available')) {
          return { rows: [{ qty_available: 5, enterprise_id: 'ent-OTHER' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 3, invoice_item_id: 'ii-1' }],
    })).rejects.toThrow(/otra empresa/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 3: deleteRemito reverts qty_delivered
// ═══════════════════════════════════════════════════════════════════

describe('Fase 3: anularRemito reverts qty_delivered', () => {
  beforeEach(() => resetMocks());

  it('anularRemito reverts qty_delivered and sets status to anulado', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        // Find remito
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [{ id: 'rem-1', status: 'pendiente' }] };
        // Get items
        if (sql.includes('SELECT id, order_item_id, product_id, quantity FROM remito_items')) {
          return { rows: [
            { id: 'ri-1', order_item_id: 'oi-1', product_id: null, quantity: 3 },
            { id: 'ri-2', order_item_id: 'oi-2', product_id: null, quantity: 5 },
          ]};
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    // Should have reverted qty for both items
    const revertQueries = executedQueries.filter(q => q.sql.includes('GREATEST') && q.sql.includes('qty_delivered'));
    expect(revertQueries).toHaveLength(2);

    // Should have set status to anulado (now as SQL literal)
    const statusUpdate = executedQueries.find(q => q.sql.includes('UPDATE remitos SET status') && q.sql.includes('anulado'));
    expect(statusUpdate).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 4: Invoice accepts remito_item_id (integration-level)
// ═══════════════════════════════════════════════════════════════════

describe('Fase 4: getAvailableOrderItemsForInvoicing (simplified)', () => {
  beforeEach(() => resetMocks());

  it('query uses simple item_invoiced CTE (no delivery blocking)', async () => {
    const executedQueries: string[] = [];
    mockPoolQuery.mockImplementation(async (sql: string) => {
      executedQueries.push(sql);
      return { rows: [] };
    });

    const { InvoicesService } = await import('../src/modules/invoices/invoices.service');
    const service = new (InvoicesService as any)();
    service.migrationsRun = true;

    try {
      await service.getAvailableOrderItemsForInvoicing('comp-1', {});
    } catch { /* may fail due to mocks */ }

    const mainQuery = executedQueries.find(q => q.includes('item_invoiced') && q.includes('qty_remaining'));
    expect(mainQuery).toBeDefined();
    // Should NOT include delivery CTEs (Plan 12: remitos independent)
    expect(mainQuery).not.toContain('item_delivered');
    expect(mainQuery).not.toContain('item_invoiced_via_remito');
    expect(mainQuery).not.toContain('remito_info');
  });
});
