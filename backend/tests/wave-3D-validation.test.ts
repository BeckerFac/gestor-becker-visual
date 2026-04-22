/**
 * Wave 3D — validation + IDOR + state machine tests.
 *
 * Covers:
 *   D1  products.bulkUpdatePrice IDOR pre-check
 *   D2  orders.updateOrder numeric item validation (NaN / negative / overflow)
 *   D4  pagos.exchange_rate validation
 *   D5  cobros retenciones: reject rate > 30 + consistency amount = base*rate/100
 *   D6  orders.updateOrderStatus state machine + locked_at guard
 *   D7  quotes.updateQuoteStatus state machine (terminal states)
 *   D8  enterprises.default_discount cap 0-100
 *   D9  enterprises/customers length caps
 *   D10 customers email regex
 *   D11 invoices empty items array rejected
 *   D12 invoices invoice_type whitelist
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mockDbExecute,
  mockPoolQuery,
  mockClientQuery,
  mockDbRows,
  mockDbEmpty,
  mockDbVoid,
  resetMocks,
} from './helpers/setup';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────
// D1: products.bulkUpdatePrice IDOR
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D1 — products.bulkUpdatePrice IDOR', () => {
  beforeEach(() => resetMocks());

  async function makeService() {
    const { ProductsService } = await import('../src/modules/products/products.service');
    return new ProductsService();
  }

  it('rechaza product_ids que no pertenecen a la compania (403)', async () => {
    const service = await makeService();
    // pool.query returns only p1 as valid for company-1; p2 belongs to another tenant.
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

    await expect(
      service.bulkUpdatePrice('company-1', ['p1', 'p2'], 10)
    ).rejects.toThrow(/Producto ajeno/);
  });

  it('acepta cuando TODOS los ids pertenecen a la compania', async () => {
    const service = await makeService();
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }] });
    mockDbVoid();
    mockDbVoid();

    const result = await service.bulkUpdatePrice('company-1', ['p1', 'p2'], 10);
    expect(result.updated).toBe(2);
  });

  it('valida ANTES de cualquier UPDATE (no toca DB si hay ajeno)', async () => {
    const service = await makeService();
    // Only p1 belongs to company; p2 is foreign.
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

    await expect(
      service.bulkUpdatePrice('company-1', ['p1', 'p2'], 10)
    ).rejects.toThrow();
    // No UPDATE db.execute call should have happened.
    expect(mockDbExecute).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// D2: orders numeric item validation (via exported helper)
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D2 — validateOrderItem', () => {
  it('rechaza quantity NaN', async () => {
    const { validateOrderItem } = await import('../src/modules/orders/orders.service');
    expect(() =>
      validateOrderItem({ product_name: 'X', quantity: 'abc', unit_price: 10 })
    ).toThrow(/Cantidad invalida/);
  });

  it('rechaza quantity <= 0', async () => {
    const { validateOrderItem } = await import('../src/modules/orders/orders.service');
    expect(() =>
      validateOrderItem({ product_name: 'X', quantity: 0, unit_price: 10 })
    ).toThrow(/Cantidad invalida/);
    expect(() =>
      validateOrderItem({ product_name: 'X', quantity: -1, unit_price: 10 })
    ).toThrow(/Cantidad invalida/);
  });

  it('rechaza unit_price negativo', async () => {
    const { validateOrderItem } = await import('../src/modules/orders/orders.service');
    expect(() =>
      validateOrderItem({ product_name: 'X', quantity: 1, unit_price: -5 })
    ).toThrow(/Precio unitario invalido/);
  });

  it('rechaza unit_price > 99_999_999.99 (overflow DECIMAL(12,2))', async () => {
    const { validateOrderItem, MAX_ITEM_UNIT_PRICE } = await import(
      '../src/modules/orders/orders.service'
    );
    expect(MAX_ITEM_UNIT_PRICE).toBe(99_999_999.99);
    expect(() =>
      validateOrderItem({ product_name: 'X', quantity: 1, unit_price: 100_000_000 })
    ).toThrow(/excede el maximo/);
  });

  it('acepta item valido', async () => {
    const { validateOrderItem } = await import('../src/modules/orders/orders.service');
    expect(() =>
      validateOrderItem({ product_name: 'X', quantity: 1, unit_price: 100, vat_rate: 21 })
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// D5: cobros retenciones > 30 + consistency
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D5 — cobros retencion validaciones', () => {
  beforeEach(() => resetMocks());

  async function makeCobros() {
    const { CobrosService } = await import('../src/modules/cobros/cobros.service');
    const service = new (CobrosService as any)();
    service.tablesEnsured = true;
    return service;
  }

  it('rechaza retencion con rate > 30 (era solo warning)', async () => {
    const service = await makeCobros();
    // The service validates method payload + retencion BEFORE the DB tx,
    // so a failed retencion rate throws through the outer try.
    await expect(
      service.createCobro(
        'company-1',
        'user-1',
        {
          enterprise_id: 'ent-1',
          payment_methods: [{ method: 'efectivo', amount: 100 }],
          retenciones_sufridas: [
            { type: 'iibb', rate: 50, base_amount: 100, amount: 50 },
          ],
        },
        { userCanAccessLuna: false }
      )
    ).rejects.toThrow(/rate.*excede el maximo|rate.*30/i);
  });

  it('rechaza retencion cuando amount no coincide con base*rate/100', async () => {
    const service = await makeCobros();
    // rate 5%, base 100 → expected 5. Send amount 50 (10x off) → inconsistent.
    await expect(
      service.createCobro(
        'company-1',
        'user-1',
        {
          enterprise_id: 'ent-1',
          payment_methods: [{ method: 'efectivo', amount: 100 }],
          retenciones_sufridas: [
            { type: 'iibb', rate: 5, base_amount: 100, amount: 50 },
          ],
        },
        { userCanAccessLuna: false }
      )
    ).rejects.toThrow(/inconsistente|excede el base/i);
  });
});

// ─────────────────────────────────────────────────────────────
// D6: orders updateOrderStatus state machine
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D6 — orders state machine', () => {
  beforeEach(() => resetMocks());

  async function makeOrders() {
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;
    return service;
  }

  it('VALID_ORDER_TRANSITIONS cubre todos los estados', async () => {
    const { VALID_ORDER_TRANSITIONS } = await import('../src/modules/orders/orders.service');
    expect(VALID_ORDER_TRANSITIONS.pendiente).toContain('en_produccion');
    expect(VALID_ORDER_TRANSITIONS.pendiente).toContain('cancelado');
    expect(VALID_ORDER_TRANSITIONS.entregado).toEqual([]);
    expect(VALID_ORDER_TRANSITIONS.cancelado).toEqual([]);
  });

  it('rechaza pendiente -> entregado (salto invalido)', async () => {
    const service = await makeOrders();
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id, status') && s.includes('FROM orders WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'o1', status: 'pendiente', locked_at: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.updateOrderStatus('company-1', 'user-1', 'o1', { status: 'entregado' })
    ).rejects.toThrow(/Transicion invalida/);
  });

  it('rechaza transiciones desde estado terminal (entregado)', async () => {
    const service = await makeOrders();
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id, status') && s.includes('FROM orders WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'o1', status: 'entregado', locked_at: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.updateOrderStatus('company-1', 'user-1', 'o1', { status: 'pendiente' })
    ).rejects.toThrow(/Transicion invalida|estado terminal/);
  });

  it('rechaza cambio de status cuando order esta locked (423)', async () => {
    const service = await makeOrders();
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id, status') && s.includes('FROM orders WHERE id')) {
        return Promise.resolve({
          rows: [{ id: 'o1', status: 'pendiente', locked_at: '2026-04-21T00:00:00Z' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.updateOrderStatus('company-1', 'user-1', 'o1', { status: 'en_produccion' })
    ).rejects.toMatchObject({ statusCode: 423 });
  });

  it('acepta transicion valida pendiente -> en_produccion', async () => {
    const service = await makeOrders();
    mockDbExecute.mockImplementation((...args: any[]) => {
      const tpl = args[0];
      const s = tpl?.strings ? tpl.strings.join('') : '';
      if (s.includes('SELECT id, status') && s.includes('FROM orders WHERE id')) {
        return Promise.resolve({ rows: [{ id: 'o1', status: 'pendiente', locked_at: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await service.updateOrderStatus('company-1', 'user-1', 'o1', {
      status: 'en_produccion',
    });
    expect(res.new_status).toBe('en_produccion');
  });
});

// ─────────────────────────────────────────────────────────────
// D7: quotes updateQuoteStatus state machine
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D7 — quotes state machine', () => {
  beforeEach(() => resetMocks());

  async function makeQuotes() {
    const { QuotesService } = await import('../src/modules/quotes/quotes.service');
    return new (QuotesService as any)();
  }

  it('rechaza newStatus totalmente invalido', async () => {
    const service = await makeQuotes();
    await expect(
      service.updateQuoteStatus('company-1', 'q-1', 'frobnicated')
    ).rejects.toThrow(/Invalid status/);
  });

  it('rechaza accepted -> sent (terminal)', async () => {
    const service = await makeQuotes();
    mockClientQuery.mockImplementation(async (sqlStr: string) => {
      if (sqlStr === 'BEGIN' || sqlStr === 'COMMIT' || sqlStr === 'ROLLBACK') return { rows: [] };
      if (sqlStr.includes('FOR UPDATE')) {
        return { rows: [{ id: 'q-1', status: 'accepted' }] };
      }
      return { rows: [] };
    });

    await expect(
      service.updateQuoteStatus('company-1', 'q-1', 'sent')
    ).rejects.toThrow(/Transicion de cotizacion invalida/);
  });

  it('rechaza rejected -> accepted (no resurrect)', async () => {
    const service = await makeQuotes();
    mockClientQuery.mockImplementation(async (sqlStr: string) => {
      if (sqlStr === 'BEGIN' || sqlStr === 'COMMIT' || sqlStr === 'ROLLBACK') return { rows: [] };
      if (sqlStr.includes('FOR UPDATE')) {
        return { rows: [{ id: 'q-1', status: 'rejected' }] };
      }
      return { rows: [] };
    });

    await expect(
      service.updateQuoteStatus('company-1', 'q-1', 'accepted')
    ).rejects.toThrow(/Transicion de cotizacion invalida/);
  });

  it('acepta rejected -> sent (reopen path)', async () => {
    const service = await makeQuotes();
    mockClientQuery.mockImplementation(async (sqlStr: string) => {
      if (sqlStr === 'BEGIN' || sqlStr === 'COMMIT' || sqlStr === 'ROLLBACK') return { rows: [] };
      if (sqlStr.includes('FOR UPDATE')) {
        return { rows: [{ id: 'q-1', status: 'rejected' }] };
      }
      if (sqlStr.includes('UPDATE quotes SET status')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await service.updateQuoteStatus('company-1', 'q-1', 'sent');
    expect(res.status).toBe('sent');
  });
});

// ─────────────────────────────────────────────────────────────
// D8 + D9: enterprises default_discount + length caps
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D8/D9 — enterprises validations', () => {
  beforeEach(() => resetMocks());

  async function makeEnterprises() {
    const { EnterprisesService } = await import('../src/modules/enterprises/enterprises.service');
    const service = new (EnterprisesService as any)();
    service.tablesEnsured = true;
    return service;
  }

  it('rechaza default_discount > 100', async () => {
    const service = await makeEnterprises();
    await expect(
      service.createEnterprise('company-1', {
        name: 'X',
        razon_social: 'X SRL',
        tax_condition: 'Responsable Inscripto',
        cuit: '20123456789',
        fiscal_address: 'Addr 1',
        default_discount: 150,
      })
    ).rejects.toThrow(/Descuento invalido/);
  });

  it('rechaza default_discount negativo', async () => {
    const service = await makeEnterprises();
    await expect(
      service.createEnterprise('company-1', {
        name: 'X',
        razon_social: 'X SRL',
        tax_condition: 'Responsable Inscripto',
        cuit: '20123456789',
        fiscal_address: 'Addr 1',
        default_discount: -5,
      })
    ).rejects.toThrow(/Descuento invalido/);
  });

  it('rechaza name > 255 chars', async () => {
    const service = await makeEnterprises();
    await expect(
      service.createEnterprise('company-1', {
        name: 'x'.repeat(256),
        razon_social: 'X SRL',
        tax_condition: 'Responsable Inscripto',
        cuit: '20123456789',
        fiscal_address: 'Addr 1',
      })
    ).rejects.toThrow(/nombre.*255/);
  });

  it('rechaza notes > 2000 chars', async () => {
    const service = await makeEnterprises();
    await expect(
      service.createEnterprise('company-1', {
        name: 'Valid Name',
        razon_social: 'X SRL',
        tax_condition: 'Responsable Inscripto',
        cuit: '20123456789',
        fiscal_address: 'Addr 1',
        notes: 'n'.repeat(2001),
      })
    ).rejects.toThrow(/notas.*2000/);
  });
});

// ─────────────────────────────────────────────────────────────
// D9 + D10: customers length caps + email
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D9/D10 — customers validations', () => {
  beforeEach(() => resetMocks());

  async function makeCustomers() {
    const { CustomersService } = await import('../src/modules/customers/customers.service');
    const service = new (CustomersService as any)();
    service.migrated = true;
    return service;
  }

  it('rechaza name > 255 chars', async () => {
    const service = await makeCustomers();
    await expect(
      service.createCustomer('company-1', { name: 'x'.repeat(256) })
    ).rejects.toThrow(/nombre.*255/);
  });

  it('rechaza email con formato invalido', async () => {
    const service = await makeCustomers();
    await expect(
      service.createCustomer('company-1', { name: 'X', email: 'not-an-email' })
    ).rejects.toThrow(/Email invalido/);
  });

  it('acepta email valido', async () => {
    const service = await makeCustomers();
    // createCustomer will try to hit DB after validations pass, so just
    // check we pass the email regex (fail later on drizzle mock is OK).
    // We assert that the "Email invalido" error is NOT thrown.
    await expect(
      service.createCustomer('company-1', { name: 'X', email: 'ok@example.com' })
    ).rejects.not.toThrow(/Email invalido/);
  });
});

// ─────────────────────────────────────────────────────────────
// D11: invoices empty items rejected
// D12: invoice_type whitelist
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D11/D12 — invoices validations', () => {
  beforeEach(() => resetMocks());

  async function makeInvoices() {
    const { InvoicesService } = await import('../src/modules/invoices/invoices.service');
    const service = new (InvoicesService as any)();
    service.migrationsRun = true;
    return service;
  }

  it('D11: rechaza items array vacio', async () => {
    const service = await makeInvoices();
    await expect(
      service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'A',
        items: [],
      })
    ).rejects.toThrow(/Al menos un item es requerido/);
  });

  it('D11: rechaza items ausente (undefined)', async () => {
    const service = await makeInvoices();
    await expect(
      service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'A',
      })
    ).rejects.toThrow(/Al menos un item es requerido/);
  });

  it('D12: rechaza invoice_type fuera del whitelist', async () => {
    const service = await makeInvoices();
    await expect(
      service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'Z',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
      })
    ).rejects.toThrow(/invoice_type invalido/);
  });

  it('D12: acepta invoice_type valido "A" (whitelist no rechaza)', async () => {
    const service = await makeInvoices();
    // The whitelist guard fires synchronously BEFORE any DB call; if "A"
    // were rejected we'd see that exact message. If downstream DB mocks
    // yield other errors (or the call resolves when mocks are minimal)
    // both outcomes confirm the whitelist did not trigger.
    let invoiceTypeErrorSeen = false;
    try {
      await service.createInvoice('company-1', 'user-1', {
        fiscal_type: 'fiscal',
        invoice_type: 'A',
        items: [{ product_name: 'X', unit_price: 100, quantity: 1 }],
      });
    } catch (err: any) {
      if (/invoice_type invalido/.test(err?.message || '')) invoiceTypeErrorSeen = true;
    }
    expect(invoiceTypeErrorSeen).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// D4: pagos exchange_rate validation
// ─────────────────────────────────────────────────────────────
describe('Wave 3D D4 — pagos exchange_rate', () => {
  beforeEach(() => resetMocks());

  async function makePagos() {
    const { PagosService } = await import('../src/modules/pagos/pagos.service');
    const service = new (PagosService as any)();
    service.tablesEnsured = true;
    return service;
  }

  it('rechaza exchange_rate no numerico ("abc")', async () => {
    const service = await makePagos();
    // createPago validates exchange_rate AFTER many other checks; we do not
    // need to mock every migration — the reject-string match on "exchange_rate"
    // confirms the guard fired.
    await expect(
      service.createPago(
        'company-1',
        'user-1',
        {
          enterprise_id: 'ent-1',
          payment_methods: [{ method: 'efectivo', amount: 100 }],
          currency: 'USD',
          exchange_rate: 'abc',
        },
        { userCanAccessLuna: false }
      )
    ).rejects.toThrow(/exchange_rate invalido/);
  });

  it('rechaza exchange_rate <= 0', async () => {
    const service = await makePagos();
    await expect(
      service.createPago(
        'company-1',
        'user-1',
        {
          enterprise_id: 'ent-1',
          payment_methods: [{ method: 'efectivo', amount: 100 }],
          currency: 'USD',
          exchange_rate: '-5',
        },
        { userCanAccessLuna: false }
      )
    ).rejects.toThrow(/exchange_rate/);
  });
});
