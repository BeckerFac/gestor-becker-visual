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
    expect(source).toContain('CREATE TABLE IF NOT EXISTS invoice_remitos');

    // remito_items columns
    expect(source).toContain('order_item_id');
    expect(source).toContain('invoice_item_id');
    expect(source).toContain('unit_price');
    expect(source).toContain('vat_rate');

    // invoice_items.remito_item_id
    expect(source).toContain('remito_item_id');

    // order_items.qty_delivered
    expect(source).toContain('qty_delivered');

    // Company config fields
    expect(source).toContain('punto_venta_remito');
    expect(source).toContain('cai_remito');

    // Indices
    expect(source).toContain('idx_remito_items_order_item');
    expect(source).toContain('idx_invoice_items_remito_item');

    // ON DELETE RESTRICT (not CASCADE) for orders/invoices
    expect(source).toContain('ON DELETE RESTRICT');
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

  it('getAvailableInvoiceItemsForRemito excludes fully delivered items', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('invoice_items') && sql.includes('qty_available')) {
        return {
          rows: [
            { invoice_item_id: 'ii-1', product_name: 'GoBecker', quantity: 3, qty_delivered: 1, qty_available: 2 },
          ],
        };
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const items = await service.getAvailableInvoiceItemsForRemito('comp-1', 'inv-1');
    expect(items).toHaveLength(1);
    expect(items[0].qty_available).toBe(2);
  });

  it('getRemitoContextData returns invoices and item status', async () => {
    let callCount = 0;
    mockPoolQuery.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) { // invoices query
        return { rows: [{ id: 'inv-1', invoice_number: 3, invoice_type: 'B', total_amount: '60500', status: 'draft' }] };
      }
      if (callCount === 2) { // items status query
        return { rows: [
          { id: 'ri-1', product_name: 'Pintura', quantity: 5, qty_invoiced: 3, qty_pending: 2, source_ref: 'Pedido #0003' },
        ]};
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const data = await service.getRemitoContextData('comp-1', 'rem-1');
    expect(data.invoices).toHaveLength(1);
    expect(data.items_status).toHaveLength(1);
    expect(data.items_status[0].qty_pending).toBe(2);
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
        return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 7 }] };
      }

      return { rows: [] };
    });

    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));

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
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0 }] };
        if (sql.includes('SELECT order_id FROM order_items')) return { rows: [{ order_id: 'ord-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
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
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0 }] };
        if (sql.includes('SELECT order_id FROM order_items')) return { rows: [{ order_id: 'ord-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
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

  it('createRemito resolves transitive order_item_id from invoice_item', async () => {
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

    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
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

  it('createRemito validates same enterprise for invoice items', async () => {
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

    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
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

describe('Fase 3: deleteRemito reverts qty_delivered', () => {
  beforeEach(() => resetMocks());

  it('deleteRemito reverts qty_delivered and removes remito_orders', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        // Find remito
        if (sql.includes('SELECT id FROM remitos')) return { rows: [{ id: 'rem-1' }] };
        // Get items with order_item_id
        if (sql.includes('SELECT order_item_id, quantity FROM remito_items')) {
          return { rows: [
            { order_item_id: 'oi-1', quantity: 3 },
            { order_item_id: 'oi-2', quantity: 5 },
          ]};
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.deleteRemito('comp-1', 'rem-1');

    // Should have reverted qty for both items
    const revertQueries = executedQueries.filter(q => q.sql.includes('GREATEST') && q.sql.includes('qty_delivered'));
    expect(revertQueries).toHaveLength(2);

    // Should have deleted remito_orders
    const deleteRO = executedQueries.find(q => q.sql.includes('DELETE FROM remito_orders'));
    expect(deleteRO).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// FASE 4: Invoice accepts remito_item_id (integration-level)
// ═══════════════════════════════════════════════════════════════════

describe('Fase 4: getAvailableOrderItemsForInvoicing includes delivery data', () => {
  beforeEach(() => resetMocks());

  it('query includes delivery tracking CTEs', async () => {
    const executedQueries: string[] = [];
    mockPoolQuery.mockImplementation(async (sql: string) => {
      executedQueries.push(sql);
      return { rows: [] };
    });

    const { InvoicesService } = await import('../src/modules/invoices/invoices.service');
    const service = new (InvoicesService as any)();
    // Skip ensureMigrations
    service.migrationsRun = true;

    try {
      await service.getAvailableOrderItemsForInvoicing('comp-1', {});
    } catch { /* may fail due to mocks, that's fine */ }

    // Verify the query includes all 4 CTEs
    const mainQuery = executedQueries.find(q => q.includes('item_invoiced') && q.includes('item_delivered'));
    expect(mainQuery).toBeDefined();
    expect(mainQuery).toContain('item_delivered');
    expect(mainQuery).toContain('item_invoiced_via_remito');
    expect(mainQuery).toContain('item_remito_info');
    expect(mainQuery).toContain('qty_available_direct');
    expect(mainQuery).toContain('remito_info');
  });
});
