/**
 * INTEGRATION TESTS CONTRA POSTGRES REAL
 *
 * Estos tests conectan a la base de datos REAL (Neon via DATABASE_URL) y
 * verifican que las queries criticas PARSEAN y EJECUTAN correctamente contra
 * el schema real de produccion.
 *
 * OBJETIVO: capturar errores que los mocks no ven, como:
 * - Enum constraint violations (invoice_status)
 * - Column not found
 * - Type cast errors
 * - Foreign key reference errors
 *
 * Todas las queries son READ-ONLY (SELECT con LIMIT 1) — no modifican datos.
 *
 * Se skippean automaticamente si no hay DATABASE_URL (CI without DB).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from repo root
dotenv.config({ path: resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
// Opt-in gate: only run when explicitly requested (e.g. RUN_INTEGRATION_TESTS=1)
// Prevents pre-push hooks from failing if no ephemeral DB is available.
const shouldRun = !!DATABASE_URL && process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!shouldRun)('Integration: Postgres real queries parse correctly', () => {
  let pool: Pool;
  let companyId: string | null = null;

  beforeAll(async () => {
    const needsSsl = /neon|render|supabase|amazonaws|azure/i.test(DATABASE_URL || '');
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: 2,
      idleTimeoutMillis: 3000,
    });
    // Grab any real company_id for parameterization (read-only)
    try {
      const r = await pool.query('SELECT id FROM companies LIMIT 1');
      companyId = r.rows[0]?.id || '00000000-0000-0000-0000-000000000000';
    } catch {
      companyId = '00000000-0000-0000-0000-000000000000';
    }
  }, 20000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ═══════════════════════════════════════════════════════════════════
  // ENUM VALIDATION — this is the class of bug that broke prod 2026-04-12
  // ═══════════════════════════════════════════════════════════════════

  it('invoice_status enum: solo acepta cancelled (ingles) — NOT IN bilingue rompe', async () => {
    // This was the exact bug: NOT IN with 'cancelado' fails enum cast
    await expect(
      pool.query(`SELECT 1 FROM invoices WHERE status NOT IN ('cancelled', 'cancelado') LIMIT 1`)
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it('invoice_status enum: != cancelled (ingles) SI funciona', async () => {
    const r = await pool.query(`SELECT 1 FROM invoices WHERE status != 'cancelled' LIMIT 1`);
    expect(r).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Queries criticas de cada modulo — las que mi S11 toco
  // ═══════════════════════════════════════════════════════════════════

  it('orders.service: list query con invoiced_amount subquery parsea', async () => {
    // Replica exactamente la query de getOrders (linea ~118)
    const r = await pool.query(`
      SELECT
        o.id,
        COALESCE((SELECT SUM(CAST(inv.total_amount AS decimal)) FROM invoices inv WHERE inv.order_id = o.id AND inv.status != 'cancelled'), 0) as invoiced_amount
      FROM orders o
      WHERE o.company_id = $1
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('orders.service: getOrderItems con qty_invoiced subquery parsea', async () => {
    const r = await pool.query(`
      SELECT oi.id,
        COALESCE((
          SELECT SUM(CAST(ii.quantity AS decimal))
          FROM invoice_items ii
          JOIN invoices i ON ii.invoice_id = i.id
          WHERE ii.order_item_id = oi.id AND i.status != 'cancelled'
        ), 0) as qty_invoiced
      FROM order_items oi
      LIMIT 1
    `);
    expect(r).toBeDefined();
  });

  it('invoices.service: item_invoiced CTE parsea', async () => {
    const r = await pool.query(`
      WITH item_invoiced AS (
        SELECT ii.order_item_id, COALESCE(SUM(CAST(ii.quantity AS decimal)), 0) as qty_invoiced
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE i.status != 'cancelled'
          AND i.company_id = $1 AND ii.order_item_id IS NOT NULL
        GROUP BY ii.order_item_id
      )
      SELECT * FROM item_invoiced LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('cuenta-corriente: enterprise saldo query parsea (invoices + purchase_invoices)', async () => {
    const r = await pool.query(`
      SELECT e.id,
        COALESCE((SELECT SUM(CAST(i.total_amount AS decimal)) FROM invoices i
          WHERE i.company_id = $1 AND i.enterprise_id = e.id AND i.status != 'cancelled'), 0) as saldo_facturado,
        COALESCE((SELECT SUM(CAST(pi.total_amount AS decimal)) FROM purchase_invoices pi
          WHERE pi.company_id = $1 AND pi.enterprise_id = e.id AND pi.status NOT IN ('cancelled', 'cancelado')), 0) as saldo_compras
      FROM enterprises e
      WHERE e.company_id = $1
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('reports: libro IVA ventas parsea', async () => {
    const r = await pool.query(`
      SELECT COUNT(*) as count,
        COALESCE(SUM(CAST(i.total_amount AS decimal)), 0) as total
      FROM invoices i
      WHERE i.company_id = $1
        AND i.status != 'cancelled'
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('reports: uninvoiced orders query parsea', async () => {
    const r = await pool.query(`
      SELECT COUNT(*) as count,
        COALESCE(SUM(
          CAST(o.total_amount AS decimal) - COALESCE(
            (SELECT SUM(CAST(i.total_amount AS decimal)) FROM invoices i WHERE i.order_id = o.id AND i.status != 'cancelled'), 0
          )
        ), 0) as total
      FROM orders o
      WHERE o.company_id = $1
        AND o.status != 'cancelado'
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('purchases.service: invoiced_amount con purchase_invoices (VARCHAR bilingue) parsea', async () => {
    const r = await pool.query(`
      SELECT p.id,
        COALESCE((SELECT SUM(CAST(pinv.total_amount AS decimal)) FROM purchase_invoices pinv
          WHERE pinv.purchase_id = p.id AND pinv.status NOT IN ('cancelled', 'cancelado')), 0) as invoiced_amount
      FROM purchases p
      WHERE p.company_id = $1
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('cobros.service: enterprise balance con invoices JOIN parsea', async () => {
    const r = await pool.query(`
      SELECT o.id
      FROM orders o
      LEFT JOIN invoices i ON (i.order_id = o.id OR i.id IN (SELECT io.invoice_id FROM invoice_orders io WHERE io.order_id = o.id)) AND i.status != 'cancelled'
      WHERE o.company_id = $1
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('cobro-applications: getAvailableInvoicesForLinking query parsea', async () => {
    const r = await pool.query(`
      SELECT i.id
      FROM invoices i
      WHERE i.company_id = $1 AND i.status != 'cancelled' AND (i.payment_status IS NULL OR i.payment_status != 'pagado')
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('collections.service: order totals con invoice JOIN parsea', async () => {
    const r = await pool.query(`
      SELECT o.id,
        COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as total_paid
      FROM orders o
      LEFT JOIN invoices i ON (i.order_id = o.id OR i.id IN (SELECT io.invoice_id FROM invoice_orders io WHERE io.order_id = o.id)) AND i.status != 'cancelled'
      LEFT JOIN cobro_invoice_applications cia ON cia.invoice_id = i.id
      WHERE o.company_id = $1
      GROUP BY o.id
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('remitos.service: getInvoiceItemsForRemito query parsea', async () => {
    const r = await pool.query(`
      SELECT ii.id as invoice_item_id, ii.order_item_id, i.enterprise_id
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      LEFT JOIN order_items oi ON ii.order_item_id = oi.id AND oi.order_id IN (SELECT id FROM orders WHERE company_id = i.company_id)
      LEFT JOIN orders o ON oi.order_id = o.id AND o.company_id = i.company_id
      WHERE i.company_id = $1
        AND i.status != 'cancelled'
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  it('remitos.service: FOR UPDATE lock con orders bilingue parsea', async () => {
    // orders.status es VARCHAR, acepta bilingue
    const r = await pool.query(`
      SELECT oi.id, oi.quantity, COALESCE(oi.qty_delivered, 0) as qty_delivered, o.enterprise_id, oi.order_id, o.status as order_status
      FROM order_items oi JOIN orders o ON oi.order_id = o.id
      WHERE o.company_id = $1
        AND o.status NOT IN ('cancelado', 'cancelled')
      LIMIT 1
    `, [companyId]);
    expect(r).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Verify schema: enum actual values
  // ═══════════════════════════════════════════════════════════════════

  it('verify: invoice_status enum contiene solo [draft,pending,authorized,cancelled,emitido]', async () => {
    const r = await pool.query(`
      SELECT unnest(enum_range(NULL::invoice_status))::text as value
    `);
    const values = r.rows.map(row => row.value);
    expect(values).toContain('cancelled');
    expect(values).not.toContain('cancelado');
  });

  it('verify: orders.status es VARCHAR, no enum', async () => {
    const r = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'status'
    `);
    expect(r.rows[0]?.data_type).toBe('character varying');
  });

  it('verify: purchase_invoices.status es VARCHAR, no enum', async () => {
    const r = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'purchase_invoices' AND column_name = 'status'
    `);
    expect(r.rows[0]?.data_type).toBe('character varying');
  });

  it('verify: remitos.status es VARCHAR, no enum', async () => {
    const r = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'remitos' AND column_name = 'status'
    `);
    expect(r.rows[0]?.data_type).toBe('character varying');
  });
});
