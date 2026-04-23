import { db, pool } from '../../config/db';
import { invoices, invoice_items, customers } from '../../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { afipService, AfipService, AuthorizeInvoiceInput } from '../afip/afip.service';
import { crmSyncService } from '../crm/crm-sync.service';
import { activityService } from '../activity/activity.service';

function validateNumeric(value: unknown, fieldName: string, { min = 0, max = Infinity, allowZero = true } = {}): number {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new ApiError(400, `${fieldName} debe ser un numero valido`);
  if (num < min) throw new ApiError(400, `${fieldName} no puede ser menor a ${min}`);
  if (num > max) throw new ApiError(400, `${fieldName} no puede ser mayor a ${max}`);
  if (!allowZero && num === 0) throw new ApiError(400, `${fieldName} no puede ser cero`);
  return num;
}

/**
 * Wave 3C C3: exchange_rate validator for multi-currency invoices.
 * Returns null for ARS (no rate needed) and a sane positive number for
 * foreign currencies, throwing 400 when missing / zero / negative / absurd.
 * Shared by createInvoice, updateDraftInvoice and authorizeInvoice so the
 * rule stays in one place.
 */
export function parseAndValidateExchangeRate(
  currency: string | null | undefined,
  raw: unknown,
): number | null {
  const cur = (currency || 'ARS').toUpperCase();
  if (cur === 'ARS') {
    // For ARS, either no rate or a positive rate (ignored) is fine.
    if (raw == null || raw === '') return null;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (raw == null || raw === '') {
    throw new ApiError(400, `exchange_rate requerido y > 0 para moneda ${cur}`);
  }
  const rate = parseFloat(String(raw));
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ApiError(400, `exchange_rate requerido y > 0 para moneda ${cur}`);
  }
  if (rate > 1_000_000) {
    throw new ApiError(400, 'exchange_rate invalido (fuera de rango razonable)');
  }
  return rate;
}

/**
 * Resolve the current product cost from product_pricing for snapshot on
 * invoice_items.cost. Returns 0 when:
 *  - productId is null (manual line item, no linked product),
 *  - the product has no pricing row yet,
 *  - the cost column is unreadable for any reason.
 * Never throws — cost is a best-effort snapshot used only by reports.
 */
async function resolveProductCost(productId: string | null): Promise<string> {
  if (!productId) return '0';
  try {
    const result = await db.execute(sql`
      SELECT cost FROM product_pricing WHERE product_id = ${productId} LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) return '0';
    const cost = rows[0].cost;
    if (cost == null) return '0';
    const parsed = Number(cost);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed.toString() : '0';
  } catch {
    return '0';
  }
}

export class InvoicesService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`);
      await db.execute(sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fiscal_type VARCHAR(20) DEFAULT 'fiscal'`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'system'`);
      // Add 'emitido' status value for internal vouchers
      await db.execute(sql`ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'emitido'`).catch(() => {});

      // FCE MiPyME columns
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_fce BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fce_payment_due_date DATE`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fce_cbu VARCHAR(22)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fce_status VARCHAR(20) DEFAULT 'pendiente'`);

      // Company CBU fields for FCE
      await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cbu VARCHAR(22)`);
      await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cbu_alias VARCHAR(50)`);

      // Export invoice (Tipo E) columns
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_type VARCHAR(20)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS destination_country VARCHAR(5)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS incoterms VARCHAR(10)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_permit VARCHAR(50)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_client_name VARCHAR(200)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_client_address TEXT`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_client_tax_id VARCHAR(50)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_language INTEGER DEFAULT 1`);

      // Extend invoice_type enum to support export types (E, NC_E, ND_E)
      // ALTER TYPE ... ADD VALUE is idempotent with IF NOT EXISTS
      await db.execute(sql`ALTER TYPE invoice_type ADD VALUE IF NOT EXISTS 'E'`).catch(() => {});
      await db.execute(sql`ALTER TYPE invoice_type ADD VALUE IF NOT EXISTS 'NC_E'`).catch(() => {});
      await db.execute(sql`ALTER TYPE invoice_type ADD VALUE IF NOT EXISTS 'ND_E'`).catch(() => {});

      // MercadoPago payment link columns
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_url TEXT`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_id VARCHAR(100)`);

      // AFIP service concept fields
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS concepto INTEGER DEFAULT 1`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fch_serv_desde DATE`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fch_serv_hasta DATE`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fch_vto_pago DATE`);

      // NC/ND: related invoice (the original invoice being corrected)
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS related_invoice_id UUID REFERENCES invoices(id)`);

      // Multi-currency support
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ARS'`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12,4)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_foreign DECIMAL(12,2)`);

      // Nor feedback item 4: snapshot of the receiver identity used at
      // emission time. Falls back via COALESCE to customer/enterprise for
      // historical rows that have NULL here.
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receiver_cuit VARCHAR(20)`);
      await db.execute(sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receiver_razon_social VARCHAR(255)`);

      // Wave 3C C2/C4: store per-item rounded VAT so SUM(items.vat_amount)
      // matches invoices.vat_amount exactly (no ROUND drift per row in
      // Libro IVA). Historical rows get 0 and are recomputed by read-time
      // COALESCE (see accounting.service.ts).
      await db.execute(sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0`);

      this.migrationsRun = true;
    } catch (error) {
      console.error('Invoices migrations error:', error);
    }
  }

  /**
   * Nor feedback item 4: resolve the fiscal identity (CUIT + razon_social +
   * tax_condition + fiscal_address) for an invoice's RECEIVER.
   *
   * Priority:
   *   1. customer-level — if customer has BOTH cuit AND razon_social set, it
   *      bills under its own identity (multi-RS per empresa).
   *   2. enterprise-level — falls back to enterprise fiscal data.
   *
   * CC aggregation remains at the enterprise level regardless of which
   * identity is used at emission time. The enterprise_id is always returned
   * so callers can persist it on the invoice for CC grouping.
   *
   * Both CUIT and razon_social are required at customer level: a customer
   * with only a CUIT (no razon_social) falls back to the enterprise so the
   * receiver identity is never partially-resolved.
   */
  async resolveInvoiceFiscalIdentity(
    payload: { customer_id?: string | null; enterprise_id?: string | null },
    companyId: string
  ): Promise<{
    cuit: string | null;
    razon_social: string | null;
    tax_condition: string | null;
    fiscal_address: string | null;
    enterprise_id: string | null;
    source: 'customer' | 'enterprise';
  }> {
    // Priority 1: customer-level fiscal identity (if customer has cuit + razon_social)
    if (payload.customer_id) {
      const custResult = await db.execute(sql`
        SELECT c.cuit, c.razon_social, c.tax_condition, c.fiscal_address,
               c.address, c.enterprise_id
        FROM customers c
        WHERE c.id = ${payload.customer_id} AND c.company_id = ${companyId}
      `);
      const c = ((custResult as any).rows || [])[0];
      if (c && c.cuit && c.razon_social) {
        // Validate CUIT format before it ever reaches AFIP (defensive).
        const cleanCuit = String(c.cuit).replace(/[-\s]/g, '');
        if (!/^\d{11}$/.test(cleanCuit)) {
          throw new ApiError(400, 'El CUIT del cliente tiene un formato invalido (debe tener 11 digitos)');
        }
        return {
          cuit: c.cuit,
          razon_social: c.razon_social,
          tax_condition: c.tax_condition || null,
          // Cascade: customer's fiscal_address > customer's commercial address.
          fiscal_address: c.fiscal_address || c.address || null,
          enterprise_id: c.enterprise_id || payload.enterprise_id || null,
          source: 'customer',
        };
      }
    }

    // Priority 2: enterprise-level
    // Resolve enterprise_id from customer if not provided and customer lacks
    // its own fiscal identity.
    let entId = payload.enterprise_id || null;
    if (!entId && payload.customer_id) {
      const custRes = await db.execute(sql`
        SELECT enterprise_id FROM customers
        WHERE id = ${payload.customer_id} AND company_id = ${companyId}
      `);
      const custRow = ((custRes as any).rows || [])[0];
      if (custRow?.enterprise_id) entId = custRow.enterprise_id;
    }

    if (entId) {
      const entResult = await db.execute(sql`
        SELECT cuit, razon_social, tax_condition, fiscal_address, address, name
        FROM enterprises
        WHERE id = ${entId} AND company_id = ${companyId}
      `);
      const e = ((entResult as any).rows || [])[0];
      if (e) {
        return {
          cuit: e.cuit || null,
          // When enterprise doesn't have a razon_social set (legacy rows),
          // fall back to the commercial name so the receiver block never
          // renders empty.
          razon_social: e.razon_social || e.name || null,
          tax_condition: e.tax_condition || null,
          // Cascade: fiscal_address > commercial address.
          fiscal_address: e.fiscal_address || e.address || null,
          enterprise_id: entId,
          source: 'enterprise',
        };
      }
    }

    // Neither customer nor enterprise could be resolved → invalid state.
    throw new ApiError(400, 'No se pudo resolver la identidad fiscal del receptor');
  }

  async createInvoice(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();

    // Wave 3D D11: reject invoices without items. Previously an empty array
    // or missing `items` created a $0 invoice that later broke subtotals,
    // AFIP payloads, and CC reconciliation.
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new ApiError(400, 'Al menos un item es requerido');
    }

    // Wave 3D D12: whitelist invoice_type against the set of values the
    // system actually supports. Anything else would be silently accepted
    // then 500 at the DB enum check or produce garbage AFIP payloads.
    const VALID_INVOICE_TYPES = ['A', 'B', 'C', 'E', 'LUN', 'NC_A', 'NC_B', 'NC_C', 'NC_E', 'ND_A', 'ND_B', 'ND_C', 'ND_E'];
    if (data.invoice_type && !VALID_INVOICE_TYPES.includes(data.invoice_type)) {
      throw new ApiError(400, `invoice_type invalido. Valores: ${VALID_INVOICE_TYPES.join(', ')}`);
    }

    // Sol/Luna: cross-circuit validation against linked order (must happen
    // BEFORE inferring fiscal_type so we can use the order's circuit as
    // default and reject explicit mismatches).
    let orderCircuit: 'fiscal' | 'no_fiscal' | null = null;
    if (data.order_id) {
      const orderRes = await db.execute(sql`
        SELECT fiscal_type FROM orders WHERE id = ${data.order_id} AND company_id = ${companyId}
      `);
      const orderRow = ((orderRes as any).rows || [])[0];
      if (orderRow) {
        const ft = orderRow.fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal';
        orderCircuit = ft;
        // If caller specified fiscal_type explicitly, it must match the order's circuit.
        if (data.fiscal_type && data.fiscal_type !== 'interno' && data.fiscal_type !== ft) {
          throw new ApiError(400, 'El circuito del comprobante no coincide con el del pedido');
        }
        // Default the invoice's fiscal_type to the order's when not provided.
        if (!data.fiscal_type) {
          data.fiscal_type = ft;
        }
      }
    }

    // Sol/Luna: Block NC/ND for Luna circuit (not supported in this sprint).
    if (data.fiscal_type === 'no_fiscal' && typeof data.invoice_type === 'string' && data.invoice_type.startsWith('NC_')) {
      throw new ApiError(400, 'Notas de Credito Luna no soportadas en este sprint');
    }

    // Auto-assign default business_unit_id if not provided
    if (!data.business_unit_id) {
      try {
        const buResult = await db.execute(sql`SELECT id FROM business_units WHERE company_id = ${companyId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
        const defaultBu = ((buResult as any).rows || [])[0];
        if (defaultBu) data.business_unit_id = defaultBu.id;
      } catch { /* no business units yet */ }
    }

    try {
      const invoiceId = uuid();
      // Validate: if items have order_item_id, check that we don't invoice more than available
      // BUG S9 #1: include 'cancelado' (ES) in filter
      // BUG S9 #4: scope order_item by company (IDOR fix)
      // PR7-T18: excluir NCs del conteo (consistent con getRemito y orders.service.ts)
      //          NC no cuenta como facturacion para el calculo de disponible.
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          if (item.order_item_id) {
            const checkResult = await db.execute(sql`
              SELECT
                CAST(oi.quantity AS decimal) as total_qty,
                COALESCE((
                  SELECT SUM(CAST(ii.quantity AS decimal))
                  FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id
                  WHERE ii.order_item_id = ${item.order_item_id}
                    AND i.status != 'cancelled'
                    AND i.invoice_type::text NOT LIKE 'NC%'
                    AND i.company_id = ${companyId}
                ), 0) as invoiced_qty
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.id = ${item.order_item_id} AND o.company_id = ${companyId}
            `);
            const check = ((checkResult as any).rows || [])[0];
            if (check) {
              const available = parseFloat(check.total_qty) - parseFloat(check.invoiced_qty);
              const requesting = parseFloat(item.quantity) || 0;
              if (requesting > available + 0.01) {
                const oiName = item.product_name || 'Item';
                throw new ApiError(400, `${oiName}: solo quedan ${available.toFixed(2)} unidades disponibles para facturar (pediste ${requesting}). Ya existen facturas que cubren esa cantidad.`);
              }
            }
          }
        }
      }

      const fiscalType = data.fiscal_type === 'interno' ? 'interno' : (data.fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal');
      // Sol/Luna: Luna invoices always use invoice_type='LUN'; legacy interno still uses NULL.
      const invoiceType = fiscalType === 'no_fiscal'
        ? 'LUN'
        : (fiscalType === 'interno' ? null : (data.invoice_type || 'B'));
      // Wave 3D: hoisted from inside the pool.connect() try (previously
      // unreachable at the later export_data UPDATE and breaking tsc).
      const isExportType = ['E', 'NC_E', 'ND_E'].includes(invoiceType || '');

      // BUG S9 #3: validate customer belongs to company (IDOR fix) — BEFORE tx.
      if (data.customer_id) {
        const custCheck = await db.execute(sql`
          SELECT id FROM customers WHERE id = ${data.customer_id} AND company_id = ${companyId}
        `);
        const custRows = (custCheck as any).rows || custCheck || [];
        if (custRows.length === 0) {
          throw new ApiError(400, 'El cliente no existe o no pertenece a tu compania');
        }
      }
      // BUG S9 #3: validate enterprise belongs to company
      if (data.enterprise_id) {
        const entCheck = await db.execute(sql`
          SELECT id FROM enterprises WHERE id = ${data.enterprise_id} AND company_id = ${companyId}
        `);
        const entRows = (entCheck as any).rows || entCheck || [];
        if (entRows.length === 0) {
          throw new ApiError(400, 'La empresa no existe o no pertenece a tu compania');
        }
      }

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`
          SELECT enterprise_id FROM customers WHERE id = ${data.customer_id} AND company_id = ${companyId}
        `);
        const custRows = (custResult as any).rows || custResult || [];
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      // Wave 3A: real TX on a pooled connection so advisory_xact_lock + MAX() + INSERT
      // run on the SAME physical connection. Previous `db.execute(sql\`BEGIN\`)` pattern
      // released the connection back to the pool between statements — the lock was
      // effectively discarded, producing duplicate invoice numbers under concurrency.
      const client = await pool.connect();
      let nextNumber: number;
      try {
        await client.query('BEGIN');

        // PR2-T3: advisory lock para serializar generacion de invoice_number
        // Previene race condition cuando 2 requests crean facturas del mismo tipo
        // simultaneamente. El lock se libera automaticamente en COMMIT/ROLLBACK.
        const lockKey = `invoice_num:${companyId}:${fiscalType}:${invoiceType || 'null'}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

        // Get next sequential invoice number — separate sequences for fiscal vs internal vs Luna
        if (fiscalType === 'no_fiscal') {
          // Luna: dedicated sequence scoped by invoice_type='LUN'
          const numRes = await client.query(
            `SELECT COALESCE(MAX(invoice_number), 0) + 1 as next_number
             FROM invoices WHERE company_id = $1 AND fiscal_type = 'no_fiscal' AND invoice_type = 'LUN'`,
            [companyId]
          );
          nextNumber = parseInt(numRes.rows[0]?.next_number || '1');
        } else if (fiscalType === 'interno') {
          const numRes = await client.query(
            `SELECT COALESCE(MAX(invoice_number), 0) + 1 as next_number
             FROM invoices WHERE company_id = $1 AND fiscal_type = $2`,
            [companyId, fiscalType]
          );
          nextNumber = parseInt(numRes.rows[0]?.next_number || '1');
        } else {
          const numRes = await client.query(
            `SELECT COALESCE(MAX(invoice_number), 0) + 1 as next_number
             FROM invoices WHERE company_id = $1 AND invoice_type = $2
               AND (fiscal_type = 'fiscal' OR fiscal_type IS NULL)`,
            [companyId, invoiceType]
          );
          nextNumber = parseInt(numRes.rows[0]?.next_number || '1');
        }

        // INSERT invoice header on the SAME client (otherwise the advisory lock is moot).
        // Wave 3D: isExportType now hoisted above pool.connect() so the later
        // export_data UPDATE block outside this try can reuse it.
        if (fiscalType === 'no_fiscal') {
          await client.query(
            `INSERT INTO invoices (id, company_id, customer_id, invoice_type, invoice_number, invoice_date,
              subtotal, vat_amount, total_amount, status, fiscal_type, business_unit_id, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, 'LUN', $4, NOW(), '0', '0', '0', 'emitido', 'no_fiscal', $5, $6, NOW(), NOW())`,
            [invoiceId, companyId, data.customer_id || null, nextNumber, data.business_unit_id || null, userId]
          );
        } else if (fiscalType === 'interno') {
          await client.query(
            `INSERT INTO invoices (id, company_id, customer_id, invoice_type, invoice_number, invoice_date,
              subtotal, vat_amount, total_amount, status, fiscal_type, business_unit_id, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, NULL, $4, NOW(), '0', '0', '0', 'emitido', 'interno', $5, $6, NOW(), NOW())`,
            [invoiceId, companyId, data.customer_id || null, nextNumber, data.business_unit_id || null, userId]
          );
        } else if (isExportType) {
          await client.query(
            `INSERT INTO invoices (id, company_id, customer_id, invoice_type, invoice_number, invoice_date,
              subtotal, vat_amount, total_amount, status, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), '0', '0', '0', 'draft', $6, NOW(), NOW())`,
            [invoiceId, companyId, data.customer_id || null, invoiceType, nextNumber, userId]
          );
        } else {
          await client.query(
            `INSERT INTO invoices (id, company_id, customer_id, invoice_type, invoice_number, invoice_date,
              subtotal, vat_amount, total_amount, status, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), '0', '0', '0', 'draft', $6, NOW(), NOW())`,
            [invoiceId, companyId, data.customer_id || null, invoiceType, nextNumber, userId]
          );
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      // Nor feedback item 4: resolve and snapshot the receiver fiscal identity.
      // When the resolved source is 'customer' with its own CUIT/razon_social,
      // store that on the invoice so Libro IVA / PDF / AFIP use the correct
      // identity. When source is 'enterprise' (no per-customer identity), we
      // still snapshot so historical name changes on the enterprise don't
      // silently rewrite past invoices. If neither resolves (Consumidor Final
      // with no customer and no enterprise), leave the snapshot NULL and fall
      // back via the PDF/Libro IVA cascades.
      //
      // Re-throw ONLY invalid-CUIT errors (which would otherwise hit AFIP
      // with a bad payload). "No se pudo resolver" is swallowed so legacy
      // flows (Consumidor Final, unlinked invoices) continue to work.
      let receiverCuit: string | null = null;
      let receiverRazonSocial: string | null = null;
      if (data.customer_id || enterpriseId) {
        try {
          const identity = await this.resolveInvoiceFiscalIdentity(
            { customer_id: data.customer_id || null, enterprise_id: enterpriseId || null },
            companyId,
          );
          receiverCuit = identity.cuit;
          receiverRazonSocial = identity.razon_social;
          // resolveInvoiceFiscalIdentity may have resolved enterprise_id from
          // the customer row — keep our local in sync for downstream UPDATE.
          if (!enterpriseId && identity.enterprise_id) enterpriseId = identity.enterprise_id;
        } catch (resolveErr) {
          if (resolveErr instanceof ApiError && /cuit/i.test(resolveErr.message) && resolveErr.statusCode === 400) {
            throw resolveErr;
          }
          // All other resolution failures → leave snapshot NULL, rely on PDF
          // / Libro IVA COALESCE cascade to fill the receiver at read time.
        }
      }

      // Set order_id, enterprise_id, fiscal_type, business_unit_id, related_invoice_id, currency, and retenciones_esperadas via raw SQL (columns added by migration)
      const currency = data.currency || 'ARS';
      // Wave 3C C3: non-ARS invoices REQUIRE a valid, positive exchange_rate.
      // Without this, amount_foreign and totals get stored as NaN/0 and the
      // ARS-equivalent columns (used by every report) go to zero, silently
      // breaking AR / DSO / cobranzas.
      const exchangeRate = parseAndValidateExchangeRate(currency, data.exchange_rate);
      // Sol/Luna: Luna circuit has no retenciones concept — always force empty array.
      const retencionesEsperadas = fiscalType === 'no_fiscal'
        ? '[]'
        : (Array.isArray(data.retenciones_esperadas) ? JSON.stringify(data.retenciones_esperadas) : '[]');
      await db.execute(sql`
        UPDATE invoices SET order_id = ${data.order_id || null}, enterprise_id = ${enterpriseId},
          fiscal_type = ${fiscalType}, business_unit_id = ${data.business_unit_id || null},
          related_invoice_id = ${data.related_invoice_id || null},
          currency = ${currency}, exchange_rate = ${exchangeRate},
          retenciones_esperadas = ${retencionesEsperadas}::jsonb,
          receiver_cuit = ${receiverCuit},
          receiver_razon_social = ${receiverRazonSocial}
        WHERE id = ${invoiceId}
      `);

      // Save export invoice (Tipo E) fields if provided
      if (isExportType && data.export_data) {
        await db.execute(sql`
          UPDATE invoices SET
            export_type = ${data.export_data.tipo_expo || '1'},
            destination_country = ${data.export_data.destination_country || null},
            incoterms = ${data.export_data.incoterms || null},
            export_permit = ${data.export_data.export_permit || null},
            export_client_name = ${data.export_data.client_name || null},
            export_client_address = ${data.export_data.client_address || null},
            export_client_tax_id = ${data.export_data.client_tax_id || null},
            export_language = ${data.export_data.language || 1}
          WHERE id = ${invoiceId}
        `);
      }

      // Wave 3C C4: resolve the order's discount_percent once so we can
      // propagate it to each invoice_item. Without this, the order-level
      // descuento would reduce the invoice header totals while
      // invoice_items kept PRE-discount subtotals, making Libro IVA per-row
      // sums disagree with the header.
      let orderDiscountPercent = 0;
      if (data.order_id) {
        try {
          const discRes = await db.execute(sql`
            SELECT COALESCE(CAST(discount_percent AS decimal), 0) as dp
            FROM orders WHERE id = ${data.order_id} AND company_id = ${companyId}
          `);
          const dp = ((discRes as any).rows || [])[0]?.dp;
          const parsed = parseFloat(dp ?? '0');
          orderDiscountPercent = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
        } catch {
          orderDiscountPercent = 0;
        }
      }
      const discountMultiplier = 1 - orderDiscountPercent / 100;

      // Add items
      const collectedOrderItemIds: string[] = [];
      if (data.items && Array.isArray(data.items)) {
        let subtotal = 0;
        let vatAmount = 0;

        for (const item of data.items) {
          // If creating from order_item, resolve product data from order_items
          let productId = item.product_id || null;
          let productName = item.product_name || '';
          let unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
          // Sol/Luna: Luna items treat unit_price as "precio final" — force vat_rate=0 so
          // the subtotal equals the line total and no IVA is broken out.
          let vatRate = fiscalType === 'no_fiscal'
            ? 0
            : validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });

          if (item.order_item_id) {
            // BUG S9 #4: scope to company
            const oiResult = await db.execute(sql`
              SELECT oi.product_id, oi.product_name, oi.unit_price
              FROM order_items oi JOIN orders o ON oi.order_id = o.id
              WHERE oi.id = ${item.order_item_id} AND o.company_id = ${companyId}
            `);
            const oiRows = (oiResult as any).rows || oiResult || [];
            if (oiRows.length === 0) {
              throw new ApiError(400, `Item de pedido ${item.order_item_id} no existe o no pertenece a tu compania`);
            }
            const oi = oiRows[0];
            productId = productId || oi.product_id || null;
            productName = productName || oi.product_name || '';
            unitPrice = unitPrice || parseFloat(oi.unit_price || '0');

            // Also resolve customer_id and enterprise_id from order if not set
            if (!data.customer_id && data.order_id) {
              // BUG S9 #5: scope orders by company
              const orderResult = await db.execute(sql`
                SELECT customer_id, enterprise_id FROM orders WHERE id = ${data.order_id} AND company_id = ${companyId}
              `);
              const orderRows = (orderResult as any).rows || orderResult || [];
              if (orderRows.length > 0) {
                if (!data.customer_id && orderRows[0].customer_id) {
                  data.customer_id = orderRows[0].customer_id;
                  // Update invoice with customer_id
                  await db.update(invoices).set({ customer_id: data.customer_id }).where(eq(invoices.id, invoiceId));
                }
                if (!enterpriseId && orderRows[0].enterprise_id) {
                  enterpriseId = orderRows[0].enterprise_id;
                  await db.execute(sql`UPDATE invoices SET enterprise_id = ${enterpriseId} WHERE id = ${invoiceId}`);
                }
              }
            }
          }

          const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
          // Wave 3C C2 + C4: round subtotal + VAT per line with order-level
          // descuento already applied. Storing the rounded values makes
          // header totals == SUM(items.*) exactly (no Libro IVA drift).
          const rawSubtotal = unitPrice * qty;
          const itemSubtotal = Math.round(rawSubtotal * discountMultiplier * 100) / 100;
          const itemVat = Math.round(itemSubtotal * vatRate) / 100;
          subtotal += itemSubtotal;
          vatAmount += itemVat;

          const itemId = uuid();
          // Snapshot cost from product_pricing. Best-effort: returns '0' when
          // no product_id / no pricing / on error. Used by Rentabilidad report.
          const itemCost = await resolveProductCost(productId);
          await db.insert(invoice_items).values({
            id: itemId,
            invoice_id: invoiceId,
            product_id: productId,
            product_name: productName,
            quantity: qty.toString(),
            unit_price: unitPrice.toString(),
            vat_rate: vatRate.toString(),
            subtotal: itemSubtotal.toString(),
            vat_amount: itemVat.toString(),
            cost: itemCost,
          });

          // Link invoice_item to order_item if provided
          if (item.order_item_id) {
            await db.execute(sql`
              UPDATE invoice_items SET order_item_id = ${item.order_item_id} WHERE id = ${itemId}
            `);
            collectedOrderItemIds.push(item.order_item_id);
          }

        }

        // Update invoice totals
        const total = subtotal + vatAmount;
        // If foreign currency, store original amount and convert total to ARS
        if (currency !== 'ARS' && exchangeRate && exchangeRate > 0) {
          const totalArs = total * exchangeRate;
          const subtotalArs = subtotal * exchangeRate;
          const vatArs = vatAmount * exchangeRate;
          await db.update(invoices)
            .set({
              subtotal: subtotalArs.toString(),
              vat_amount: vatArs.toString(),
              total_amount: totalArs.toString(),
            })
            .where(eq(invoices.id, invoiceId));
          await db.execute(sql`UPDATE invoices SET amount_foreign = ${total.toString()} WHERE id = ${invoiceId}`);
        } else {
          await db.update(invoices)
            .set({
              subtotal: subtotal.toString(),
              vat_amount: vatAmount.toString(),
              total_amount: total.toString(),
            })
            .where(eq(invoices.id, invoiceId));
        }
      }

      // Derive unique order_ids from invoice items that have order_item_id
      if (collectedOrderItemIds.length > 0) {
        // Query each order_item_id individually to avoid drizzle array issues
        const orderIdSet = new Set<string>();
        for (const oiId of collectedOrderItemIds) {
          const oiResult = await db.execute(sql`SELECT order_id FROM order_items WHERE id = ${oiId}`);
          const orderId = ((oiResult as any).rows || [])[0]?.order_id;
          if (orderId) orderIdSet.add(orderId);
        }
        const orderIds = Array.from(orderIdSet);

        // Insert into invoice_orders (N:N)
        for (const orderId of orderIds) {
          await db.execute(sql`
            INSERT INTO invoice_orders (id, invoice_id, order_id)
            VALUES (gen_random_uuid(), ${invoiceId}, ${orderId})
            ON CONFLICT (invoice_id, order_id) DO NOTHING
          `);
        }

        // Update has_invoice for ALL linked orders
        for (const orderId of orderIds) {
          await db.execute(sql`
            UPDATE orders SET has_invoice = true, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}
          `);
        }

        // Set invoices.order_id to first order (backward compat)
        if (!data.order_id && orderIds.length > 0) {
          await db.execute(sql`
            UPDATE invoices SET order_id = ${orderIds[0]} WHERE id = ${invoiceId}
          `);
        }
      } else if (data.order_id) {
        // Legacy: single order_id provided directly
        await db.execute(sql`
          INSERT INTO invoice_orders (id, invoice_id, order_id)
          VALUES (gen_random_uuid(), ${invoiceId}, ${data.order_id})
          ON CONFLICT (invoice_id, order_id) DO NOTHING
        `);
        await db.execute(sql`
          UPDATE orders SET has_invoice = true, updated_at = NOW()
          WHERE id = ${data.order_id} AND company_id = ${companyId}
        `);
      }

      // -- END TRANSACTION (committed above via client.query('COMMIT')) --

      // Sol/Luna: lock the linked order (idempotent). Called after commit so
      // the lock only lives if the invoice actually persisted. Covers both
      // fiscal and no_fiscal circuits.
      try {
        const { ordersService } = await import('../orders/orders.service');
        const lockReason = `factura ${invoiceType || fiscalType} ${nextNumber} emitida`;
        if (data.order_id) {
          await ordersService.lockOrder(data.order_id, lockReason, userId);
        }
        // Also lock any orders linked through invoice_items.order_item_id (N:N).
        // PR7-T22: pool.query handles JS array → PG uuid[] binding via node-postgres.
        if (collectedOrderItemIds.length > 0) {
          const ordsRes = await pool.query(
            'SELECT DISTINCT order_id FROM order_items WHERE id = ANY($1::uuid[])',
            [collectedOrderItemIds]
          );
          for (const r of ordsRes.rows) {
            if (r.order_id) await ordersService.lockOrder(r.order_id, lockReason, userId);
          }
        }
      } catch (lockErr) {
        console.warn('[sol-luna] lockOrder post-create failed:', (lockErr as Error).message);
      }

      // Accounting entry for non-fiscal invoices (fiscal ones go through authorizeInvoice)
      if (fiscalType === 'interno' || fiscalType === 'no_fiscal') {
        try {
          const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
          // Re-read totals after commit
          const totalsResult = await db.execute(sql`SELECT subtotal, vat_amount, total_amount, invoice_date FROM invoices WHERE id = ${invoiceId}`);
          const totalsRow = ((totalsResult as any).rows || [])[0];
          const itemsResult = await db.execute(sql`SELECT quantity, unit_price, vat_rate FROM invoice_items WHERE invoice_id = ${invoiceId}`);
          const itemsForAccounting = ((itemsResult as any).rows || []).map((i: any) => ({
            quantity: Number(i.quantity || 1),
            unit_price: parseFloat(i.unit_price?.toString() || '0'),
            vat_rate: parseFloat((i.vat_rate || '21').toString()),
          }));
          await accountingEntriesService.createEntryForInvoice({
            id: invoiceId,
            company_id: companyId,
            date: totalsRow?.invoice_date ? new Date(totalsRow.invoice_date).toISOString() : new Date().toISOString(),
            total: parseFloat(totalsRow?.total_amount?.toString() || '0'),
            subtotal: parseFloat(totalsRow?.subtotal?.toString() || '0'),
            vat_amount: parseFloat(totalsRow?.vat_amount?.toString() || '0'),
            invoice_type: invoiceType,
            // Sol/Luna: route through the dual-circuit branch. 'interno' (legacy)
            // was previously mapped into Sol — keep that behavior; only the
            // explicit 'no_fiscal' path flows into the Luna (parallel) accounts.
            fiscal_type: fiscalType === 'no_fiscal' ? 'no_fiscal' : 'fiscal',
            items: itemsForAccounting,
          });
        } catch (accErr) { console.warn('Accounting entry skipped (non-fiscal invoice):', (accErr as Error).message); }
      }

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId,
          module: 'invoices',
          action: 'create',
          entityType: 'invoice',
          entityId: invoiceId,
          circuit: fiscalType === 'no_fiscal' ? 'no_fiscal' : 'fiscal',
          metadata: { invoice_type: invoiceType, invoice_number: nextNumber, enterprise_id: enterpriseId },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return {
        id: invoiceId,
        order_id: data.order_id || null,
        enterprise_id: enterpriseId,
        fiscal_type: fiscalType,
        invoice_type: invoiceType,
        invoice_number: nextNumber,
        status: (fiscalType === 'interno' || fiscalType === 'no_fiscal') ? 'emitido' : 'draft',
      };
    } catch (error) {
      console.error('Create invoice error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to create invoice: ${(error as Error).message}`);
    }
  }

  async getInvoices(companyId: string, filters: {
    skip?: number;
    limit?: number;
    enterprise_id?: string;
    business_unit_id?: string;
    status?: string;
    invoice_type?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    fiscal_type?: string;
    userCanAccessLuna?: boolean;
  } = {}) {
    await this.ensureMigrations();
    try {
      const { enterprise_id, business_unit_id, status, invoice_type, search, date_from, date_to } = filters;
      let fiscal_type = filters.fiscal_type;
      // Sol/Luna: if the caller has no Luna access, force the fiscal circuit
      // no matter what they requested. Invisibility is the contract.
      if (!filters.userCanAccessLuna && (fiscal_type === 'no_fiscal' || fiscal_type === 'all')) {
        fiscal_type = 'fiscal';
      }
      // Default for Luna-enabled users: show both circuits (unless interno/fiscal explicitly set).
      if (filters.userCanAccessLuna && (fiscal_type === undefined || fiscal_type === '')) {
        fiscal_type = 'all';
      }
      const skip = Math.max(0, Math.min(Number(filters.skip) || 0, 100000));
      const limit = Math.max(1, Math.min(Number(filters.limit) || 50, 200));

      let whereClause = sql`i.company_id = ${companyId}`;
      // Filter by fiscal_type (default: 'fiscal' to preserve backward compatibility)
      if (fiscal_type === 'interno') {
        whereClause = sql`${whereClause} AND i.fiscal_type = 'interno'`;
      } else if (fiscal_type === 'no_fiscal') {
        whereClause = sql`${whereClause} AND i.fiscal_type = 'no_fiscal'`;
      } else if (fiscal_type === 'all') {
        // Sol/Luna: both circuits (fiscal + Luna no_fiscal). Exclude legacy 'interno'.
        whereClause = sql`${whereClause} AND (i.fiscal_type IN ('fiscal','no_fiscal') OR i.fiscal_type IS NULL)`;
      } else {
        whereClause = sql`${whereClause} AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)`;
      }
      if (business_unit_id) {
        // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
        whereClause = sql`${whereClause} AND (i.business_unit_id = ${business_unit_id} OR i.business_unit_id IS NULL)`;
      }
      if (enterprise_id) {
        whereClause = sql`${whereClause} AND (i.enterprise_id = ${enterprise_id} OR c.enterprise_id = ${enterprise_id})`;
      }
      if (status) {
        whereClause = sql`${whereClause} AND i.status = ${status}`;
      }
      if (invoice_type) {
        whereClause = sql`${whereClause} AND i.invoice_type = ${invoice_type}`;
      }
      if (search) {
        whereClause = sql`${whereClause} AND (c.name ILIKE ${'%' + search + '%'} OR c.cuit ILIKE ${'%' + search + '%'} OR CAST(i.invoice_number AS TEXT) ILIKE ${'%' + search + '%'} OR e.name ILIKE ${'%' + search + '%'})`;
      }
      if (date_from) {
        whereClause = sql`${whereClause} AND i.invoice_date >= ${date_from}`;
      }
      if (date_to) {
        // PR7-T1: offset AR -03:00 (no perder las ultimas 3h del dia)
        whereClause = sql`${whereClause} AND i.invoice_date <= ${date_to + 'T23:59:59.999-03:00'}`;
      }

      const result = await db.execute(sql`
        SELECT i.*,
          CASE WHEN c.id IS NOT NULL THEN
            json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit)
          ELSE NULL END as customer,
          CASE WHEN e.id IS NOT NULL THEN
            json_build_object('id', e.id, 'name', e.name, 'cuit', e.cuit)
          ELSE
            CASE WHEN c.enterprise_id IS NOT NULL THEN
              (SELECT json_build_object('id', e2.id, 'name', e2.name, 'cuit', e2.cuit) FROM enterprises e2 WHERE e2.id = c.enterprise_id)
            ELSE NULL END
          END as enterprise,
          CASE WHEN o.id IS NOT NULL THEN
            json_build_object('id', o.id, 'order_number', o.order_number, 'title', o.title, 'total_amount', o.total_amount)
          ELSE NULL END as "order",
          COALESCE(
            (SELECT json_agg(json_build_object(
              'order_id', o_link.id,
              'order_number', o_link.order_number,
              'order_title', o_link.title
            ) ORDER BY o_link.order_number DESC)
            FROM invoice_orders io
            JOIN orders o_link ON io.order_id = o_link.id
            WHERE io.invoice_id = i.id AND o_link.company_id = ${companyId}),
            '[]'::json
          ) as linked_orders,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta,
          -- total_cobrado using cobro_invoice_applications (N:N correct system)
          -- PR7-T5: excluir cobros anulados (soft-delete) del total cobrado.
          COALESCE((SELECT SUM(CAST(cia.amount_applied AS decimal)) FROM cobro_invoice_applications cia JOIN cobros cs ON cia.cobro_id = cs.id WHERE cia.invoice_id = i.id AND (cs.status IS NULL OR cs.status != 'anulado')), 0) as total_cobrado,
          CASE
            WHEN CAST(i.total_amount AS decimal) > 0 AND COALESCE((SELECT SUM(CAST(cia2.amount_applied AS decimal)) FROM cobro_invoice_applications cia2 JOIN cobros cs2 ON cia2.cobro_id = cs2.id WHERE cia2.invoice_id = i.id AND (cs2.status IS NULL OR cs2.status != 'anulado')), 0) >= CAST(i.total_amount AS decimal) THEN 'pagado'
            WHEN COALESCE((SELECT SUM(CAST(cia3.amount_applied AS decimal)) FROM cobro_invoice_applications cia3 JOIN cobros cs3 ON cia3.cobro_id = cs3.id WHERE cia3.invoice_id = i.id AND (cs3.status IS NULL OR cs3.status != 'anulado')), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
          END as payment_status
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON i.enterprise_id = e.id
        LEFT JOIN orders o ON i.order_id = o.id
        WHERE ${whereClause}
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);
      const items = (result as any).rows || result || [];

      // Get total count
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON i.enterprise_id = e.id
        WHERE ${whereClause}
      `);
      const total = parseInt(((countResult as any).rows || [])[0]?.total || '0');

      return { items, total, skip, limit };
    } catch (error) {
      console.error('Get invoices error:', error);
      throw new ApiError(500, 'Failed to get invoices');
    }
  }

  async getInvoice(companyId: string, invoiceId: string, userCanAccessLuna: boolean = true) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT i.*,
          CASE WHEN c.id IS NOT NULL THEN
            json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit, 'email', c.email, 'phone', c.phone, 'address', c.address, 'tax_condition', c.tax_condition, 'condicion_iva', c.condicion_iva)
          ELSE NULL END as customer,
          CASE WHEN e.id IS NOT NULL THEN
            json_build_object('id', e.id, 'name', e.name, 'cuit', e.cuit)
          ELSE NULL END as enterprise,
          CASE WHEN o.id IS NOT NULL THEN
            json_build_object('id', o.id, 'order_number', o.order_number, 'title', o.title)
          ELSE NULL END as "order",
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN enterprises e ON i.enterprise_id = e.id
        LEFT JOIN orders o ON i.order_id = o.id
        WHERE i.company_id = ${companyId} AND i.id = ${invoiceId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Invoice not found');

      // Sol/Luna: hide Luna rows from users without access (404 to avoid existence leak).
      if (rows[0]?.fiscal_type === 'no_fiscal' && !userCanAccessLuna) {
        throw new ApiError(404, 'Factura no encontrada');
      }

      // Get items
      const itemsResult = await db.execute(sql`
        SELECT ii.*, oi.product_name as order_product_name
        FROM invoice_items ii
        LEFT JOIN order_items oi ON ii.order_item_id = oi.id
        WHERE ii.invoice_id = ${invoiceId}
        ORDER BY ii.id ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get invoice');
    }
  }

  async linkOrder(companyId: string, invoiceId: string, orderId: string) {
    await this.ensureMigrations();
    try {
      // Verify invoice exists
      const invCheck = await db.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}`);
      if (((invCheck as any).rows || []).length === 0) throw new ApiError(404, 'Factura no encontrada');

      // Verify order exists
      const ordCheck = await db.execute(sql`SELECT id FROM orders WHERE id = ${orderId} AND company_id = ${companyId}`);
      if (((ordCheck as any).rows || []).length === 0) throw new ApiError(404, 'Pedido no encontrado');

      await db.execute(sql`
        UPDATE invoices SET order_id = ${orderId}, updated_at = NOW()
        WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      await db.execute(sql`
        UPDATE orders SET has_invoice = true, updated_at = NOW()
        WHERE id = ${orderId} AND company_id = ${companyId}
      `);

      // Sync invoice_orders N:N table
      await db.execute(sql`
        INSERT INTO invoice_orders (id, invoice_id, order_id)
        VALUES (gen_random_uuid(), ${invoiceId}, ${orderId})
        ON CONFLICT (invoice_id, order_id) DO NOTHING
      `);

      return { invoice_id: invoiceId, order_id: orderId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to link order');
    }
  }

  async unlinkOrder(companyId: string, invoiceId: string) {
    await this.ensureMigrations();
    try {
      // Get current order_id
      const invResult = await db.execute(sql`
        SELECT order_id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const rows = (invResult as any).rows || [];
      if (rows.length === 0) throw new ApiError(404, 'Factura no encontrada');
      const orderId = rows[0]?.order_id;

      // Remove from invoice_orders N:N table
      if (orderId) {
        await db.execute(sql`
          DELETE FROM invoice_orders WHERE invoice_id = ${invoiceId} AND order_id = ${orderId}
        `);
      }

      await db.execute(sql`
        UPDATE invoices SET order_id = NULL, updated_at = NOW()
        WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);

      // Recalculate has_invoice on the order
      if (orderId) {
        const remaining = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM invoices WHERE order_id = ${orderId} AND company_id = ${companyId}
        `);
        const cnt = parseInt(((remaining as any).rows || [])[0]?.cnt || '0');
        if (cnt === 0) {
          await db.execute(sql`
            UPDATE orders SET has_invoice = false, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}
          `);
        }
      }

      return { invoice_id: invoiceId, unlinked: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to unlink order');
    }
  }

  async updateDraftInvoice(companyId: string, invoiceId: string, data: any, userId?: string) {
    await this.ensureMigrations();
    try {
      // Verify invoice exists and is draft
      const invResult = await db.execute(sql`
        SELECT id, status FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const invRows = (invResult as any).rows || [];
      if (invRows.length === 0) throw new ApiError(404, 'Factura no encontrada');
      const editableStatuses = ['draft', 'emitido'];
      if (!editableStatuses.includes(invRows[0].status)) throw new ApiError(400, 'Solo se pueden editar facturas en borrador o comprobantes internos');

      // Update invoice_type if provided
      if (data.invoice_type) {
        await db.update(invoices).set({ invoice_type: data.invoice_type, updated_at: new Date() }).where(eq(invoices.id, invoiceId));
      }

      // Update concepto and service date fields if provided
      if (data.concepto !== undefined) {
        const concepto = parseInt(data.concepto) || 1;
        await db.execute(sql`UPDATE invoices SET concepto = ${concepto}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }
      if (data.fch_serv_desde) {
        await db.execute(sql`UPDATE invoices SET fch_serv_desde = ${data.fch_serv_desde}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }
      if (data.fch_serv_hasta) {
        await db.execute(sql`UPDATE invoices SET fch_serv_hasta = ${data.fch_serv_hasta}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }
      if (data.fch_vto_pago) {
        await db.execute(sql`UPDATE invoices SET fch_vto_pago = ${data.fch_vto_pago}, updated_at = NOW() WHERE id = ${invoiceId}`);
      }

      // PR7-T18 (update path): mirror createInvoice over-invoice defensive check.
      // BUG: updateDraftInvoice previously skipped this, allowing an attacker to
      // create an empty draft and PATCH items exceeding order availability.
      // Key difference vs createInvoice: EXCLUDE the current invoice from the
      // already-invoiced sum, since its old items are about to be replaced.
      // Also accumulate per order_item_id to prevent split-bypass in the same request.
      if (data.items && Array.isArray(data.items)) {
        const qtyByOrderItem = new Map<string, { qty: number; name: string }>();
        for (const item of data.items) {
          if (!item.order_item_id) continue;
          const q = parseFloat(item.quantity) || 0;
          const prev = qtyByOrderItem.get(item.order_item_id);
          qtyByOrderItem.set(item.order_item_id, {
            qty: (prev?.qty || 0) + q,
            name: prev?.name || item.product_name || 'Item',
          });
        }
        for (const [orderItemId, agg] of qtyByOrderItem.entries()) {
          const checkResult = await db.execute(sql`
            SELECT
              CAST(oi.quantity AS decimal) as total_qty,
              COALESCE((
                SELECT SUM(CAST(ii.quantity AS decimal))
                FROM invoice_items ii
                JOIN invoices i ON ii.invoice_id = i.id
                WHERE ii.order_item_id = ${orderItemId}
                  AND i.id != ${invoiceId}
                  AND i.status != 'cancelled'
                  AND i.invoice_type::text NOT LIKE 'NC%'
                  AND i.company_id = ${companyId}
              ), 0) as invoiced_elsewhere
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.id = ${orderItemId} AND o.company_id = ${companyId}
          `);
          const check = ((checkResult as any).rows || [])[0];
          if (!check) {
            throw new ApiError(400, `Item de pedido ${orderItemId} no existe o pertenece a otra empresa`);
          }
          const available = parseFloat(check.total_qty) - parseFloat(check.invoiced_elsewhere);
          if (agg.qty > available + 0.01) {
            throw new ApiError(
              400,
              `${agg.name}: solo quedan ${available.toFixed(2)} unidades disponibles para facturar (pediste ${agg.qty}). Ya existen otras facturas que cubren la diferencia.`
            );
          }
        }
      }

      // Wave 3C C3: re-validate exchange_rate if currency is being updated.
      if (data.currency !== undefined) {
        const newCurrency = String(data.currency || 'ARS').toUpperCase();
        const newRate = parseAndValidateExchangeRate(newCurrency, data.exchange_rate);
        await db.execute(sql`
          UPDATE invoices SET currency = ${newCurrency}, exchange_rate = ${newRate}, updated_at = NOW()
          WHERE id = ${invoiceId}
        `);
      }

      // Wave 3C C4: propagate current order-level descuento to invoice_items
      // when they're replaced — keeps header == SUM(items.*).
      let updateDiscountPercent = 0;
      try {
        const linkRes = await db.execute(sql`
          SELECT COALESCE(CAST(o.discount_percent AS decimal), 0) as dp
          FROM invoices i
          LEFT JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
          WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}
        `);
        const dp = ((linkRes as any).rows || [])[0]?.dp;
        const parsed = parseFloat(dp ?? '0');
        updateDiscountPercent = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
      } catch {
        updateDiscountPercent = 0;
      }
      const updateDiscountMultiplier = 1 - updateDiscountPercent / 100;

      // Update items if provided
      if (data.items && Array.isArray(data.items)) {
        // Wave 3A: atomic replace on a single pooled client. Previous
        // `db.execute(sql\`BEGIN\`)` pattern let DELETE and INSERT run on
        // DIFFERENT pool connections, breaking atomicity.
        // Precompute costs (async product_pricing lookups) BEFORE the tx to
        // minimize the lock window.
        const computedItems = [] as Array<{
          itemId: string; product_id: string | null; product_name: string;
          quantity: string; unit_price: string; vat_rate: string; subtotal: string;
          vat_amount: string; cost: string; order_item_id: string | null;
        }>;
        let subtotal = 0;
        let vatAmount = 0;
        for (const item of data.items) {
          const unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
          const vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });
          const qty = validateNumeric(item.quantity || 0, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
          // Wave 3C C2 + C4: per-item rounding + discount propagation.
          const rawSubtotal = unitPrice * qty;
          const itemSubtotal = Math.round(rawSubtotal * updateDiscountMultiplier * 100) / 100;
          const itemVat = Math.round(itemSubtotal * vatRate) / 100;
          subtotal += itemSubtotal;
          vatAmount += itemVat;
          const itemCost = await resolveProductCost(item.product_id || null);
          computedItems.push({
            itemId: uuid(),
            product_id: item.product_id || null,
            product_name: item.product_name || '',
            quantity: qty.toString(),
            unit_price: unitPrice.toString(),
            vat_rate: vatRate.toString(),
            subtotal: itemSubtotal.toString(),
            vat_amount: itemVat.toString(),
            cost: itemCost,
            order_item_id: item.order_item_id || null,
          });
        }
        const total = subtotal + vatAmount;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Re-verify status under row lock — prevents racing against authorize.
          const lockRes = await client.query(
            `SELECT status FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
            [invoiceId, companyId]
          );
          if (lockRes.rows.length === 0) throw new ApiError(404, 'Factura no encontrada');
          if (!editableStatuses.includes(lockRes.rows[0].status)) {
            throw new ApiError(400, 'Solo se pueden editar facturas en borrador o comprobantes internos');
          }

          await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);

          for (const ci of computedItems) {
            await client.query(
              `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, quantity, unit_price, vat_rate, subtotal, vat_amount, cost, order_item_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [ci.itemId, invoiceId, ci.product_id, ci.product_name, ci.quantity, ci.unit_price, ci.vat_rate, ci.subtotal, ci.vat_amount, ci.cost, ci.order_item_id]
            );
          }

          await client.query(
            `UPDATE invoices SET subtotal = $1, vat_amount = $2, total_amount = $3, updated_at = NOW() WHERE id = $4`,
            [subtotal.toString(), vatAmount.toString(), total.toString(), invoiceId]
          );

          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
      }

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId: userId || 'system',
          module: 'invoices',
          action: 'update',
          entityType: 'invoice',
          entityId: invoiceId,
          circuit: null,
          changes: Object.fromEntries(Object.keys(data || {}).map((k) => [k, { new: data[k] }])),
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return await this.getInvoice(companyId, invoiceId);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update draft invoice error:', error);
      throw new ApiError(500, 'Error al actualizar borrador');
    }
  }

  // TODO [ACC-3.10]: When invoice cancellation is implemented (status -> 'cancelled'),
  // add: accountingEntriesService.createReverseEntry(companyId, 'invoice', invoiceId)
  // to generate the contra-entry that reverses the original accounting entry.

  async deleteDraftInvoice(companyId: string, invoiceId: string, userId?: string) {
    await this.ensureMigrations();
    try {
      const invResult = await db.execute(sql`
        SELECT id, status, order_id, cae, source FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId}
      `);
      const invRows = (invResult as any).rows || [];
      if (invRows.length === 0) throw new ApiError(404, 'Factura no encontrada');

      const row = invRows[0];
      const isManualImport = row.source === 'manual_import';
      const isDraft = row.status === 'draft' || row.status === 'emitido';
      const hasCae = !!row.cae;

      // Rules:
      // 1. Drafts without CAE → deletable (user can discard a draft before AFIP).
      // 2. Manually-imported invoices (source='manual_import') → deletable even
      //    with a CAE, because the CAE was typed by the user, not obtained from
      //    AFIP. Deleting only reverts the local snapshot. User must not have
      //    applied cobros yet (fiscal integrity).
      // 3. Everything else (real AFIP auth) → blocked; use nota de crédito.
      if (!isManualImport) {
        if (!isDraft) {
          throw new ApiError(400, 'Solo se pueden eliminar facturas en borrador o comprobantes internos. Use nota de credito para revertir una factura autorizada.');
        }
        if (hasCae) {
          throw new ApiError(400, 'No se puede eliminar una factura con CAE asignado (registro fiscal AFIP). Use nota de credito para revertir.');
        }
      } else {
        // Manually-imported: block if any cobro application exists.
        try {
          const appRes: any = await pool.query(
            `SELECT 1 FROM cobro_invoice_applications WHERE invoice_id = $1 LIMIT 1`,
            [invoiceId]
          );
          if ((appRes.rows || []).length > 0) {
            throw new ApiError(400, 'No se puede eliminar una factura con cobros aplicados. Desaplicá los cobros antes de eliminar.');
          }
        } catch (e: any) {
          if (e instanceof ApiError) throw e;
          // Table may not exist in very old environments — continue.
          console.warn('[deleteDraftInvoice] cobro_invoice_applications check warning:', e?.message);
        }
      }

      const orderId = row.order_id;

      // Delete items first
      await db.delete(invoice_items).where(eq(invoice_items.invoice_id, invoiceId));
      // Remove from invoice_orders N:N table
      await db.execute(sql`DELETE FROM invoice_orders WHERE invoice_id = ${invoiceId}`);
      // Delete invoice
      await db.delete(invoices).where(eq(invoices.id, invoiceId));

      // Recalculate has_invoice on the order
      if (orderId) {
        const remaining = await db.execute(sql`
          SELECT COUNT(*) as cnt FROM invoices WHERE order_id = ${orderId} AND company_id = ${companyId}
        `);
        const cnt = parseInt(((remaining as any).rows || [])[0]?.cnt || '0');
        if (cnt === 0) {
          await db.execute(sql`
            UPDATE orders SET has_invoice = false, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}
          `);
        }

        // Sol/Luna: release the order lock if no other active docs remain.
        // The helper is cascade-aware, so it's safe to invoke unconditionally.
        try {
          const { ordersService } = await import('../orders/orders.service');
          await ordersService.unlockOrder(orderId);
        } catch (unlockErr) {
          console.warn('[sol-luna] unlockOrder post-delete failed:', (unlockErr as Error).message);
        }
      }

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId: userId || 'system',
          module: 'invoices',
          action: 'delete',
          entityType: 'invoice',
          entityId: invoiceId,
          circuit: null,
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al eliminar borrador');
    }
  }

  async importInvoice(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      // Validate required fields
      if (!data.invoice_type || !['A', 'B', 'C'].includes(data.invoice_type)) {
        throw new ApiError(400, 'Tipo de comprobante invalido (debe ser A, B o C)');
      }
      if (!data.invoice_number_full || !/^\d{5}-\d{8}$/.test(data.invoice_number_full)) {
        throw new ApiError(400, 'Numero de comprobante invalido (formato: 00003-00000001)');
      }
      if (!data.invoice_date) {
        throw new ApiError(400, 'Fecha de emision es requerida');
      }
      // PR2-T2: validar rango de fecha (copy del patron en remitos.service.ts)
      {
        const d = new Date(data.invoice_date);
        if (isNaN(d.getTime())) {
          throw new ApiError(400, 'Fecha de emision invalida. Debe ser formato ISO 8601');
        }
        const now = Date.now();
        const oneYearFuture = now + 365 * 24 * 3600 * 1000;
        const fiveYearsPast = now - 5 * 365 * 24 * 3600 * 1000;
        if (d.getTime() > oneYearFuture) {
          throw new ApiError(400, 'Fecha de emision invalida: no puede ser mas de un año en el futuro');
        }
        if (d.getTime() < fiveYearsPast) {
          throw new ApiError(400, 'Fecha de emision invalida: no puede ser mas de 5 años en el pasado');
        }
      }
      if (!data.cae || !/^\d{14}$/.test(data.cae)) {
        throw new ApiError(400, 'CAE invalido (debe ser de 14 digitos)');
      }
      if (!data.cae_expiry_date) {
        throw new ApiError(400, 'Fecha de vencimiento del CAE es requerida');
      }
      if (!data.enterprise_id) {
        throw new ApiError(400, 'Cliente/Empresa es requerido');
      }
      if (!data.customer_cuit || !/^\d{11}$/.test(data.customer_cuit.replace(/-/g, ''))) {
        throw new ApiError(400, 'CUIT del cliente invalido (debe ser de 11 digitos)');
      }
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        throw new ApiError(400, 'Debe incluir al menos un item');
      }

      // Parse invoice number parts
      const [pvStr, nroStr] = data.invoice_number_full.split('-');
      const puntoVenta = parseInt(pvStr);
      const invoiceNumber = parseInt(nroStr);

      // Check for duplicate CAE
      const dupCheck = await db.execute(sql`
        SELECT id FROM invoices WHERE company_id = ${companyId} AND cae = ${data.cae}
      `);
      if (((dupCheck as any).rows || []).length > 0) {
        throw new ApiError(400, 'Ya existe una factura con este CAE');
      }

      const invoiceId = uuid();

      // Resolve enterprise_id and customer_id
      let enterpriseId = data.enterprise_id || null;
      let customerId = data.customer_id || null;

      // Calculate totals from items
      let subtotal = 0;
      let vatAmount = 0;

      for (const item of data.items) {
        const unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
        const vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });
        const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
        const itemSubtotal = unitPrice * qty;
        const itemVat = itemSubtotal * (vatRate / 100);
        subtotal += itemSubtotal;
        vatAmount += itemVat;
      }

      const total = subtotal + vatAmount;

      // Create invoice with status 'authorized' directly
      await db.insert(invoices).values({
        id: invoiceId,
        company_id: companyId,
        customer_id: customerId,
        invoice_type: data.invoice_type,
        invoice_number: invoiceNumber,
        invoice_date: new Date(data.invoice_date),
        subtotal: subtotal.toString(),
        vat_amount: vatAmount.toString(),
        total_amount: total.toString(),
        cae: data.cae,
        cae_expiry_date: new Date(data.cae_expiry_date),
        status: 'authorized',
        created_by: userId,
      }).returning();

      // Set enterprise_id, fiscal_type, and source via raw SQL (migration columns)
      await db.execute(sql`
        UPDATE invoices SET
          enterprise_id = ${enterpriseId},
          fiscal_type = 'fiscal',
          source = 'manual_import',
          afip_response = ${JSON.stringify({ PuntoVenta: puntoVenta, ManualImport: true })}::jsonb
        WHERE id = ${invoiceId}
      `);

      // Add items
      for (const item of data.items) {
        const unitPrice = validateNumeric(item.unit_price || 0, 'Precio unitario', { min: 0, max: 999999999 });
        const vatRate = validateNumeric(item.vat_rate || 21, 'Tasa IVA', { min: 0, max: 100 });
        const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.001, max: 999999, allowZero: false });
        const itemSubtotal = unitPrice * qty;

        const itemId = uuid();
        // Snapshot cost from product_pricing (manual-import path).
        const itemCost = await resolveProductCost(item.product_id || null);
        await db.insert(invoice_items).values({
          id: itemId,
          invoice_id: invoiceId,
          product_id: item.product_id || null,
          product_name: item.product_name || '',
          quantity: qty.toString(),
          unit_price: unitPrice.toString(),
          vat_rate: vatRate.toString(),
          subtotal: itemSubtotal.toString(),
          cost: itemCost,
        });
      }

      return {
        id: invoiceId,
        enterprise_id: enterpriseId,
        fiscal_type: 'fiscal',
        source: 'manual_import',
        status: 'authorized',
      };
    } catch (error) {
      console.error('Import invoice error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Error al importar factura');
    }
  }

  async authorizeInvoice(companyId: string, invoiceId: string, puntoVenta: number = 1, overrideCondicionIva?: number, userId?: string) {
    // Wave 3A: acquire a row-level lock on the invoice (FOR UPDATE) on a pooled
    // client and HOLD IT through the AFIP round-trip so two concurrent
    // authorize requests cannot both pass the status=='draft' check and get
    // duplicate CAE assignments. The lock is released on COMMIT/ROLLBACK at
    // the end of the method.
    const lockClient = await pool.connect();
    try {
      await lockClient.query('BEGIN');
      const lockRes = await lockClient.query(
        `SELECT id, fiscal_type, status FROM invoices
         WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [invoiceId, companyId]
      );
      if (lockRes.rows.length === 0) {
        throw new ApiError(404, 'Factura no encontrada');
      }
      const ft = lockRes.rows[0].fiscal_type;
      const lockedStatus = lockRes.rows[0].status;
      if (ft === 'no_fiscal') {
        throw new ApiError(400, 'Los comprobantes Luna no se autorizan en AFIP');
      }
      if (ft === 'interno') {
        throw new ApiError(400, 'Los comprobantes internos/no fiscales no pueden autorizarse en AFIP');
      }
      if (lockedStatus !== 'draft') {
        throw new ApiError(400, 'La factura no puede ser autorizada (estado: ' + lockedStatus + ')');
      }

      validateNumeric(puntoVenta, 'Punto de venta', { min: 1, max: 99999, allowZero: false });
      const invoice = await this.getInvoice(companyId, invoiceId);
      if (invoice.status !== 'draft') throw new ApiError(400, 'La factura no puede ser autorizada (estado: ' + invoice.status + ')');

      // Validate invoice has items and non-zero total
      const totalAmount = parseFloat(invoice.total_amount?.toString() || '0');
      if (totalAmount <= 0) {
        throw new ApiError(400, 'La factura no tiene importe. Verifique que los items tengan precios.');
      }

      // Wave 3C C3: invoice may have been created via legacy import with
      // currency!=ARS but no exchange_rate. Block AFIP authorization before
      // it sends a broken MonCotiz.
      const invCurrency = ((invoice as any).currency || 'ARS').toString().toUpperCase();
      if (invCurrency !== 'ARS') {
        const invRate = (invoice as any).exchange_rate;
        const parsedRate = invRate != null ? parseFloat(invRate.toString()) : NaN;
        if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
          throw new ApiError(400, `exchange_rate requerido y > 0 para autorizar factura en ${invCurrency}`);
        }
      }

      // Get customer CUIT and condicion_iva.
      // Nor feedback item 4: when the invoice was emitted under a customer's
      // own fiscal identity (receiver_cuit snapshot set at creation), prefer
      // that over the raw customer.cuit — ensures AFIP authorization uses
      // the exact identity the user selected, even if the customer row
      // changes later.
      let customerCuit = '';
      let customerCondicionIva: number | null = null;
      if (invoice.customer_id) {
        const custRow = await db.execute(sql`SELECT cuit, condicion_iva, tax_condition FROM customers WHERE id = ${invoice.customer_id}`);
        const custData = ((custRow as any).rows || [])[0];
        if (custData) {
          customerCuit = custData.cuit || '';
          customerCondicionIva = custData.condicion_iva ? parseInt(custData.condicion_iva) : null;
        }
      }
      // Override with the snapshot if present (source of truth for AFIP).
      if ((invoice as any).receiver_cuit) {
        customerCuit = (invoice as any).receiver_cuit;
      }

      // Get invoice items for IVA breakdown
      const itemsList = invoice.items || [];
      if (itemsList.length === 0) {
        const items = await db.query.invoice_items.findMany({
          where: eq(invoice_items.invoice_id, invoiceId),
        });
        itemsList.push(...items);
      }

      // ---- Pre-authorization validations ----

      // Determine concepto: 1=Productos, 2=Servicios, 3=Ambos
      // Default to 1 (productos) - can be overridden by invoice metadata
      const concepto: 1 | 2 | 3 = (invoice as any).concepto || 1;

      // (a) Date validation: max 5 days back for productos, 10 for servicios
      const invoiceDate = new Date(invoice.invoice_date || invoice.created_at);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
      if (invoiceDate > now) {
        throw new ApiError(400, 'La fecha de la factura no puede ser futura');
      }
      const maxDays = concepto === 1 ? 5 : 10; // 5 for products, 10 for services/both
      if (diffDays > maxDays) {
        throw new ApiError(400, `La fecha de la factura excede el limite permitido por AFIP (${diffDays} dias atras, max ${maxDays} para ${concepto === 1 ? 'productos' : 'servicios'})`);
      }

      // (b) Amount consistency: recalculate neto + iva and fix if needed
      const neto = itemsList.reduce((sum: number, i: any) => sum + (Number(i.quantity) * parseFloat(i.unit_price?.toString() || '0')), 0);
      const iva = itemsList.reduce((sum: number, i: any) => sum + (Number(i.quantity) * parseFloat(i.unit_price?.toString() || '0') * parseFloat((i.vat_rate || '21').toString()) / 100), 0);
      const calculatedTotal = neto + iva;
      const invoiceTotal = parseFloat(invoice.total_amount?.toString() || '0');
      if (Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0) {
        await db.execute(sql`UPDATE invoices SET subtotal = ${neto.toFixed(2)}, vat_amount = ${iva.toFixed(2)}, total_amount = ${calculatedTotal.toFixed(2)} WHERE id = ${invoice.id}`);
      }

      // (d) Comprobante tipo A requires valid CUIT
      const rawInvType = invoice.invoice_type || 'B';
      const baseLetterForCuit = rawInvType.replace(/^(NC_|ND_)/, '');
      if (baseLetterForCuit === 'A') {
        if (!customerCuit || !AfipService.isValidCuit(customerCuit)) {
          throw new ApiError(400, 'Comprobante tipo A requiere un CUIT valido del cliente (verificacion modulo 11)');
        }
      }

      // (e) Validate invoice type vs IVA condition (backend guard)
      // Get company tax condition
      const companyResult = await db.execute(sql`SELECT tax_condition FROM companies WHERE id = ${companyId}`);
      const companyTaxCondition = ((companyResult as any).rows || [])[0]?.tax_condition || '';
      const invoiceType = (invoice.invoice_type || 'B') as string;

      // Extract base letter from invoice type (e.g. NC_A -> A, ND_B -> B)
      const baseLetter = invoiceType.replace(/^(NC_|ND_)/, '');
      const isNcNd = invoiceType.startsWith('NC_') || invoiceType.startsWith('ND_');

      if (companyTaxCondition.toLowerCase().includes('monotribut')) {
        if (baseLetter !== 'C') {
          throw new ApiError(400, `Monotributistas solo pueden emitir comprobantes tipo C (seleccionado: ${invoiceType})`);
        }
      } else if (companyTaxCondition.toLowerCase().includes('responsable inscripto')) {
        if (baseLetter === 'C') {
          throw new ApiError(400, 'Responsables Inscriptos no pueden emitir comprobantes tipo C');
        }
        // Get customer tax condition to validate A vs B
        if (invoice.customer_id) {
          const custResult = await db.execute(sql`SELECT tax_condition FROM customers WHERE id = ${invoice.customer_id}`);
          const custTaxCond = ((custResult as any).rows || [])[0]?.tax_condition || '';
          const isRI = custTaxCond.toLowerCase().includes('responsable inscripto');
          const isMono = custTaxCond.toLowerCase().includes('monotribut');
          if (baseLetter === 'A' && !isRI && !isMono) {
            throw new ApiError(400, `Comprobante tipo A solo para Responsables Inscriptos o Monotributistas. El cliente es: ${custTaxCond || 'sin condicion definida'}`);
          }
          if (baseLetter === 'B' && (isRI || isMono)) {
            throw new ApiError(400, `Comprobante tipo B no corresponde para clientes RI/Monotributistas. Use tipo A.`);
          }
        }
      }

      // Resolve CondicionIVAReceptorId: explicit override > customer setting > derive from context
      let condicionIvaReceptorId: number | undefined = overrideCondicionIva ?? customerCondicionIva ?? undefined;
      if (!condicionIvaReceptorId) {
        // Default logic based on invoice type and customer document
        const cleanCustCuit = customerCuit?.replace(/-/g, '') || '';
        const isConsumidorFinal = !cleanCustCuit || cleanCustCuit.length !== 11;
        if (isConsumidorFinal) {
          condicionIvaReceptorId = 5; // Consumidor Final
        } else if (baseLetter === 'A') {
          condicionIvaReceptorId = 1; // RI (default for tipo A)
        } else if (baseLetter === 'C') {
          condicionIvaReceptorId = 5; // CF (default for tipo C)
        } else {
          condicionIvaReceptorId = 5; // CF (default for Factura B)
        }
      }

      // Read service date fields from invoice for concepto 2/3
      let fchServDesde: string | undefined;
      let fchServHasta: string | undefined;
      let fchVtoPago: string | undefined;
      if (concepto !== 1) {
        const dateFields = await db.execute(sql`SELECT fch_serv_desde, fch_serv_hasta, fch_vto_pago FROM invoices WHERE id = ${invoiceId}`);
        const dateRow = ((dateFields as any).rows || [])[0];
        if (dateRow) {
          const formatDate = (d: any) => {
            if (!d) return undefined;
            const dt = new Date(d);
            if (isNaN(dt.getTime())) return undefined;
            return dt.toISOString().slice(0, 10).replace(/-/g, '');
          };
          fchServDesde = formatDate(dateRow.fch_serv_desde);
          fchServHasta = formatDate(dateRow.fch_serv_hasta);
          fchVtoPago = formatDate(dateRow.fch_vto_pago);
        }
      }

      // NC/ND: build CbtesAsoc from related invoice
      let cbtesAsoc: AuthorizeInvoiceInput['cbtesAsoc'] = undefined;
      if (isNcNd) {
        // Load related_invoice_id
        const relResult = await db.execute(sql`SELECT related_invoice_id FROM invoices WHERE id = ${invoiceId}`);
        const relInvoiceId = ((relResult as any).rows || [])[0]?.related_invoice_id;
        if (!relInvoiceId) {
          throw new ApiError(400, 'NC/ND requiere una factura original asociada (related_invoice_id)');
        }
        // Get the original invoice data for CbtesAsoc
        const origResult = await db.execute(sql`
          SELECT i.invoice_type, i.invoice_number, i.invoice_date, i.cae,
            (i.afip_response->'FeCabResp'->>'PtoVta')::int as punto_venta,
            c.cuit as customer_cuit
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.id = ${relInvoiceId}
        `);
        const origInv = ((origResult as any).rows || [])[0];
        if (!origInv) {
          throw new ApiError(404, 'Factura original asociada no encontrada');
        }
        if (!origInv.cae) {
          throw new ApiError(400, 'La factura original debe estar autorizada en AFIP para emitir NC/ND');
        }

        // Validate NC amount doesn't exceed original invoice total
        if (invoiceType.startsWith('NC_')) {
          const origTotal = await db.execute(sql`SELECT CAST(total_amount AS decimal) as total FROM invoices WHERE id = ${relInvoiceId}`);
          const origTotalAmt = parseFloat(((origTotal as any).rows || [])[0]?.total || '0');
          const ncAmt = parseFloat(invoice.total_amount?.toString() || '0');
          if (ncAmt > origTotalAmt) {
            throw new ApiError(400, `El monto de la NC ($${ncAmt}) no puede exceder el total de la factura original ($${origTotalAmt})`);
          }
        }

        // Map original invoice_type to AFIP CbteTipo code
        const ORIG_TYPE_MAP: Record<string, number> = { 'A': 1, 'B': 6, 'C': 11 };
        const origCbteTipo = ORIG_TYPE_MAP[origInv.invoice_type] || 6;
        const origPtoVta = origInv.punto_venta || puntoVenta;
        const origDate = new Date(origInv.invoice_date);
        const origFch = `${origDate.getFullYear()}${String(origDate.getMonth() + 1).padStart(2, '0')}${String(origDate.getDate()).padStart(2, '0')}`;
        const origCuit = (origInv.customer_cuit || customerCuit || '').replace(/-/g, '');

        cbtesAsoc = [{
          tipo: origCbteTipo,
          ptoVta: origPtoVta,
          nro: origInv.invoice_number,
          cuit: origCuit,
          cbteFch: origFch,
        }];
      }

      // Multi-currency: resolve AFIP currency codes
      const invoiceCurrency = invoice.currency || 'ARS';
      const AFIP_CURRENCY_MAP: Record<string, string> = { ARS: 'PES', USD: 'DOL', EUR: '060' };
      const monId = AFIP_CURRENCY_MAP[invoiceCurrency] || 'PES';
      const monCotiz = invoiceCurrency !== 'ARS' && invoice.exchange_rate ? parseFloat(invoice.exchange_rate.toString()) : 1;

      // Build export data if this is a Tipo E invoice
      const isExportInvoice = ['E', 'NC_E', 'ND_E'].includes(invoiceType);
      let exportData: AuthorizeInvoiceInput['exportData'] | undefined;
      if (isExportInvoice) {
        const exportRow = await db.execute(sql`
          SELECT export_type, destination_country, incoterms, export_permit,
            export_client_name, export_client_address, export_client_tax_id, export_language
          FROM invoices WHERE id = ${invoiceId}
        `);
        const exp = ((exportRow as any).rows || [])[0];
        // AFIP country code mapping (common ones; destination_country stores AFIP code directly)
        const dstCmp = parseInt(exp?.destination_country || '0') || 200;
        // Country CUIT mapping (fallback to generic)
        const COUNTRY_CUIT_MAP: Record<number, number> = {
          200: 50000000016, // Argentina
          203: 50000000028, // Brazil
          205: 50000000032, // USA
          212: 50000000044, // UK
          219: 50000000056, // France
          220: 50000000060, // Germany
          224: 50000000068, // Italy
          238: 50000000076, // Spain
          249: 50000000084, // Uruguay
          250: 50000000092, // Chile
        };
        exportData = {
          dstCmp,
          cliente: exp?.export_client_name || invoice.customer?.name || 'Foreign Client',
          domicilioCliente: exp?.export_client_address || 'Address not specified',
          idImpositivo: exp?.export_client_tax_id || '',
          cuitPaisCliente: COUNTRY_CUIT_MAP[dstCmp] || 55000000016,
          tipoExpo: parseInt(exp?.export_type || '1') || 1,
          permisoExistente: exp?.export_permit ? 'S' : 'N',
          idiomaCbte: parseInt(exp?.export_language || '1') || 1,
          incoterms: exp?.incoterms || undefined,
          formaPago: 'Wire Transfer',
        };
      }

      const authInput: AuthorizeInvoiceInput = {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        invoiceType: invoiceType as AuthorizeInvoiceInput['invoiceType'],
        concepto,
        customerCuit,
        condicionIvaReceptorId,
        fchServDesde,
        fchServHasta,
        fchVtoPago,
        subtotal: Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0 ? neto : parseFloat(invoice.subtotal?.toString() || '0'),
        vat: Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0 ? iva : parseFloat(invoice.vat_amount?.toString() || '0'),
        total: Math.abs(calculatedTotal - invoiceTotal) > 0.01 && invoiceTotal > 0 ? calculatedTotal : parseFloat(invoice.total_amount?.toString() || '0'),
        invoiceDate: invoice.invoice_date ? new Date(invoice.invoice_date) : new Date(),
        puntoVenta,
        monId,
        monCotiz,
        items: itemsList.map((i: any) => ({
          quantity: Number(i.quantity),
          unitPrice: parseFloat(i.unit_price?.toString() || '0'),
          vatRate: parseFloat((i.vat_rate || '21').toString()),
          description: i.product_name || '',
        })),
        cbtesAsoc,
        exportData,
      };

      // Authorize with AFIP (real or mock).
      // The lockClient row-lock on invoices is still held here — any concurrent
      // authorizeInvoice() call on the same row will block at the FOR UPDATE
      // above until we COMMIT below.
      const authorization = await afipService.authorizeInvoice(companyId, authInput);

      // Save authorization result
      await afipService.saveAuthorizedInvoice(invoiceId, authorization);

      // NC impact on saldos: create cobro_invoice_application to reduce original invoice balance
      if (isNcNd && invoiceType.startsWith('NC_')) {
        const relResult2 = await db.execute(sql`SELECT related_invoice_id FROM invoices WHERE id = ${invoiceId}`);
        const relInvoiceId2 = ((relResult2 as any).rows || [])[0]?.related_invoice_id;
        if (relInvoiceId2) {
          const ncTotal = Math.abs(parseFloat(invoice.total_amount?.toString() || '0'));
          if (ncTotal > 0) {
            const appId = require('uuid').v4();
            await db.execute(sql`
              INSERT INTO cobro_invoice_applications (id, cobro_id, invoice_id, amount_applied, created_at)
              VALUES (${appId}, ${invoiceId}, ${relInvoiceId2}, ${ncTotal.toString()}, NOW())
            `);
          }
        }
      }

      // Return updated invoice
      const updated = await this.getInvoice(companyId, invoiceId);

      // CRM Pipeline sync: invoice_authorized
      try {
        // If invoice has order_id, link to same deal as that order
        if (invoice.order_id) {
          const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, invoice.order_id, 'order');
          if (existingDeal) {
            await crmSyncService.linkDocumentToDeal(existingDeal.id, 'invoice', invoiceId);
          }
        }

        const invEnterpriseId = updated.enterprise_id || (updated.enterprise ? updated.enterprise.id : null);
        await crmSyncService.handleEvent({
          companyId,
          event: 'invoice_authorized',
          enterpriseId: invEnterpriseId || undefined,
          customerId: invoice.customer_id || undefined,
          documentId: invoiceId,
          documentType: 'invoice',
          metadata: {
            title: `Factura #${invoice.invoice_number || ''}`,
            amount: parseFloat(updated.total_amount?.toString() || '0'),
          },
        });
      } catch (e) { console.error('CRM sync error (invoice_authorized):', e); }

      // Accounting entry
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        const itemsForAccounting = (itemsList || []).map((i: any) => ({
          quantity: Number(i.quantity || 1),
          unit_price: parseFloat(i.unit_price?.toString() || '0'),
          vat_rate: parseFloat((i.vat_rate || '21').toString()),
        }));
        await accountingEntriesService.createEntryForInvoice({
          id: invoiceId,
          company_id: companyId,
          date: invoice.invoice_date ? new Date(invoice.invoice_date).toISOString() : new Date().toISOString(),
          total: parseFloat(updated.total_amount?.toString() || '0'),
          subtotal: parseFloat(updated.subtotal?.toString() || updated.net_amount?.toString() || '0'),
          vat_amount: parseFloat(updated.vat_amount?.toString() || '0'),
          invoice_type: invoiceType,
          items: itemsForAccounting,
        });
      } catch (accErr) { console.warn('Accounting entry skipped (invoice):', (accErr as Error).message); }

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId: userId || 'system',
          module: 'invoices',
          action: 'authorize',
          entityType: 'invoice',
          entityId: invoiceId,
          circuit: 'fiscal',
          metadata: {
            invoice_type: invoiceType,
            invoice_number: invoice.invoice_number,
            cae: (updated as any).cae,
            punto_venta: puntoVenta,
          },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      // Wave 3A: commit the authorization lock transaction. From here on
      // other concurrent authorize calls on this invoice will see status !=
      // 'draft' and fail fast at the FOR UPDATE guard above.
      await lockClient.query('COMMIT');
      return updated;
    } catch (error) {
      await lockClient.query('ROLLBACK').catch(() => {});
      if (error instanceof ApiError) throw error;
      console.error('Authorize invoice error:', error);
      throw new ApiError(500, 'Error al autorizar factura');
    } finally {
      lockClient.release();
    }
  }
  /**
   * Get remaining amount to invoice for an order.
   * order.total - SUM(invoices.total_amount) for non-cancelled invoices.
   */
  async getOrderRemainingToInvoice(companyId: string, orderId: string) {
    const result = await db.execute(sql`
      SELECT
        CAST(o.total_amount AS decimal) as order_total,
        COALESCE(SUM(CAST(i.total_amount AS decimal)), 0) as invoiced_total
      FROM orders o
      LEFT JOIN invoices i ON i.order_id = o.id AND i.status != 'cancelled'
      WHERE o.id = ${orderId} AND o.company_id = ${companyId}
      GROUP BY o.id, o.total_amount
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) throw new ApiError(404, 'Pedido no encontrado');

    const orderTotal = parseFloat(row.order_total);
    const invoicedTotal = parseFloat(row.invoiced_total);

    return {
      order_id: orderId,
      order_total: orderTotal,
      invoiced_total: invoicedTotal,
      remaining: Math.max(0, orderTotal - invoicedTotal),
    };
  }

  /**
   * Get all invoices for a specific order.
   */
  async getInvoicesByOrder(companyId: string, orderId: string) {
    const result = await db.execute(sql`
      SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date,
        i.subtotal, i.vat_amount, i.total_amount, i.status, i.fiscal_type,
        i.payment_status, i.cae,
        e.name as enterprise_name
      FROM invoices i
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      WHERE i.order_id = ${orderId} AND i.company_id = ${companyId}
      ORDER BY i.invoice_date DESC
    `);
    return (result as any).rows || [];
  }
  /**
   * Get order items available for invoicing (not yet fully invoiced).
   * Supports multi-order: returns items from all orders of a company/enterprise.
   */
  async getAvailableOrderItemsForInvoicing(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
  } = {}) {
    await this.ensureMigrations();
    try {
    // Build query with pool.query for complex WHERE with subquery
    const params: any[] = [companyId];
    let enterpriseFilter = '';
    if (filters.enterprise_id) {
      params.push(filters.enterprise_id);
      // Match orders by enterprise_id directly, or by customer linked to that enterprise
      // Use LEFT JOIN approach to avoid subquery on customers.enterprise_id which may not exist yet
      enterpriseFilter = ` AND (o.enterprise_id = $${params.length} OR EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.company_id = $1 AND c.enterprise_id = $${params.length}))`;
    }
    // Ensure required columns exist before query
    try { await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS enterprise_id UUID'); } catch {}
    try { await pool.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21'); } catch {}
    try { await pool.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS deduct_stock BOOLEAN DEFAULT FALSE'); } catch {}

    const { rows } = await pool.query(`
      WITH item_invoiced AS (
        SELECT ii.order_item_id, COALESCE(SUM(CAST(ii.quantity AS decimal)), 0) as qty_invoiced
        FROM invoice_items ii
        JOIN invoices i ON ii.invoice_id = i.id
        WHERE i.status != 'cancelled'
          AND i.company_id = $1 AND ii.order_item_id IS NOT NULL
        GROUP BY ii.order_item_id
      )
      SELECT
        o.id as order_id, o.order_number, o.title as order_title, o.enterprise_id,
        e.name as enterprise_name,
        oi.id as order_item_id, oi.product_id, oi.product_name, oi.description,
        CAST(oi.quantity AS decimal) as quantity,
        CAST(oi.unit_price AS decimal) as unit_price,
        CAST(oi.subtotal AS decimal) as subtotal,
        COALESCE(CAST(oi.vat_rate AS decimal), 21) as vat_rate,
        COALESCE(inv.qty_invoiced, 0) as qty_invoiced,
        CAST(oi.quantity AS decimal) - COALESCE(inv.qty_invoiced, 0) as qty_remaining
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      LEFT JOIN item_invoiced inv ON inv.order_item_id = oi.id
      WHERE o.company_id = $1 AND o.status NOT IN ('cancelado', 'cancelled')
        ${enterpriseFilter}
        AND (CAST(oi.quantity AS decimal) - COALESCE(inv.qty_invoiced, 0)) > 0
        AND oi.quantity IS NOT NULL AND CAST(oi.quantity AS decimal) > 0
      ORDER BY o.order_number DESC, oi.created_at ASC
    `, params);
    console.log('getAvailableOrderItemsForInvoicing:', { companyId, filters, resultCount: rows?.length || 0 });
    return rows || [];
  } catch (err) {
    console.error('getAvailableOrderItemsForInvoicing ERROR:', (err as Error).message, { companyId, filters });
    throw err;
  }
  }

  /**
   * Get invoice detail for expandable row (items + cobros applied + balance).
   *
   * Sol/Luna: non-Luna users requesting a Luna invoice must get 404 (existence
   * leak prevention). The fiscal_type is read from the initial SELECT and the
   * check happens BEFORE emitting items/cobros queries, so a Luna invoice never
   * leaks its items/applications to Sol users.
   */
  async getInvoiceDetail(companyId: string, invoiceId: string, userCanAccessLuna: boolean = true) {
    // Invoice row first — needed to enforce the Luna gate before returning any child rows.
    const invResult = await db.execute(sql`
      SELECT i.fiscal_type, i.total_amount, i.subtotal, i.vat_amount, i.invoice_type, i.invoice_number,
        e.name as enterprise_name, e.cuit as enterprise_cuit, e.address as enterprise_address, e.tax_condition,
        cust.name as customer_name
      FROM invoices i
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      LEFT JOIN customers cust ON i.customer_id = cust.id
      WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}
    `);
    const invoice = ((invResult as any).rows || [])[0];
    if (!invoice) return null;

    // Sol/Luna row-level guard: missing fiscal_type is treated as 'fiscal' (legacy rows).
    const invoiceFiscal = (invoice.fiscal_type || 'fiscal') as 'fiscal' | 'no_fiscal';
    if (invoiceFiscal === 'no_fiscal' && !userCanAccessLuna) {
      return null; // controller maps null -> 404
    }

    // Items (with order info for grouping)
    const itemsResult = await db.execute(sql`
      SELECT ii.*, p.name as product_name, p.sku,
        oi_ref.order_id,
        o_ref.order_number, o_ref.title as order_title,
        e_ref.name as order_enterprise_name
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
      LEFT JOIN order_items oi_ref ON ii.order_item_id = oi_ref.id
      LEFT JOIN orders o_ref ON oi_ref.order_id = o_ref.id
      LEFT JOIN enterprises e_ref ON o_ref.enterprise_id = e_ref.id
      WHERE ii.invoice_id = ${invoiceId}
      ORDER BY o_ref.order_number ASC NULLS LAST, ii.created_at ASC
    `);
    const items = (itemsResult as any).rows || [];

    // Cobros aplicados
    const cobrosResult = await db.execute(sql`
      SELECT cia.amount_applied, cia.applied_at,
        c.id as cobro_id, c.receipt_number, c.payment_date, c.payment_method,
        CAST(c.amount AS decimal) as cobro_amount
      FROM cobro_invoice_applications cia
      JOIN cobros c ON cia.cobro_id = c.id
      WHERE cia.invoice_id = ${invoiceId}
        AND (c.status IS NULL OR c.status != 'anulado')
      ORDER BY cia.applied_at ASC
    `);
    const cobros_aplicados = (cobrosResult as any).rows || [];

    // Saldo pendiente
    const totalApplied = cobros_aplicados.reduce((s: number, c: any) => s + parseFloat(c.amount_applied || 0), 0);

    const total = parseFloat(invoice.total_amount || 0);

    return {
      items,
      cobros_aplicados,
      saldo_pendiente: Math.max(total - totalApplied, 0),
      total,
      enterprise: {
        name: invoice.enterprise_name,
        cuit: invoice.enterprise_cuit,
        address: invoice.enterprise_address,
        tax_condition: invoice.tax_condition,
      },
      customer_name: invoice.customer_name,
    };
  }

  /**
   * Get invoice items with payment remaining per item.
   */
  async getInvoiceItemsWithRemaining(companyId: string, invoiceId: string) {
    const result = await db.execute(sql`
      SELECT ii.*,
        CAST(ii.subtotal AS decimal) as item_total,
        0 as paid,
        CAST(ii.subtotal AS decimal) as remaining
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE ii.invoice_id = ${invoiceId} AND i.company_id = ${companyId}
      ORDER BY ii.created_at ASC
    `);
    return (result as any).rows || [];
  }
}

export const invoicesService = new InvoicesService();
