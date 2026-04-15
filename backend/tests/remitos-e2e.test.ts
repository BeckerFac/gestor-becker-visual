/**
 * E2E integration tests for Remitos endpoints (Plan 12)
 * Simulates HTTP calls by invoking the service layer directly
 * with mocked DB, verifying SQL queries and data flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPoolQuery, resetMocks } from './helpers/setup';
import { pool } from '../src/config/db';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ═══════════════════════════════════════════════════════════════════
// FLOW 1: Crear pedido → crear remito desde pedido
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 1: Pedido → Remito', () => {
  beforeEach(() => resetMocks());

  it('creates remito from order and updates qty_delivered', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        // FOR UPDATE lock
        if (sql.includes('FOR UPDATE')) {
          return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-1' }] };
        }
        if (sql.includes('SELECT order_id FROM order_items')) return { rows: [{ order_id: 'ord-1' }] };
        if (sql.includes('SELECT id FROM orders WHERE id =')) return { rows: [{ id: 'ord-1' }] };
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

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [
        { product_name: 'Pintura', quantity: 5, order_item_id: 'oi-1' },
      ],
    });

    expect(result.id).toBeDefined();
    expect(result.remito_number).toBe(1);

    // Should have: BEGIN, lock, insert remito, insert item, update qty_delivered, get order_id, insert remito_orders, COMMIT
    const beginQuery = executedQueries.find(q => q.sql === 'BEGIN');
    const commitQuery = executedQueries.find(q => q.sql === 'COMMIT');
    expect(beginQuery).toBeDefined();
    expect(commitQuery).toBeDefined();

    const lockQuery = executedQueries.find(q => q.sql.includes('FOR UPDATE OF oi'));
    expect(lockQuery).toBeDefined();

    const insertRemito = executedQueries.find(q => q.sql.includes('INSERT INTO remitos'));
    expect(insertRemito).toBeDefined();

    const insertItem = executedQueries.find(q => q.sql.includes('INSERT INTO remito_items'));
    expect(insertItem).toBeDefined();
    // Verify no invoice_item_id column
    expect(insertItem!.sql).not.toContain('invoice_item_id');

    const updateQty = executedQueries.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered') && q.params?.includes(5)
    );
    expect(updateQty).toBeDefined();

    const insertRemitoOrder = executedQueries.find(q => q.sql.includes('INSERT INTO remito_orders'));
    expect(insertRemitoOrder).toBeDefined();
  });

  it('rejects remito exceeding available qty', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FOR UPDATE')) {
          // Only 3 available (10 total - 7 delivered)
          return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 7, enterprise_id: 'ent-1' }] };
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
      items: [{ product_name: 'Pintura', quantity: 5, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/No se pueden remitar 5/);
  });

  it('rejects cross-enterprise items', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FOR UPDATE')) {
          // Item belongs to DIFFERENT enterprise
          return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-OTHER' }] };
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
      items: [{ product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/otra empresa|distintas empresas/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 2: Remito con item manual → stock deduction
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 2: Manual item with stock control', () => {
  beforeEach(() => resetMocks());

  it('deducts stock when product controls_stock=true', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FROM products WHERE id')) return { rows: [{ id: 'prod-1', controls_stock: true }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        if (sql.includes('SELECT quantity FROM stock')) return { rows: [{ quantity: '100' }] };
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
      items: [{ product_name: 'Pintura', quantity: 3, product_id: 'prod-1' }],
    });

    // Should have stock_movements insert with salida
    const stockMov = executedQueries.find(q =>
      q.sql.includes('INSERT INTO stock_movements') && q.sql.includes("'sale'")
    );
    expect(stockMov).toBeDefined();
    expect(stockMov!.params).toContain(-3); // negative qty for salida

    // Should have stock update (subtract)
    const stockUpdate = executedQueries.find(q =>
      q.sql.includes('UPDATE stock SET quantity = COALESCE(quantity, 0) - $1')
    );
    expect(stockUpdate).toBeDefined();
  });

  it('does NOT deduct stock if product does not control stock', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FROM products WHERE id')) return { rows: [{ id: 'prod-service', controls_stock: false }] };
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
      items: [{ product_name: 'Servicio', quantity: 1, product_id: 'prod-service' }],
    });

    const stockMov = executedQueries.find(q => q.sql.includes('INSERT INTO stock_movements'));
    expect(stockMov).toBeUndefined();
  });

  it('accepts manual item without product_id (plain text)', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
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

    const result = await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Muestra gratis', quantity: 1 }],
    });

    expect(result.id).toBeDefined();
    // No stock_movements query
    expect(executedQueries.find(q => q.sql.includes('stock_movements'))).toBeUndefined();
    // No products query
    expect(executedQueries.find(q => q.sql.includes('SELECT controls_stock'))).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 3: Anular remito → revierte qty_delivered + stock
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 3: Anular remito', () => {
  beforeEach(() => resetMocks());

  it('reverts qty_delivered and marks as anulado', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [{ id: 'rem-1', status: 'pendiente' }] };
        if (sql.includes('SELECT id, order_item_id, product_id, quantity FROM remito_items')) {
          return { rows: [
            { id: 'ri-1', order_item_id: 'oi-1', product_id: null, quantity: 3 },
            { id: 'ri-2', order_item_id: 'oi-2', product_id: null, quantity: 2 },
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

    const result = await service.anularRemito('comp-1', 'rem-1', 'user-1');
    expect(result.status).toBe('anulado');

    // Should have 2 qty_delivered reverts
    const reverts = executedQueries.filter(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered = GREATEST')
    );
    expect(reverts).toHaveLength(2);

    // Should have UPDATE remitos SET status = 'anulado'
    const statusUpdate = executedQueries.find(q =>
      q.sql.includes('UPDATE remitos SET status') && q.sql.includes('anulado')
    );
    expect(statusUpdate).toBeDefined();

    // Should NOT DELETE remito
    expect(executedQueries.find(q => q.sql.includes('DELETE FROM remitos'))).toBeUndefined();
  });

  it('returns stock for manual items with controls_stock', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [{ id: 'rem-1', status: 'pendiente' }] };
        if (sql.includes('SELECT id, order_item_id, product_id, quantity FROM remito_items')) {
          return { rows: [{ id: 'ri-1', order_item_id: null, product_id: 'prod-1', quantity: 5 }] };
        }
        if (sql.includes('SELECT controls_stock')) return { rows: [{ controls_stock: true }] };
        if (sql.includes('FROM warehouses')) return { rows: [{ id: 'wh-1' }] };
        if (sql.includes('warehouse_id FROM stock_movements')) return { rows: [{ warehouse_id: 'wh-1' }] };
        if (sql.includes('SELECT quantity FROM stock')) return { rows: [{ quantity: '0' }] };
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

    // Stock movement ENTRADA (return)
    const stockRet = executedQueries.find(q =>
      q.sql.includes('INSERT INTO stock_movements') && q.sql.includes("'return_customer'")
    );
    expect(stockRet).toBeDefined();
    expect(stockRet!.params).toContain(5); // positive qty

    // Stock update ADD
    const stockUpdate = executedQueries.find(q =>
      q.sql.includes('UPDATE stock SET quantity = COALESCE(quantity, 0) + $1')
    );
    expect(stockUpdate).toBeDefined();
  });

  it('rejects anulacion of already anulado remito', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [{ id: 'rem-1', status: 'anulado' }] };
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

    await expect(service.anularRemito('comp-1', 'rem-1', 'user-1')).rejects.toThrow(/ya esta anulado/);
  });

  it('rejects anulacion of non-existent remito', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [] };
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

    await expect(service.anularRemito('comp-1', 'rem-1', 'user-1')).rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 4: Invoice → Remito (resolve to order_items)
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 4: getInvoiceItemsForRemito', () => {
  beforeEach(() => resetMocks());

  it('returns invoice items resolved to order_items with qty_available', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: '11111111-1111-1111-1111-111111111111', status: 'authorized' }] };
      }
      if (sql.includes('invoice_items') && sql.includes('qty_available')) {
        return {
          rows: [
            {
              invoice_item_id: 'ii-1',
              product_name: 'Pintura',
              invoice_qty: '3',
              unit_price: '1000',
              vat_rate: 21,
              order_item_id: 'oi-1',
              enterprise_id: 'ent-1',
              qty_available: '3',
              source_ref: 'Pedido #0001',
              order_id: 'ord-1',
            },
            {
              invoice_item_id: 'ii-2',
              product_name: 'Servicio',
              invoice_qty: '1',
              unit_price: '500',
              vat_rate: 21,
              order_item_id: null,
              enterprise_id: 'ent-1',
              qty_available: '1',
              source_ref: 'Manual',
              order_id: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const items = await service.getInvoiceItemsForRemito('comp-1', '11111111-1111-1111-1111-111111111111');
    expect(items).toHaveLength(2);
    expect(items[0].order_item_id).toBe('oi-1');
    expect(items[0].source_ref).toBe('Pedido #0001');
    expect(items[1].order_item_id).toBeNull();
    expect(items[1].source_ref).toBe('Manual');
  });

  it('filters out items with qty_available = 0', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, status FROM invoices')) {
        return { rows: [{ id: '11111111-1111-1111-1111-111111111111', status: 'authorized' }] };
      }
      if (sql.includes('invoice_items')) {
        return {
          rows: [
            { invoice_item_id: 'ii-1', product_name: 'P1', qty_available: '0' },
            { invoice_item_id: 'ii-2', product_name: 'P2', qty_available: '5' },
          ],
        };
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const items = await service.getInvoiceItemsForRemito('comp-1', '11111111-1111-1111-1111-111111111111');
    expect(items).toHaveLength(1);
    expect(items[0].invoice_item_id).toBe('ii-2');
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 5: Availability queries
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 5: Availability queries', () => {
  beforeEach(() => resetMocks());

  it('getAvailableOrderItemsForRemito filters out fully delivered items', async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('order_items') && sql.includes('qty_available')) {
        // Query has WHERE qty > qty_delivered filter, so mock only available items
        return {
          rows: [
            { order_item_id: 'oi-1', product_name: 'Pintura', quantity: 10, qty_delivered: 3, qty_available: 7 },
          ],
        };
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const items = await service.getAvailableOrderItemsForRemito('comp-1', 'ord-1');
    expect(items).toHaveLength(1);
    expect(items[0].qty_available).toBe(7);
  });

  it('getAvailableOrderItemsForRemitoByEnterprise groups by enterprise', async () => {
    mockPoolQuery.mockImplementation(async (sql: string, params: any) => {
      if (sql.includes('SELECT id FROM enterprises WHERE id')) return { rows: [{ id: 'ent-1' }] };
      if (sql.includes('enterprise_id = $2')) {
        expect(params).toEqual(['comp-1', 'ent-1']);
        return {
          rows: [
            { order_item_id: 'oi-1', order_number: 1, order_title: 'Pedido 1', qty_available: 5 },
            { order_item_id: 'oi-2', order_number: 2, order_title: 'Pedido 2', qty_available: 10 },
          ],
        };
      }
      return { rows: [] };
    });

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const items = await service.getAvailableOrderItemsForRemitoByEnterprise('comp-1', 'ent-1');
    expect(items).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 6: Empty items validation
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 6: Validation edge cases', () => {
  beforeEach(() => resetMocks());

  it('rejects remito with no items', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
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
      items: [],
    })).rejects.toThrow(/al menos un item/);
  });

  it('rejects remito with items missing product_name', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
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
      items: [{ product_name: '', quantity: 1 }, { product_name: '   ', quantity: 2 }],
    })).rejects.toThrow(/product_name no vacio|al menos un item/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 7: getRemito with items and source_ref
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 7: getRemito returns items with source_ref', () => {
  beforeEach(() => resetMocks());

  it('returns remito with items having source_ref and no invoice_item_id column', async () => {
    let callNum = 0;
    mockPoolQuery.mockImplementation(async (sql: string) => {
      callNum++;
      // Check that query does NOT reference deleted columns
      if (sql.includes('remito_items')) {
        expect(sql).not.toContain('invoice_item_id');
        expect(sql).not.toContain('remito_item_id = ri.id');
      }
      if (sql.includes('FROM remito_items') && sql.includes('source_ref')) {
        return {
          rows: [
            { id: 'ri-1', product_name: 'Pintura', quantity: 5, order_item_id: 'oi-1', source_ref: 'Pedido #0001' },
            { id: 'ri-2', product_name: 'Muestra', quantity: 1, order_item_id: null, source_ref: 'Manual' },
          ],
        };
      }
      return { rows: [] };
    });

    // Mock db.execute for header query
    const { mockDbExecute } = await import('./helpers/setup');
    mockDbExecute.mockImplementation(async () => ({
      rows: [{ id: 'rem-1', remito_number: 1, enterprise_id: 'ent-1' }],
    }));

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const remito = await service.getRemito('comp-1', 'rem-1');
    expect(remito.items).toHaveLength(2);
    expect(remito.items[0].source_ref).toBe('Pedido #0001');
    expect(remito.items[1].source_ref).toBe('Manual');
  });

  // PR7-T18: validar que la query de getRemito calcula qty_pending_to_invoice
  // usando subqueries con GREATEST/LEAST y excluyendo facturas canceladas + NCs.
  it('query includes qty_pending_to_invoice calculation excluding cancelled + NCs', async () => {
    let capturedSql = '';
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM remito_items') && sql.includes('source_ref')) {
        capturedSql = sql;
        return {
          rows: [{
            id: 'ri-1',
            product_name: 'Pintura',
            quantity: 5,
            order_item_id: 'oi-1',
            source_ref: 'Pedido #0001',
            order_item_total: '10',
            order_item_invoiced: '5',
            qty_pending_to_invoice: '0', // 5 remito, 5 ya facturadas → 0 pending
          }],
        };
      }
      return { rows: [] };
    });

    const { mockDbExecute } = await import('./helpers/setup');
    mockDbExecute.mockImplementation(async () => ({
      rows: [{ id: 'rem-1', remito_number: 1, enterprise_id: 'ent-1' }],
    }));

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    const remito = await service.getRemito('comp-1', 'rem-1');

    // La query debe referenciar qty_pending_to_invoice
    expect(capturedSql).toContain('qty_pending_to_invoice');
    expect(capturedSql).toContain('order_item_total');
    expect(capturedSql).toContain('order_item_invoiced');
    // Excluye canceladas y NCs
    expect(capturedSql).toContain("status != 'cancelled'");
    expect(capturedSql).toContain("invoice_type::text NOT LIKE 'NC%'");
    // Usa GREATEST/LEAST para clamp
    expect(capturedSql).toMatch(/GREATEST|LEAST/);

    // El item debe tener el valor calculado
    expect(remito.items[0].qty_pending_to_invoice).toBe('0');
  });
});

// ═══════════════════════════════════════════════════════════════════
// FLOW 8: Stock decrement for order-linked items (PR7-T11 BUGFIX)
// ═══════════════════════════════════════════════════════════════════

describe('E2E Flow 8: order_item stock decrement', () => {
  beforeEach(() => resetMocks());

  // Helper: build a mock client for order_item-linked remito creation.
  // Simulates product lookup + stock FOR UPDATE based on a scenario map.
  function buildClient(scenario: {
    orderItemProductId: string | null;
    controlsStock?: boolean;
    currentStock?: number;
    hasWarehouse?: boolean;
    hasStockRow?: boolean;
  }) {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FOR UPDATE OF oi')) {
          return {
            rows: [{
              id: 'oi-1', quantity: 10, qty_delivered: 0,
              enterprise_id: 'ent-1', order_id: 'ord-1',
            }],
          };
        }
        if (sql.includes('SELECT product_id FROM order_items')) {
          return { rows: [{ product_id: scenario.orderItemProductId }] };
        }
        if (sql.includes('FROM products WHERE id')) {
          return { rows: [{ id: scenario.orderItemProductId, controls_stock: scenario.controlsStock ?? false }] };
        }
        if (sql.includes('FROM warehouses')) {
          return { rows: scenario.hasWarehouse === false ? [] : [{ id: 'wh-1' }] };
        }
        if (sql.includes('SELECT quantity FROM stock') && sql.includes('FOR UPDATE')) {
          return {
            rows: scenario.hasStockRow === false
              ? []
              : [{ quantity: String(scenario.currentStock ?? 100) }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    return { mockClient, executedQueries };
  }

  function mockBasePool() {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql?.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      if (sql?.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
      return { rows: [] };
    });
  }

  it('decrements stock when order_item product has controls_stock=true', async () => {
    const { mockClient, executedQueries } = buildClient({
      orderItemProductId: 'prod-1',
      controlsStock: true,
      currentStock: 100,
    });
    mockBasePool();
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 3, order_item_id: 'oi-1' }],
    });

    // qty_delivered still updated
    const updateQty = executedQueries.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered') && q.params?.includes(3)
    );
    expect(updateQty).toBeDefined();

    // Stock movement logged with 'sale' + reference_type='remito' + negative qty
    const stockMov = executedQueries.find(q =>
      q.sql.includes('INSERT INTO stock_movements') && q.sql.includes("'sale'") && q.sql.includes("'remito'")
    );
    expect(stockMov).toBeDefined();
    expect(stockMov!.params).toContain(-3);

    // Stock row double-written (quantity AND quantity_num)
    const stockUpdate = executedQueries.find(q =>
      q.sql.includes('UPDATE stock SET quantity') && q.sql.includes('quantity_num')
    );
    expect(stockUpdate).toBeDefined();

    // remito_items INSERT must persist the resolved product_id (so anular can revert)
    const insertRi = executedQueries.find(q => q.sql.includes('INSERT INTO remito_items'));
    expect(insertRi).toBeDefined();
    expect(insertRi!.params).toContain('prod-1');

    // FOR UPDATE lock on stock row
    const lockStock = executedQueries.find(q =>
      q.sql.includes('SELECT quantity FROM stock') && q.sql.includes('FOR UPDATE')
    );
    expect(lockStock).toBeDefined();
  });

  it('does NOT touch stock when order_item product has controls_stock=false', async () => {
    const { mockClient, executedQueries } = buildClient({
      orderItemProductId: 'prod-service',
      controlsStock: false,
    });
    mockBasePool();
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Servicio', quantity: 1, order_item_id: 'oi-1' }],
    });

    // qty_delivered updated
    const updateQty = executedQueries.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered')
    );
    expect(updateQty).toBeDefined();

    // No stock_movements insert, no stock UPDATE
    expect(executedQueries.find(q =>
      q.sql.includes('INSERT INTO stock_movements') && q.sql.includes("'sale'")
    )).toBeUndefined();
    expect(executedQueries.find(q => q.sql.includes('UPDATE stock SET quantity'))).toBeUndefined();
  });

  it('rejects with 400 when stock insufficient for order-linked item', async () => {
    const { mockClient } = buildClient({
      orderItemProductId: 'prod-1',
      controlsStock: true,
      currentStock: 2, // only 2 available, requesting 5
    });
    mockBasePool();
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 5, order_item_id: 'oi-1' }],
    })).rejects.toThrow(/Stock insuficiente.*Disponible: 2.*solicitado: 5/);
  });

  it('skips stock when order_item.product_id is NULL (ad-hoc order item)', async () => {
    const { mockClient, executedQueries } = buildClient({
      orderItemProductId: null,
    });
    mockBasePool();
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Ad-hoc', quantity: 2, order_item_id: 'oi-1' }],
    });

    // qty_delivered updated
    expect(executedQueries.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered')
    )).toBeDefined();

    // No products lookup, no stock queries
    expect(executedQueries.find(q => q.sql.includes('FROM products WHERE id'))).toBeUndefined();
    expect(executedQueries.find(q => q.sql.includes('INSERT INTO stock_movements'))).toBeUndefined();

    // remito_items row has NULL product_id
    const insertRi = executedQueries.find(q => q.sql.includes('INSERT INTO remito_items'));
    expect(insertRi!.params![2]).toBeNull();
  });

  it('uses FOR UPDATE lock on stock row to serialize concurrent remitos', async () => {
    // Two sequential createRemito calls against the same mock client —
    // both must issue FOR UPDATE on the stock row before updating.
    const { mockClient, executedQueries } = buildClient({
      orderItemProductId: 'prod-1',
      controlsStock: true,
      currentStock: 100,
    });
    mockBasePool();
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 1, order_item_id: 'oi-1' }],
    });
    await service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Pintura', quantity: 1, order_item_id: 'oi-1' }],
    });

    const lockQueries = executedQueries.filter(q =>
      q.sql.includes('SELECT quantity FROM stock') && q.sql.includes('FOR UPDATE')
    );
    expect(lockQueries.length).toBe(2);
  });

  it('anular reverts stock for order-linked item via existing return_customer path', async () => {
    // Simulates an anulacion where the remito_item has BOTH order_item_id AND product_id
    // (the new behavior: createRemito now persists resolvedProductId on remito_items).
    // The existing anularRemito query filters by product_id, so the revert must fire.
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('SELECT id, status FROM remitos')) return { rows: [{ id: 'rem-1', status: 'pendiente' }] };
        if (sql.includes('SELECT id, order_item_id, product_id, quantity FROM remito_items')) {
          return { rows: [
            // order-linked AND product-bound — new behavior
            { id: 'ri-1', order_item_id: 'oi-1', product_id: 'prod-1', quantity: 3 },
          ]};
        }
        if (sql.includes('warehouse_id FROM stock_movements')) return { rows: [{ warehouse_id: 'wh-1' }] };
        if (sql.includes('SELECT quantity FROM stock')) return { rows: [{ quantity: '0' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockBasePool();
    (pool.connect as any).mockResolvedValue(mockClient);

    const { RemitosService } = await import('../src/modules/remitos/remitos.service');
    const service = new (RemitosService as any)();
    service.tablesEnsured = true;

    await service.anularRemito('comp-1', 'rem-1', 'user-1');

    // qty_delivered reverted
    expect(executedQueries.find(q =>
      q.sql.includes('UPDATE order_items SET qty_delivered = GREATEST')
    )).toBeDefined();

    // Stock movement ENTRADA (return_customer) for the order-linked item
    const stockRet = executedQueries.find(q =>
      q.sql.includes('INSERT INTO stock_movements') && q.sql.includes("'return_customer'")
    );
    expect(stockRet).toBeDefined();
    expect(stockRet!.params).toContain(3); // positive qty revert

    // Stock row ADDED back
    expect(executedQueries.find(q =>
      q.sql.includes('UPDATE stock SET quantity = COALESCE(quantity, 0) + $1')
    )).toBeDefined();
  });
});
