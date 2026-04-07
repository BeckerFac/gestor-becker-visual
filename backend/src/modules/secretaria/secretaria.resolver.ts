// SecretarIA Name Resolver — Converts human names to database IDs via fuzzy matching
// Used by write operations to resolve "Garcia" → enterprise UUID

import { pool } from '../../config/db';

export interface ResolvedEntity {
  id: string;
  name: string;
  score: number; // 0-1 similarity
  extra?: Record<string, any>;
}

export interface ResolutionResult {
  resolved: boolean;
  entity?: ResolvedEntity;
  ambiguous?: ResolvedEntity[]; // Multiple matches, need user to pick
  error?: string;
}

// Fuzzy match enterprise by name or CUIT
export async function resolveEnterprise(companyId: string, search: string): Promise<ResolutionResult> {
  const clean = search.trim().toLowerCase();
  if (!clean) return { resolved: false, error: 'Nombre de empresa vacio' };

  const result = await pool.query(`
    SELECT id, name, cuit, tax_condition,
      SIMILARITY(LOWER(name), $2) as score
    FROM enterprises
    WHERE company_id = $1
      AND (LOWER(name) ILIKE '%' || $2 || '%' OR cuit LIKE '%' || $2 || '%')
    ORDER BY SIMILARITY(LOWER(name), $2) DESC, name ASC
    LIMIT 5
  `, [companyId, clean]).catch(() =>
    // Fallback if pg_trgm not available
    pool.query(`
      SELECT id, name, cuit, tax_condition, 1.0 as score
      FROM enterprises
      WHERE company_id = $1
        AND (LOWER(name) ILIKE '%' || $2 || '%' OR cuit LIKE '%' || $2 || '%')
      ORDER BY name ASC
      LIMIT 5
    `, [companyId, clean])
  );

  const matches = result.rows || [];

  if (matches.length === 0) {
    return { resolved: false, error: `No encontre ninguna empresa que matchee "${search}"` };
  }

  if (matches.length === 1) {
    return {
      resolved: true,
      entity: { id: matches[0].id, name: matches[0].name, score: 1, extra: { cuit: matches[0].cuit } },
    };
  }

  // If top match is significantly better, use it
  if (matches[0].score > 0.8 && matches[0].score - (matches[1]?.score || 0) > 0.3) {
    return {
      resolved: true,
      entity: { id: matches[0].id, name: matches[0].name, score: matches[0].score, extra: { cuit: matches[0].cuit } },
    };
  }

  // Ambiguous - user needs to pick
  return {
    resolved: false,
    ambiguous: matches.map(m => ({ id: m.id, name: m.name, score: parseFloat(m.score) || 0, extra: { cuit: m.cuit } })),
  };
}

// Fuzzy match product by name or SKU
export async function resolveProduct(companyId: string, search: string): Promise<ResolutionResult> {
  const clean = search.trim().toLowerCase();
  if (!clean) return { resolved: false, error: 'Nombre de producto vacio' };

  const result = await pool.query(`
    SELECT p.id, p.name, p.sku, pp.final_price, pp.cost
    FROM products p
    LEFT JOIN product_pricing pp ON pp.product_id = p.id
    WHERE p.company_id = $1
      AND (LOWER(p.name) ILIKE '%' || $2 || '%' OR LOWER(p.sku) ILIKE '%' || $2 || '%')
    ORDER BY p.name ASC
    LIMIT 5
  `, [companyId, clean]);

  const matches = result.rows || [];

  if (matches.length === 0) {
    return { resolved: false, error: `No encontre ningun producto que matchee "${search}"` };
  }

  if (matches.length === 1) {
    return {
      resolved: true,
      entity: {
        id: matches[0].id,
        name: matches[0].name,
        score: 1,
        extra: { sku: matches[0].sku, price: parseFloat(matches[0].final_price || '0'), cost: parseFloat(matches[0].cost || '0') },
      },
    };
  }

  return {
    resolved: false,
    ambiguous: matches.map(m => ({
      id: m.id,
      name: `${m.name} (${m.sku})`,
      score: 1,
      extra: { sku: m.sku, price: parseFloat(m.final_price || '0') },
    })),
  };
}

// Resolve order by number (#0001) or title
export async function resolveOrder(companyId: string, search: string): Promise<ResolutionResult> {
  const clean = search.trim();

  // Try number first
  const numMatch = clean.match(/^#?0*(\d+)$/);
  if (numMatch) {
    const orderNum = parseInt(numMatch[1]);
    const result = await pool.query(
      `SELECT id, order_number, title, enterprise_id, total_amount, status
       FROM orders WHERE company_id = $1 AND order_number = $2 LIMIT 1`,
      [companyId, orderNum],
    );
    if (result.rows.length === 1) {
      const o = result.rows[0];
      return {
        resolved: true,
        entity: { id: o.id, name: `#${String(o.order_number).padStart(4, '0')} - ${o.title}`, score: 1, extra: { order_number: o.order_number, enterprise_id: o.enterprise_id, total: parseFloat(o.total_amount || '0'), status: o.status } },
      };
    }
  }

  // Try by title
  const result = await pool.query(
    `SELECT id, order_number, title, enterprise_id, total_amount, status
     FROM orders WHERE company_id = $1 AND LOWER(title) ILIKE '%' || $2 || '%'
     ORDER BY created_at DESC LIMIT 5`,
    [companyId, clean.toLowerCase()],
  );

  const matches = result.rows || [];
  if (matches.length === 0) return { resolved: false, error: `No encontre el pedido "${search}"` };
  if (matches.length === 1) {
    const o = matches[0];
    return { resolved: true, entity: { id: o.id, name: `#${String(o.order_number).padStart(4, '0')} - ${o.title}`, score: 1, extra: { order_number: o.order_number, enterprise_id: o.enterprise_id, total: parseFloat(o.total_amount || '0'), status: o.status } } };
  }

  return {
    resolved: false,
    ambiguous: matches.map(o => ({ id: o.id, name: `#${String(o.order_number).padStart(4, '0')} - ${o.title}`, score: 1, extra: { status: o.status } })),
  };
}

// Resolve invoice by number and type (e.g., "A 21023105" or "factura 1")
export async function resolveInvoice(companyId: string, search: string): Promise<ResolutionResult> {
  const clean = search.trim();

  // Try type + number (e.g., "A 21023105", "B 1")
  const typeMatch = clean.match(/^([ABC])\s*(\d+)$/i);
  if (typeMatch) {
    const type = typeMatch[1].toUpperCase();
    const num = parseInt(typeMatch[2]);
    const result = await pool.query(
      `SELECT id, invoice_number, invoice_type, total_amount, status, enterprise_id
       FROM invoices WHERE company_id = $1 AND invoice_type = $2 AND invoice_number = $3 LIMIT 1`,
      [companyId, type, num],
    );
    if (result.rows.length === 1) {
      const inv = result.rows[0];
      return { resolved: true, entity: { id: inv.id, name: `${inv.invoice_type} ${inv.invoice_number}`, score: 1, extra: { total: parseFloat(inv.total_amount || '0'), status: inv.status, enterprise_id: inv.enterprise_id } } };
    }
  }

  // Try just number
  const numMatch = clean.match(/^#?0*(\d+)$/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    const result = await pool.query(
      `SELECT id, invoice_number, invoice_type, total_amount, status, enterprise_id
       FROM invoices WHERE company_id = $1 AND invoice_number = $2
       ORDER BY created_at DESC LIMIT 5`,
      [companyId, num],
    );
    const matches = result.rows || [];
    if (matches.length === 1) {
      const inv = matches[0];
      return { resolved: true, entity: { id: inv.id, name: `${inv.invoice_type || 'NF'} ${inv.invoice_number}`, score: 1, extra: { total: parseFloat(inv.total_amount || '0'), status: inv.status } } };
    }
    if (matches.length > 1) {
      return { resolved: false, ambiguous: matches.map(inv => ({ id: inv.id, name: `${inv.invoice_type || 'NF'} ${inv.invoice_number}`, score: 1, extra: { total: parseFloat(inv.total_amount || '0'), status: inv.status } })) };
    }
  }

  return { resolved: false, error: `No encontre la factura "${search}"` };
}

// Resolve customer by name
export async function resolveCustomer(companyId: string, search: string): Promise<ResolutionResult> {
  const clean = search.trim().toLowerCase();
  if (!clean) return { resolved: false, error: 'Nombre de cliente vacio' };

  const result = await pool.query(`
    SELECT id, name, cuit, enterprise_id
    FROM customers
    WHERE company_id = $1
      AND (LOWER(name) ILIKE '%' || $2 || '%' OR cuit LIKE '%' || $2 || '%')
    ORDER BY name ASC
    LIMIT 5
  `, [companyId, clean]);

  const matches = result.rows || [];
  if (matches.length === 0) return { resolved: false, error: `No encontre ningun cliente "${search}"` };
  if (matches.length === 1) {
    return { resolved: true, entity: { id: matches[0].id, name: matches[0].name, score: 1, extra: { cuit: matches[0].cuit, enterprise_id: matches[0].enterprise_id } } };
  }

  return { resolved: false, ambiguous: matches.map(m => ({ id: m.id, name: m.name, score: 1, extra: { cuit: m.cuit } })) };
}
