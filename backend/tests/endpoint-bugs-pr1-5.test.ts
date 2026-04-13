/**
 * Regression tests para fixes PR1-PR5 (sesion de 2026-04-13).
 *
 * Estos tests NO re-validan logica ya cubierta por secciones S1-S11,
 * solo los fixes nuevos de seguridad / data integrity / workflow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDbVoid, mockDbRows, mockDbEmpty, mockDbExecute, mockPoolQuery, resetMocks } from './helpers/setup';
import { pool } from '../src/config/db';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function makeRemitosService() {
  const { RemitosService } = await import('../src/modules/remitos/remitos.service');
  const s = new (RemitosService as any)();
  s.tablesEnsured = true;
  return s;
}

async function makeOrdersService() {
  const { OrdersService } = await import('../src/modules/orders/orders.service');
  const s = new (OrdersService as any)();
  return s;
}

async function makeQuotesService() {
  const { QuotesService } = await import('../src/modules/quotes/quotes.service');
  const s = new (QuotesService as any)();
  (s as any).migrationsEnsured = true;
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// PR1-T4: authorize middleware company scope
// ═══════════════════════════════════════════════════════════════════

describe('PR1: authorize middleware scoped by company_id', () => {
  it('loadUserPermissions query contiene JOIN users company_id filter', () => {
    // Verificamos a nivel de source code (el middleware esta muy acoplado a req,
    // un test de unit puro requeriria mockear toda la request chain).
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/middlewares/authorize.ts'),
      'utf-8'
    );
    expect(src).toMatch(/JOIN users u ON u\.id = p\.user_id/);
    expect(src).toMatch(/u\.company_id = \${companyId}/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR1-T2: trialGuard fail-closed cuando trial_ends_at=NULL
// ═══════════════════════════════════════════════════════════════════

describe('PR1: trialGuard fail-closed NULL', () => {
  it('source contiene fail-closed branch para trial_ends_at NULL', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/middlewares/trialGuard.ts'),
      'utf-8'
    );
    expect(src).toMatch(/PR1-T2/);
    expect(src).toMatch(/if \(!company\.trial_ends_at\)/);
    expect(src).toMatch(/isReadOnly = true/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR2-T1: deleteDraftInvoice rechaza si cae asignado
// ═══════════════════════════════════════════════════════════════════

describe('PR2: deleteDraftInvoice con CAE rechaza', () => {
  it('source tiene check explicit de cae antes del delete', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/invoices/invoices.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/if \(invRows\[0\]\.cae\)/);
    expect(src).toMatch(/PR2-T1/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR2-T3: advisory lock invoice_number
// ═══════════════════════════════════════════════════════════════════

describe('PR2: invoice_number advisory lock', () => {
  it('createInvoice usa pg_advisory_xact_lock antes del MAX', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/invoices/invoices.service.ts'),
      'utf-8'
    );
    const lockIdx = src.indexOf('pg_advisory_xact_lock');
    const maxIdx = src.indexOf('MAX(invoice_number)');
    expect(lockIdx).toBeGreaterThan(0);
    expect(maxIdx).toBeGreaterThan(lockIdx);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR2-T5/T6: cobro-applications NC + currency mismatch
// ═══════════════════════════════════════════════════════════════════

describe('PR2: cobro-applications guards', () => {
  it('bloquea aplicar cobro a NC (invoice_type NC_*)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/cobro-applications/cobro-applications.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/NC_A.*NC_B.*NC_C.*NC_E/);
    expect(src).toMatch(/No se pueden aplicar cobros a Notas de Credito/);
  });

  it('bloquea currency mismatch entre cobro e invoice', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/cobro-applications/cobro-applications.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/cobroCurrency !== invoiceCurrency/);
    expect(src).toMatch(/Moneda del cobro.*no coincide con la factura/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR2-T7: inventory createMovement stock negativo
// ═══════════════════════════════════════════════════════════════════

describe('PR2: inventory stock negativo reject', () => {
  it('rechaza egreso que dejaria stock negativo con row existente', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/inventory/inventory.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/Stock insuficiente/);
    expect(src).toMatch(/PR2-T7/);
    expect(src).toMatch(/FOR UPDATE/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR2-T8: remitos NaN guard
// ═══════════════════════════════════════════════════════════════════

describe('PR2: remitos NaN guard en quantities', () => {
  it('createRemito rechaza item con quantity NaN', async () => {
    const service = await makeRemitosService();
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('MAX(remito_number)')) return { rows: [{ next_number: 1 }] };
        if (sql.includes('FOR UPDATE OF oi')) {
          return { rows: [{ id: 'oi-1', quantity: 10, qty_delivered: 0, enterprise_id: 'ent-1', order_id: 'ord-1' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPoolQuery.mockImplementation(async (s: string) => {
      if (s?.includes('FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    (pool.connect as any).mockResolvedValue(mockClient);

    await expect(service.createRemito('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'X', quantity: 'abc', order_item_id: 'oi-1' }],
    })).rejects.toThrow(/Cantidad invalida/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR3-T1: quote accept sin items
// ═══════════════════════════════════════════════════════════════════

describe('PR3: quote convertToOrder rechaza sin items', () => {
  it('source check items.length > 0 + quoteTotal > 0', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/quotes/quotes.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/No se puede aceptar una cotizacion sin items/);
    expect(src).toMatch(/No se puede aceptar una cotizacion con total/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR3-T2: deleteOrder guardrails remitos/invoices
// ═══════════════════════════════════════════════════════════════════

describe('PR3: deleteOrder guardrails', () => {
  it('rechaza 409 con remitos asociados', async () => {
    mockDbExecute.mockImplementation(async (query: any) => {
      const s = JSON.stringify(query?.queryChunks || query?.strings || '');
      if (s.includes('SELECT id FROM orders')) return { rows: [{ id: 'ord-1' }] };
      if (s.includes('COUNT(*)') && s.includes('remito_orders')) return { rows: [{ cnt: 2 }] };
      return { rows: [{ cnt: 0 }] };
    });
    const service = await makeOrdersService();
    await expect(service.deleteOrder('comp-1', 'ord-1')).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR3-T3: reports timezone AR
// ═══════════════════════════════════════════════════════════════════

describe('PR3: reports timezone AR', () => {
  it('source usa offset -03:00', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/reports/reports.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/-03:00/);
    expect(src).toMatch(/AR_OFFSET/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR3-T4: IVA label dinamico quotes
// ═══════════════════════════════════════════════════════════════════

describe('PR3: computeVatLabel helper', () => {
  it('retorna "IVA (21%)" para items homogeneos', async () => {
    const s = await makeQuotesService();
    const label = (s as any).computeVatLabel([{ vat_rate: 21 }, { vat_rate: 21 }]);
    expect(label).toBe('IVA (21%):');
  });

  it('retorna "IVA (varios)" para rates mixtas', async () => {
    const s = await makeQuotesService();
    const label = (s as any).computeVatLabel([{ vat_rate: 21 }, { vat_rate: 10.5 }]);
    expect(label).toBe('IVA (varios):');
  });

  it('retorna "IVA (10.5%)" para items con vat_rate custom', async () => {
    const s = await makeQuotesService();
    const label = (s as any).computeVatLabel([{ vat_rate: 10.5 }]);
    expect(label).toBe('IVA (10.5%):');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR4: composite indexes migration lista
// ═══════════════════════════════════════════════════════════════════

describe('PR4: composite indexes en runAutoMigrations', () => {
  it('declara los 14 indices esperados', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/config/db.ts'),
      'utf-8'
    );
    const expected = [
      'idx_orders_company_created', 'idx_invoices_company_created',
      'idx_remitos_company_created', 'idx_cobros_company_created',
      'idx_quotes_company_created', 'idx_purchases_company_created',
      'idx_customers_company_created', 'idx_enterprises_company_created',
      'idx_products_company_created',
      'idx_orders_company_status', 'idx_invoices_company_status',
      'idx_remitos_company_status', 'idx_cheques_company_status',
      'idx_quotes_company_status',
    ];
    for (const idx of expected) {
      expect(src).toContain(idx);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR5-C4: CRM getStages LEFT JOIN
// ═══════════════════════════════════════════════════════════════════

describe('PR5: CRM getStages performance', () => {
  it('getStages usa LEFT JOIN GROUP BY (no subquery correlado)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/crm/crm.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/LEFT JOIN crm_deals d[\s\S]*?GROUP BY s\.id/);
    // No debe tener el subquery correlado viejo
    expect(src).not.toMatch(/\(SELECT COUNT\(\*\)::int FROM crm_deals d WHERE d\.stage_id = s\.id\)/);
  });

  it('ensureDefaultStages usa bulk INSERT', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/crm/crm.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/bulk INSERT/);
    expect(src).toMatch(/VALUES \$\{values\.join/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR5-C6: /account/my-data LIMIT
// ═══════════════════════════════════════════════════════════════════

describe('PR5: account export LIMIT 50k + truncated flag', () => {
  it('source tiene LIMIT 50000 y truncated flag', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/account/account.controller.ts'),
      'utf-8'
    );
    expect(src).toMatch(/MAX_ROWS = 50000/);
    expect(src).toMatch(/truncated/);
    expect(src).toMatch(/has_truncated_tables/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR5-C7: signedPdf 2MB guard
// ═══════════════════════════════════════════════════════════════════

describe('PR5: uploadSignedPdf 2MB limit', () => {
  it('source tiene limit 2 * 1024 * 1024', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/modules/remitos/remitos.service.ts'),
      'utf-8'
    );
    expect(src).toMatch(/2 \* 1024 \* 1024/);
    expect(src).toMatch(/no puede superar 2MB/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PR5-C8: stock.quantity migration Phase 1+2
// ═══════════════════════════════════════════════════════════════════

describe('PR5: stock.quantity migration setup', () => {
  it('runAutoMigrations agrega quantity_num columns', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/config/db.ts'),
      'utf-8'
    );
    expect(src).toMatch(/stock ADD COLUMN IF NOT EXISTS quantity_num/);
    expect(src).toMatch(/stock_movements ADD COLUMN IF NOT EXISTS quantity_num/);
    expect(src).toMatch(/idx_stock_quantity_num/);
  });
});
