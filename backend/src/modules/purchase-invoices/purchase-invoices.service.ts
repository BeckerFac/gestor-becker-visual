import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

// ===== Constants =====
const VALID_INVOICE_TYPES = new Set([
  'A', 'B', 'C', 'E', 'M',
  'NC_A', 'NC_B', 'NC_C', 'NC_E',
  'ND_A', 'ND_B', 'ND_C', 'ND_E',
]);
const NC_TYPES = new Set(['NC_A', 'NC_B', 'NC_C', 'NC_E']);

const ALWAYS_EDITABLE_FIELDS = new Set(['notes', 'attachment_url']);
const LOCKED_FISCAL_FIELDS = new Set([
  'total_amount', 'subtotal', 'vat_amount', 'other_taxes',
  'invoice_type', 'invoice_number', 'punto_venta', 'cae',
  'cae_expiry_date', 'invoice_date', 'enterprise_id', 'related_invoice_id',
]);

// ===== Validators =====
function validateCUIT(cuit: string): boolean {
  const clean = (cuit || '').replace(/\D/g, '');
  if (clean.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(clean[i]) * weights[i];
  const mod = sum % 11;
  const check = 11 - mod;
  const expected = check === 11 ? 0 : check === 10 ? 9 : check;
  return Number(clean[10]) === expected;
}

function validateInvoiceNumber(num: string): boolean {
  if (!num) return false;
  // Accept either "12345678" or "0001-00012345" (formal AFIP format)
  return /^\d{1,12}$/.test(num) || /^\d{1,5}-\d{1,12}$/.test(num);
}

function validatePuntoVenta(pv: string | undefined | null): boolean {
  if (pv === null || pv === undefined || pv === '') return true; // optional
  return /^\d{1,5}$/.test(pv);
}

function validateCAE(cae: string | undefined | null): boolean {
  if (!cae) return true; // optional
  return /^\d{14}$/.test(cae);
}

function validateInvoiceDateNotFuture(dateStr: string): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  // Allow up to +1 day for clock skew / TZ.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);
  return d.getTime() <= tomorrow.getTime();
}

function validateTotalsCoherence(
  subtotal: number,
  vat: number,
  other: number,
  total: number,
): boolean {
  return Math.abs(subtotal + vat + other - total) <= 0.02;
}

export class PurchaseInvoicesService {

  async getPurchaseInvoices(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
    purchase_id?: string;
    payment_status?: string;
    status?: string;
  } = {}) {
    let whereClause = sql`pi.company_id = ${companyId}`;

    if (filters.business_unit_id) {
      // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
      whereClause = sql`${whereClause} AND (pi.business_unit_id = ${filters.business_unit_id} OR pi.business_unit_id IS NULL)`;
    }
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND pi.enterprise_id = ${filters.enterprise_id}`;
    }
    if (filters.purchase_id) {
      whereClause = sql`${whereClause} AND pi.purchase_id = ${filters.purchase_id}`;
    }
    if (filters.payment_status) {
      whereClause = sql`${whereClause} AND pi.payment_status = ${filters.payment_status}`;
    }
    if (filters.status) {
      whereClause = sql`${whereClause} AND pi.status = ${filters.status}`;
    }

    const result = await db.execute(sql`
      SELECT pi.*,
        e.name as enterprise_name,
        e.cuit as enterprise_cuit,
        p.purchase_number,
        bu.name as business_unit_name,
        pi.total_amount - COALESCE((
          SELECT SUM(CAST(pia.amount_applied AS decimal))
          FROM pago_invoice_applications pia
          WHERE pia.purchase_invoice_id = pi.id
        ), 0) - COALESCE((
          SELECT SUM(CAST(nc.total_amount AS decimal))
          FROM purchase_invoices nc
          WHERE nc.related_invoice_id = pi.id
            AND nc.status NOT IN ('cancelled', 'cancelado')
        ), 0) as remaining_balance
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN business_units bu ON pi.business_unit_id = bu.id
      WHERE ${whereClause}
      ORDER BY pi.invoice_date DESC
    `);
    return (result as any).rows || [];
  }

  async getPurchaseInvoice(companyId: string, piId: string) {
    const result = await db.execute(sql`
      SELECT pi.*,
        e.name as enterprise_name,
        e.cuit as enterprise_cuit,
        p.purchase_number,
        bu.name as business_unit_name
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN business_units bu ON pi.business_unit_id = bu.id
      WHERE pi.id = ${piId} AND pi.company_id = ${companyId}
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) throw new ApiError(404, 'Factura de compra no encontrada');
    return row;
  }

  /**
   * C1/C3/C4/C5/C7/C8/C9 — createPurchaseInvoice fully transactional with:
   * duplicate detection, IDOR guard, fiscal validations, NC support, items + accounting.
   */
  async createPurchaseInvoice(companyId: string, userId: string, data: {
    business_unit_id: string;
    enterprise_id: string;
    purchase_id?: string;
    invoice_type: string;
    punto_venta?: string;
    invoice_number: string;
    invoice_date: string;
    cae?: string;
    cae_expiry_date?: string;
    subtotal?: number;
    vat_amount?: number;
    other_taxes?: number;
    total_amount: number;
    notes?: string;
    related_invoice_id?: string;
    items?: Array<{ product_name: string; description?: string; quantity: number; unit_price: number; purchase_item_id?: string; product_id?: string; vat_rate?: number }>;
    retenciones_previstas?: Array<{ type: string; rate: number; estimated_amount: number }>;
  }) {
    // Auto-assign default business_unit_id if not provided
    if (!data.business_unit_id) {
      try {
        const buResult = await db.execute(sql`SELECT id FROM business_units WHERE company_id = ${companyId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
        const defaultBu = ((buResult as any).rows || [])[0];
        if (defaultBu) data.business_unit_id = defaultBu.id;
      } catch { /* no business units yet */ }
    }

    // ===== Basic required fields =====
    if (!data.business_unit_id) throw new ApiError(400, 'Razon social requerida');
    if (!data.enterprise_id) throw new ApiError(400, 'Proveedor requerido');
    if (!data.invoice_type) throw new ApiError(400, 'Tipo de factura requerido');
    if (!data.invoice_number) throw new ApiError(400, 'Numero de factura requerido');
    if (!data.invoice_date) throw new ApiError(400, 'Fecha de factura requerida');
    if (data.total_amount === undefined || data.total_amount === null || Number(data.total_amount) < 0.01) {
      throw new ApiError(400, 'Monto total requerido (>= 0.01)');
    }

    // ===== C4: Format validations =====
    if (!VALID_INVOICE_TYPES.has(data.invoice_type)) {
      throw new ApiError(400, `Tipo de factura invalido: ${data.invoice_type}`);
    }
    if (!validateInvoiceNumber(data.invoice_number)) {
      throw new ApiError(400, 'Formato de numero de factura invalido');
    }
    if (!validatePuntoVenta(data.punto_venta)) {
      throw new ApiError(400, 'Punto de venta invalido (debe ser numerico)');
    }
    if (!validateCAE(data.cae)) {
      throw new ApiError(400, 'CAE invalido (debe ser 14 digitos)');
    }
    if (!validateInvoiceDateNotFuture(data.invoice_date)) {
      throw new ApiError(400, 'La fecha de factura no puede ser futura');
    }
    const sub = Number(data.subtotal || 0);
    const vat = Number(data.vat_amount || 0);
    const other = Number(data.other_taxes || 0);
    const total = Number(data.total_amount);
    if (sub < 0 || vat < 0 || other < 0) throw new ApiError(400, 'Montos no pueden ser negativos');
    if (sub > 0 && !validateTotalsCoherence(sub, vat, other, total)) {
      throw new ApiError(400, `Totales incoherentes: subtotal+IVA+otros (${(sub + vat + other).toFixed(2)}) != total (${total.toFixed(2)})`);
    }

    // ===== NC requires related_invoice_id =====
    const isNC = NC_TYPES.has(data.invoice_type);
    if (isNC && !data.related_invoice_id) {
      throw new ApiError(400, 'Nota de credito requiere factura original (related_invoice_id)');
    }
    if (!isNC && data.related_invoice_id) {
      throw new ApiError(400, 'related_invoice_id solo aplica a notas de credito');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ===== Verify business_unit belongs to company =====
      const buCheck = await client.query(
        `SELECT id FROM business_units WHERE id = $1 AND company_id = $2`,
        [data.business_unit_id, companyId],
      );
      if (buCheck.rows.length === 0) {
        throw new ApiError(400, 'Razon social no valida');
      }

      // ===== Verify enterprise belongs to company + validate CUIT =====
      const entCheck = await client.query(
        `SELECT id, cuit FROM enterprises WHERE id = $1 AND company_id = $2`,
        [data.enterprise_id, companyId],
      );
      if (entCheck.rows.length === 0) {
        throw new ApiError(400, 'Proveedor no valido');
      }
      const supplierCuit = entCheck.rows[0].cuit;
      if (supplierCuit && !validateCUIT(String(supplierCuit))) {
        // Relaxed: warn but do not fail already-saved bad CUITs; only fail if obviously malformed.
        if (String(supplierCuit).replace(/\D/g, '').length !== 11) {
          throw new ApiError(400, 'El CUIT del proveedor es invalido');
        }
      }

      // ===== C3: IDOR fix on purchase_id =====
      if (data.purchase_id) {
        const r = await client.query(
          `SELECT id, enterprise_id FROM purchases WHERE id = $1 AND company_id = $2`,
          [data.purchase_id, companyId],
        );
        if (r.rows.length === 0) throw new ApiError(400, 'Compra no encontrada');
        if (r.rows[0].enterprise_id !== data.enterprise_id) {
          throw new ApiError(400, 'La compra pertenece a otro proveedor');
        }
      }

      // ===== C7: Validate related_invoice_id for NCs =====
      if (isNC && data.related_invoice_id) {
        const origR = await client.query(
          `SELECT id, enterprise_id, total_amount FROM purchase_invoices
           WHERE id = $1 AND company_id = $2 AND status NOT IN ('cancelled', 'cancelado')`,
          [data.related_invoice_id, companyId],
        );
        if (origR.rows.length === 0) {
          throw new ApiError(400, 'Factura original no encontrada o cancelada');
        }
        if (origR.rows[0].enterprise_id !== data.enterprise_id) {
          throw new ApiError(400, 'La factura original pertenece a otro proveedor');
        }
      }

      // ===== C1: Duplicate detection =====
      const dupR = await client.query(
        `SELECT id FROM purchase_invoices
         WHERE company_id = $1 AND enterprise_id = $2 AND invoice_type = $3
           AND COALESCE(punto_venta, '') = COALESCE($4, '')
           AND invoice_number = $5
           AND status NOT IN ('cancelled', 'cancelado')
         LIMIT 1`,
        [companyId, data.enterprise_id, data.invoice_type, data.punto_venta || null, data.invoice_number],
      );
      if (dupR.rows.length > 0) {
        throw new ApiError(
          409,
          `Esta factura ya fue cargada (ID existente: ${dupR.rows[0].id})`,
          { existing_id: dupR.rows[0].id },
        );
      }

      const piId = uuid();
      const piCurrency = (data as any).currency || 'ARS';
      const piExchangeRate = (data as any).exchange_rate ? parseFloat((data as any).exchange_rate) : null;
      const retencionesPrevistas = JSON.stringify(data.retenciones_previstas || []);

      // ===== INSERT header =====
      await client.query(
        `INSERT INTO purchase_invoices (
          id, company_id, business_unit_id, enterprise_id, purchase_id,
          invoice_type, punto_venta, invoice_number, invoice_date,
          cae, cae_expiry_date,
          subtotal, vat_amount, other_taxes, total_amount,
          notes, created_by, currency, exchange_rate, retenciones_previstas,
          related_invoice_id, status
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19, $20::jsonb,
          $21, 'active'
        )`,
        [
          piId, companyId, data.business_unit_id, data.enterprise_id, data.purchase_id || null,
          data.invoice_type, data.punto_venta || null, data.invoice_number, data.invoice_date,
          data.cae || null, data.cae_expiry_date || null,
          sub.toString(), vat.toString(), other.toString(), total.toString(),
          data.notes || null, userId, piCurrency, piExchangeRate, retencionesPrevistas,
          data.related_invoice_id || null,
        ],
      );

      // ===== Insert items (C8: in the same transaction) =====
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        for (const item of data.items) {
          if (!item.product_name || !item.quantity || item.unit_price === undefined) continue;
          const qty = parseFloat(String(item.quantity)) || 1;
          const price = parseFloat(String(item.unit_price)) || 0;
          const itemSubtotal = qty * price;
          const vatRate = item.vat_rate !== undefined ? parseFloat(String(item.vat_rate)) : 21;
          await client.query(
            `INSERT INTO purchase_invoice_items (
              id, purchase_invoice_id, product_name, description, quantity, unit_price, subtotal,
              purchase_item_id, product_id, vat_rate
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              uuid(), piId, item.product_name, item.description || null,
              qty.toString(), price.toString(), itemSubtotal.toString(),
              item.purchase_item_id || null, item.product_id || null, vatRate.toString(),
            ],
          );
        }
      }

      await client.query('COMMIT');

      // ===== Accounting entry (post-commit; failure does not rollback header) =====
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        const piItems = (data.items || []).map((i: any) => ({
          quantity: Number(i.quantity || 1),
          unit_price: parseFloat(i.unit_price?.toString() || '0'),
          vat_rate: parseFloat(((i as any).vat_rate || '21').toString()),
        }));
        await accountingEntriesService.createEntryForPurchaseInvoice({
          id: piId,
          company_id: companyId,
          date: data.invoice_date,
          total: total,
          subtotal: sub,
          vat_amount: vat,
          invoice_type: (data as any).invoice_type,
          items: piItems,
        });
      } catch (accErr) {
        console.warn('Accounting entry skipped (purchase_invoice):', (accErr as Error).message);
      }

      return this.getPurchaseInvoice(companyId, piId);
    } catch (err) {
      await client.query('ROLLBACK').catch(e => console.error('ROLLBACK failed:', e.message));
      throw err;
    } finally {
      client.release();
    }
  }

  async getPurchaseInvoiceItems(companyId: string, piId: string) {
    // Verify ownership
    await this.getPurchaseInvoice(companyId, piId);

    const result = await db.execute(sql`
      SELECT pii.*,
        CAST(pii.subtotal AS decimal) as remaining
      FROM purchase_invoice_items pii
      WHERE pii.purchase_invoice_id = ${piId}
      ORDER BY pii.created_at ASC
    `);
    return (result as any).rows || [];
  }

  /**
   * C6: Fixed — purchase_invoice_items.purchase_item_id column added in ensureTables.
   * Get purchase items available for invoicing (not yet fully invoiced).
   */
  async getAvailablePurchaseItemsForInvoicing(companyId: string, filters: {
    enterprise_id?: string;
  } = {}) {
    let whereClause = sql`p.company_id = ${companyId} AND p.status != 'cancelada'`;
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
    }

    const result = await db.execute(sql`
      SELECT
        p.id as purchase_id, p.purchase_number, p.enterprise_id,
        e.name as enterprise_name,
        pi.id as purchase_item_id, pi.product_name, pi.description,
        CAST(pi.quantity AS decimal) as quantity,
        CAST(pi.unit_price AS decimal) as unit_price,
        CAST(pi.subtotal AS decimal) as subtotal,
        COALESCE((
          SELECT SUM(CAST(pii.quantity AS decimal))
          FROM purchase_invoice_items pii
          JOIN purchase_invoices pinv ON pii.purchase_invoice_id = pinv.id
          WHERE pii.purchase_item_id = pi.id AND pinv.status NOT IN ('cancelled', 'cancelado')
        ), 0) as qty_invoiced,
        CAST(pi.quantity AS decimal) - COALESCE((
          SELECT SUM(CAST(pii.quantity AS decimal))
          FROM purchase_invoice_items pii
          JOIN purchase_invoices pinv ON pii.purchase_invoice_id = pinv.id
          WHERE pii.purchase_item_id = pi.id AND pinv.status NOT IN ('cancelled', 'cancelado')
        ), 0) as qty_remaining
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN enterprises e ON p.enterprise_id = e.id
      WHERE ${whereClause}
      ORDER BY p.purchase_number DESC, pi.created_at ASC
    `);
    return (result as any).rows || [];
  }

  /**
   * C2: Fiscal immutability. Blocks editing of locked fields when payments exist.
   */
  async updatePurchaseInvoice(companyId: string, piId: string, data: any) {
    // Verify exists
    const existing = await this.getPurchaseInvoice(companyId, piId);

    // Status transition rules
    if (existing.status === 'cancelled' || existing.status === 'cancelado') {
      throw new ApiError(409, 'La factura esta cancelada y no puede modificarse');
    }
    if (data.status !== undefined) {
      const target = String(data.status);
      const current = String(existing.status);
      const allowed =
        (current === 'draft' && target === 'active') ||
        (current === 'active' && target === 'cancelled') ||
        (current === target);
      if (!allowed) {
        throw new ApiError(409, `Transicion de estado invalida: ${current} -> ${target}`);
      }
    }

    // Check if any payments are applied
    const pagoCheck = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM pago_invoice_applications WHERE purchase_invoice_id = $1) AS has_pagos`,
      [piId],
    );
    const hasPagos = pagoCheck.rows[0]?.has_pagos === true;

    // If payments exist, reject any attempt to change locked fiscal fields.
    if (hasPagos) {
      const attemptedLocked: string[] = [];
      for (const key of Object.keys(data)) {
        if (LOCKED_FISCAL_FIELDS.has(key) && data[key] !== undefined) {
          // Compare against existing to allow no-op passes.
          const newVal = String(data[key] ?? '');
          const oldVal = String((existing as any)[key] ?? '');
          if (newVal !== oldVal) attemptedLocked.push(key);
        }
      }
      if (attemptedLocked.length > 0) {
        throw new ApiError(
          409,
          `Campos fiscales bloqueados: la factura tiene pagos aplicados. No se puede modificar: ${attemptedLocked.join(', ')}`,
          { locked_fields: attemptedLocked },
        );
      }
    }

    // Validate mutated fiscal values (even when no pagos).
    if (data.invoice_type !== undefined && !VALID_INVOICE_TYPES.has(data.invoice_type)) {
      throw new ApiError(400, `Tipo de factura invalido: ${data.invoice_type}`);
    }
    if (data.invoice_number !== undefined && !validateInvoiceNumber(data.invoice_number)) {
      throw new ApiError(400, 'Formato de numero de factura invalido');
    }
    if (data.punto_venta !== undefined && !validatePuntoVenta(data.punto_venta)) {
      throw new ApiError(400, 'Punto de venta invalido');
    }
    if (data.cae !== undefined && !validateCAE(data.cae)) {
      throw new ApiError(400, 'CAE invalido (debe ser 14 digitos)');
    }
    if (data.invoice_date !== undefined && !validateInvoiceDateNotFuture(data.invoice_date)) {
      throw new ApiError(400, 'La fecha de factura no puede ser futura');
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const updatableFields: Record<string, any> = {
      invoice_type: data.invoice_type,
      punto_venta: data.punto_venta,
      invoice_number: data.invoice_number,
      invoice_date: data.invoice_date,
      cae: data.cae,
      cae_expiry_date: data.cae_expiry_date,
      subtotal: data.subtotal?.toString(),
      vat_amount: data.vat_amount?.toString(),
      other_taxes: data.other_taxes?.toString(),
      total_amount: data.total_amount?.toString(),
      purchase_id: data.purchase_id,
      notes: data.notes,
      status: data.status,
    };

    // Handle retenciones_previstas as JSONB
    if (data.retenciones_previstas !== undefined) {
      setClauses.push(`retenciones_previstas = $${paramIdx}::jsonb`);
      values.push(JSON.stringify(data.retenciones_previstas));
      paramIdx++;
    }

    for (const [key, val] of Object.entries(updatableFields)) {
      if (val !== undefined) {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) return this.getPurchaseInvoice(companyId, piId);

    setClauses.push(`updated_at = NOW()`);
    values.push(piId, companyId);

    await pool.query(
      `UPDATE purchase_invoices SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1}`,
      values,
    );

    return this.getPurchaseInvoice(companyId, piId);
  }

  /**
   * C5: Soft-cancel with reversal accounting entry.
   * Hard-delete is only allowed for draft invoices (no accounting impact).
   */
  async cancelPurchaseInvoice(companyId: string, piId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 3) {
      throw new ApiError(400, 'Motivo de cancelacion requerido (minimo 3 caracteres)');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock row
      const lockR = await client.query(
        `SELECT id, status, enterprise_id FROM purchase_invoices
         WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [piId, companyId],
      );
      if (lockR.rows.length === 0) {
        throw new ApiError(404, 'Factura de compra no encontrada');
      }
      const current = lockR.rows[0];
      if (current.status === 'cancelled' || current.status === 'cancelado') {
        throw new ApiError(409, 'La factura ya esta cancelada');
      }

      // Cancelling a factura with pagos non-anulados is allowed but requires reason
      // (already enforced above). The pagos will remain but this invoice is removed
      // from accounting via reversal. Downstream CC recalc must handle orphan pagos.
      await client.query(
        `UPDATE purchase_invoices
         SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2, updated_at = NOW()
         WHERE id = $3 AND company_id = $4`,
        [userId, reason, piId, companyId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(e => console.error('ROLLBACK failed:', e.message));
      throw err;
    } finally {
      client.release();
    }

    // Post-commit: reversal accounting entry (best effort)
    try {
      const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
      await accountingEntriesService.createReverseEntry(companyId, 'purchase_invoice', piId);
    } catch (accErr) {
      console.warn('Reverse accounting entry skipped (purchase_invoice):', (accErr as Error).message);
    }

    return { cancelled: true, id: piId };
  }

  async deletePurchaseInvoice(companyId: string, piId: string) {
    // Check for linked pagos
    const pagoCheck = await db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM pago_invoice_applications WHERE purchase_invoice_id = ${piId}
      ) as has_pagos
    `);
    if (((pagoCheck as any).rows || [])[0]?.has_pagos) {
      throw new ApiError(409, 'No se puede eliminar: tiene pagos vinculados. Cancelela en su lugar.');
    }

    // Allow hard delete only for drafts (no accounting entry emitted yet).
    const existing = await this.getPurchaseInvoice(companyId, piId);
    if (existing.status && existing.status !== 'draft') {
      throw new ApiError(
        409,
        'Solo se pueden eliminar facturas en estado draft. Use cancelPurchaseInvoice para facturas activas.',
      );
    }

    const result = await db.execute(sql`
      DELETE FROM purchase_invoices WHERE id = ${piId} AND company_id = ${companyId} RETURNING id
    `);
    if (((result as any).rows || []).length === 0) {
      throw new ApiError(404, 'Factura de compra no encontrada');
    }
    return { deleted: true };
  }

  /**
   * C7: Effective balance = total - sum(NCs) - sum(pagos aplicados).
   */
  async getPaymentBalance(companyId: string, piId: string) {
    const pi = await this.getPurchaseInvoice(companyId, piId);

    const appliedResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(amount_applied AS decimal)), 0) as total_applied
      FROM pago_invoice_applications
      WHERE purchase_invoice_id = ${piId}
    `);
    const totalApplied = parseFloat(((appliedResult as any).rows || [])[0]?.total_applied || '0');

    const ncResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_nc
      FROM purchase_invoices
      WHERE related_invoice_id = ${piId}
        AND company_id = ${companyId}
        AND status NOT IN ('cancelled', 'cancelado')
    `);
    const totalNc = parseFloat(((ncResult as any).rows || [])[0]?.total_nc || '0');

    const totalAmount = parseFloat(pi.total_amount);
    const effectiveTotal = Math.max(0, totalAmount - totalNc);
    const remaining = Math.max(0, effectiveTotal - totalApplied);

    return {
      purchase_invoice_id: piId,
      total_amount: totalAmount,
      total_nc: totalNc,
      effective_total: effectiveTotal,
      total_applied: totalApplied,
      remaining,
      payment_status: remaining === 0 && effectiveTotal > 0 ? 'pagado' : totalApplied > 0 ? 'parcial' : 'pendiente',
    };
  }

  /**
   * Get purchase invoices by purchase (1 purchase → N purchase invoices).
   */
  async getPurchaseInvoicesByPurchase(companyId: string, purchaseId: string) {
    const result = await db.execute(sql`
      SELECT pi.*,
        e.name as enterprise_name,
        pi.total_amount - COALESCE((
          SELECT SUM(CAST(pia.amount_applied AS decimal))
          FROM pago_invoice_applications pia
          WHERE pia.purchase_invoice_id = pi.id
        ), 0) as remaining_balance
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      WHERE pi.purchase_id = ${purchaseId} AND pi.company_id = ${companyId}
      ORDER BY pi.invoice_date DESC
    `);
    return (result as any).rows || [];
  }
}

export const purchaseInvoicesService = new PurchaseInvoicesService();
