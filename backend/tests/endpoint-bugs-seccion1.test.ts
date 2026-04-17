/**
 * SECCION 1 — Bugs encontrados en audit profundo de createOrder
 * Estos tests verifican que los 8 bugs fueron ARREGLADOS
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDbExecute, mockClientQuery, resetMocks } from './helpers/setup';

vi.mock('../src/config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/modules/crm/crm-sync.service', () => ({
  crmSyncService: {
    findDealByRelatedDocument: vi.fn().mockResolvedValue(null),
    linkDocumentToDeal: vi.fn().mockResolvedValue(undefined),
    handleEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

function mockStandardDb() {
  mockDbExecute.mockImplementation(async (sqlObj: any) => {
    const sqlStr = sqlObj?.strings ? sqlObj.strings.join('?') : String(sqlObj);
    // Enterprise validation (new in fix)
    if (sqlStr.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
    if (sqlStr.includes('SELECT id, enterprise_id FROM customers')) return { rows: [{ id: 'cust-1', enterprise_id: 'ent-1' }] };
    if (sqlStr.includes('SELECT id FROM business_units WHERE id')) return { rows: [{ id: 'bu-1' }] };
    if (sqlStr.includes('FROM business_units WHERE company_id')) return { rows: [{ id: 'bu-default' }] };
    if (sqlStr.includes('MAX(order_number)')) return { rows: [{ next_number: 1 }] };
    if (sqlStr.includes('SELECT enterprise_id FROM customers')) return { rows: [] };
    return { rows: [] };
  });
}

// ═══════════════════════════════════════════════════════════════════
// BUG #1 FIX: IDOR en customer_id — ahora valida company
// ═══════════════════════════════════════════════════════════════════

describe('BUG #1 FIX: customer_id valida company', () => {
  beforeEach(() => resetMocks());

  it('rechaza customer_id que no pertenece a la company', async () => {
    mockDbExecute.mockImplementation(async (sqlObj: any) => {
      const sqlStr = sqlObj?.strings ? sqlObj.strings.join('?') : String(sqlObj);
      // Customer no existe en esta company
      if (sqlStr.includes('SELECT id, enterprise_id FROM customers')) return { rows: [] };
      if (sqlStr.includes('FROM business_units')) return { rows: [{ id: 'bu-default' }] };
      if (sqlStr.includes('MAX(order_number)')) return { rows: [{ next_number: 1 }] };
      return { rows: [] };
    });

    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('company-A', 'user-1', {
      title: 'Malicious order',
      customer_id: 'customer-of-company-B',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/cliente no existe o no pertenece/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #2 FIX: title validado
// ═══════════════════════════════════════════════════════════════════

describe('BUG #2 FIX: title requerido', () => {
  beforeEach(() => resetMocks());

  it('rechaza pedido sin title', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/titulo.*requerido/);
  });

  it('rechaza title con solo espacios', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: '   ',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/titulo.*requerido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #3 FIX: quantity/unit_price validados
// ═══════════════════════════════════════════════════════════════════

describe('BUG #3 FIX: Cantidades/precios positivos', () => {
  beforeEach(() => resetMocks());

  it('rechaza unit_price negativo', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 10, unit_price: -1000, vat_rate: 21 }],
    })).rejects.toThrow(/Precio unitario invalido/);
  });

  it('rechaza quantity = 0', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 0, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/Cantidad invalida/);
  });

  it('rechaza quantity negativa', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: -5, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/Cantidad invalida/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #4 FIX: vat_rate validado 0-100
// ═══════════════════════════════════════════════════════════════════

describe('BUG #4 FIX: vat_rate validado', () => {
  beforeEach(() => resetMocks());

  it('rechaza vat_rate > 100', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 9999 }],
    })).rejects.toThrow(/IVA invalido/);
  });

  it('rechaza vat_rate negativo', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: -5 }],
    })).rejects.toThrow(/IVA invalido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #5 FIX: discount_percent validado
// ═══════════════════════════════════════════════════════════════════

describe('BUG #5 FIX: discount_percent validado', () => {
  beforeEach(() => resetMocks());

  it('rechaza discount_percent no numerico', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      discount_percent: 'abc',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/Descuento invalido/);
  });

  it('rechaza discount_percent > 100', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      discount_percent: 150,
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/Descuento invalido/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #6 FIX: Return incluye order_number y total_amount
// ═══════════════════════════════════════════════════════════════════

describe('BUG #6 FIX: Return completo', () => {
  beforeEach(() => resetMocks());

  it('devuelve order_number y total_amount', async () => {
    mockDbExecute.mockImplementation(async (sqlObj: any) => {
      const sqlStr = sqlObj?.strings ? sqlObj.strings.join('?') : String(sqlObj);
      if (sqlStr.includes('FROM business_units')) return { rows: [{ id: 'bu-default' }] };
      if (sqlStr.includes('MAX(order_number)')) return { rows: [{ next_number: 42 }] };
      if (sqlStr.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    mockClientQuery.mockImplementation(async (...args: any[]) => {
      const s = typeof args[0] === 'string' ? args[0] : String(args[0]);
      if (s.includes('MAX(order_number)')) return { rows: [{ next_number: 42 }] };
      return { rows: [], rowCount: 0 };
    });

    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    const result = await service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      items: [{ product_name: 'Test', quantity: 10, unit_price: 10000, vat_rate: 21 }],
    });

    expect(result.id).toBeDefined();
    expect(result.status).toBe('pendiente');
    expect(result.order_number).toBe(42);
    expect(result.total_amount).toBe(121000); // 100k + 21k IVA
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #7 FIX: enterprise_id validado contra company
// ═══════════════════════════════════════════════════════════════════

describe('BUG #7 FIX: enterprise_id validado', () => {
  beforeEach(() => resetMocks());

  it('rechaza enterprise_id que no pertenece a la company', async () => {
    mockDbExecute.mockImplementation(async (sqlObj: any) => {
      const sqlStr = sqlObj?.strings ? sqlObj.strings.join('?') : String(sqlObj);
      // Enterprise NO existe en esta company
      if (sqlStr.includes('SELECT id FROM enterprises')) return { rows: [] };
      if (sqlStr.includes('FROM business_units')) return { rows: [{ id: 'bu-default' }] };
      if (sqlStr.includes('MAX(order_number)')) return { rows: [{ next_number: 1 }] };
      return { rows: [] };
    });

    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('company-A', 'user-1', {
      title: 'IDOR test',
      enterprise_id: 'enterprise-of-company-B',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/empresa no existe o no pertenece/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BUG #8 FIX: priority validada
// ═══════════════════════════════════════════════════════════════════

describe('BUG #8 FIX: priority validada', () => {
  beforeEach(() => resetMocks());

  it('rechaza priority invalida', async () => {
    mockStandardDb();
    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    await expect(service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      priority: 'SUPER_URGENTE_FUEGO',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    })).rejects.toThrow(/Prioridad invalida/);
  });

  it('acepta priority valida', async () => {
    mockDbExecute.mockImplementation(async (sqlObj: any) => {
      const sqlStr = sqlObj?.strings ? sqlObj.strings.join('?') : String(sqlObj);
      if (sqlStr.includes('FROM business_units')) return { rows: [{ id: 'bu-default' }] };
      if (sqlStr.includes('MAX(order_number)')) return { rows: [{ next_number: 1 }] };
      if (sqlStr.includes('SELECT id FROM enterprises')) return { rows: [{ id: 'ent-1' }] };
      return { rows: [] };
    });
    mockClientQuery.mockImplementation(async (...args: any[]) => {
      const s = typeof args[0] === 'string' ? args[0] : String(args[0]);
      if (s.includes('MAX(order_number)')) return { rows: [{ next_number: 1 }] };
      return { rows: [], rowCount: 0 };
    });

    const { OrdersService } = await import('../src/modules/orders/orders.service');
    const service = new (OrdersService as any)();
    service.migrationsRun = true;

    const result = await service.createOrder('comp-1', 'user-1', {
      title: 'Test',
      enterprise_id: 'ent-1',
      priority: 'urgente',
      items: [{ product_name: 'Test', quantity: 1, unit_price: 100, vat_rate: 21 }],
    });

    expect(result.id).toBeDefined();
  });
});
