import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { inventoryService } from '../inventory/inventory.service';

/**
 * PurchasesService handles purchase orders (compras).
 *
 * IMPORTANT: As of the Razones Sociales refactor (2026-03-23):
 * - purchases.invoice_type, invoice_number, invoice_cae are DEPRECATED embedded fields
 * - New system uses separate purchase_invoices table (1 purchase → N purchase invoices)
 * - Use PurchaseInvoicesService for CRUD on provider invoices
 * - Use PagoApplicationsService for linking pagos to purchase_invoices
 * - CC calculation uses purchase_invoices, not purchases directly
 */

// --- Helpers ---
function getRows(result: any): any[] {
  return (result as any)?.rows || result || [];
}

interface NumericOpts {
  min?: number;
  max?: number;
  required?: boolean;
}

function validateNumeric(value: any, name: string, opts: NumericOpts = {}): number {
  const { min = 0, max = 1e12, required = true } = opts;
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `${name} es requerido`);
    return 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ApiError(400, `${name} invalido (no es un numero)`);
  if (n < min) throw new ApiError(400, `${name} no puede ser menor a ${min}`);
  if (n > max) throw new ApiError(400, `${name} excede el maximo permitido`);
  return n;
}

export class PurchasesService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchases (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          purchase_number INTEGER NOT NULL,
          date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          invoice_type VARCHAR(5),
          invoice_number VARCHAR(50),
          invoice_cae VARCHAR(30),
          subtotal DECIMAL(12,2),
          vat_amount DECIMAL(12,2),
          total_amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50),
          payment_status VARCHAR(50) DEFAULT 'pendiente',
          bank_id UUID REFERENCES banks(id),
          notes TEXT,
          status VARCHAR(50) DEFAULT 'activa',
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS purchase_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          product_name VARCHAR(255) NOT NULL,
          description TEXT,
          quantity DECIMAL(12,2) DEFAULT 1,
          unit_price DECIMAL(12,2) NOT NULL,
          subtotal DECIMAL(12,2),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL`);
      await db.execute(sql`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21`);
      await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stock_added BOOLEAN DEFAULT false`);
      // C5: business_unit_id column + index (referenced in getPurchases WHERE and createPurchase INSERT)
      await db.execute(sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_purchases_business_unit ON purchases(business_unit_id) WHERE business_unit_id IS NOT NULL`);
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure purchases tables error:', error);
    }
  }

  /**
   * C1: Tenant validation. Rejects cross-tenant IDs (IDOR defense).
   * Called from createPurchase and updatePurchase before writing.
   */
  private async validateTenantRefs(companyId: string, data: any) {
    if (data.enterprise_id) {
      const r = await db.execute(sql`SELECT id FROM enterprises WHERE id = ${data.enterprise_id} AND company_id = ${companyId}`);
      if (getRows(r).length === 0) throw new ApiError(400, 'Proveedor no encontrado en tu empresa');
    }
    if (data.bank_id) {
      const r = await db.execute(sql`SELECT id FROM banks WHERE id = ${data.bank_id} AND company_id = ${companyId}`);
      if (getRows(r).length === 0) throw new ApiError(400, 'Banco no encontrado en tu empresa');
    }
    if (data.business_unit_id) {
      const r = await db.execute(sql`SELECT id FROM business_units WHERE id = ${data.business_unit_id} AND company_id = ${companyId}`);
      if (getRows(r).length === 0) throw new ApiError(400, 'Unidad de negocio no encontrada en tu empresa');
    }
    if (Array.isArray(data.items)) {
      const productIds: string[] = data.items
        .map((i: any) => i.product_id)
        .filter((pid: any) => pid && pid !== 'custom');
      if (productIds.length > 0) {
        const r = await db.execute(sql`
          SELECT id FROM products WHERE id = ANY(${productIds}::uuid[]) AND company_id = ${companyId}
        `);
        const found = new Set(getRows(r).map((x: any) => x.id));
        for (const pid of productIds) {
          if (!found.has(pid)) {
            throw new ApiError(400, `Producto ${pid} no encontrado en tu empresa`);
          }
        }
      }
    }
  }

  /**
   * C3+C2: Compute per-item subtotal, VAT and totals with full numeric validation.
   * Returns {items: normalizedItems, subtotal, vatAmount, total}.
   */
  private computeTotals(items: any[]): {
    normalized: Array<{ quantity: number; unit_price: number; vat_rate: number; subtotal: number; vat_amount: number; }>;
    subtotal: number;
    vatAmount: number;
    total: number;
  } {
    let subtotalSum = 0;
    let vatSum = 0;
    const normalized: any[] = [];
    for (const item of items) {
      const qty = validateNumeric(item.quantity, 'Cantidad', { min: 0.0001, max: 1e9 });
      const unitPrice = validateNumeric(item.unit_price, 'Precio unitario', { min: 0, max: 1e10 });
      const vatRate = validateNumeric(item.vat_rate ?? 21, 'IVA', { min: 0, max: 100, required: false });
      const itemSubtotal = qty * unitPrice;
      const itemVat = itemSubtotal * vatRate / 100;
      subtotalSum += itemSubtotal;
      vatSum += itemVat;
      normalized.push({
        quantity: qty,
        unit_price: unitPrice,
        vat_rate: vatRate,
        subtotal: Math.round(itemSubtotal * 100) / 100,
        vat_amount: Math.round(itemVat * 100) / 100,
      });
    }
    const subtotal = Math.round(subtotalSum * 100) / 100;
    const vatAmount = Math.round(vatSum * 100) / 100;
    const total = Math.round((subtotalSum + vatSum) * 100) / 100;
    return { normalized, subtotal, vatAmount, total };
  }

  async getPurchases(companyId: string, filters: { enterprise_id?: string; business_unit_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`p.company_id = ${companyId}`;
      if (filters.business_unit_id) {
        whereClause = sql`${whereClause} AND p.business_unit_id = ${filters.business_unit_id}`;
      }
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT p.*,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          COALESCE((SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id), 0) as item_count,
          COALESCE((SELECT SUM(CAST(pinv.total_amount AS decimal)) FROM purchase_invoices pinv WHERE pinv.purchase_id = p.id AND pinv.status NOT IN ('cancelled', 'cancelado')), 0) as invoiced_amount,
          CASE
            WHEN COALESCE(CAST(p.total_amount AS decimal), 0) = 0 THEN 'sin_monto'
            WHEN COALESCE((SELECT SUM(CAST(pinv.total_amount AS decimal)) FROM purchase_invoices pinv WHERE pinv.purchase_id = p.id AND pinv.status NOT IN ('cancelled', 'cancelado')), 0) = 0 THEN 'sin_facturar'
            WHEN COALESCE((SELECT SUM(CAST(pinv.total_amount AS decimal)) FROM purchase_invoices pinv WHERE pinv.purchase_id = p.id AND pinv.status NOT IN ('cancelled', 'cancelado')), 0) >= CAST(p.total_amount AS decimal) THEN 'facturado'
            ELSE 'parcial'
          END as invoice_status
        FROM purchases p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY p.date DESC
      `);
      return getRows(result);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get purchases');
    }
  }

  async getPurchase(companyId: string, purchaseId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT p.*,
          e.name as enterprise_name, e.cuit as enterprise_cuit,
          b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM purchases p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${purchaseId} AND p.company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Purchase not found');

      const itemsResult = await db.execute(sql`
        SELECT * FROM purchase_items WHERE purchase_id = ${purchaseId} ORDER BY created_at ASC
      `);
      const items = getRows(itemsResult);

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get purchase');
    }
  }

  /**
   * Checks whether a purchase has linked (non-cancelled) invoices or applied pagos.
   * Used to guard delete and restrict update. Runs on the given transactional client.
   */
  private async getPurchaseLinkage(client: any, purchaseId: string): Promise<{ invoiceCount: number; pagoCount: number; }> {
    const invRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM purchase_invoices WHERE purchase_id = $1 AND status NOT IN ('cancelled', 'cancelado')`,
      [purchaseId]
    );
    const payRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM pago_invoice_applications pia
         JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
         WHERE pi.purchase_id = $1`,
      [purchaseId]
    );
    return {
      invoiceCount: invRes.rows[0]?.c || 0,
      pagoCount: payRes.rows[0]?.c || 0,
    };
  }

  async createPurchase(companyId: string, userId: string, data: any) {
    await this.ensureTables();

    // C1: Tenant validation BEFORE any write.
    await this.validateTenantRefs(companyId, data);

    // Auto-assign default business_unit_id if not provided
    if (!data.business_unit_id) {
      try {
        const buResult = await db.execute(sql`SELECT id FROM business_units WHERE company_id = ${companyId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
        const defaultBu = getRows(buResult)[0];
        if (defaultBu) data.business_unit_id = defaultBu.id;
      } catch { /* no business units yet */ }
    }

    // C3+C2: compute totals with per-item vat_rate + numeric validation
    const hasItems = Array.isArray(data.items) && data.items.length > 0;
    let subtotal: number;
    let vatAmount: number;
    let totalAmount: number;
    let normalizedItems: Array<{ quantity: number; unit_price: number; vat_rate: number; subtotal: number; vat_amount: number; }> = [];

    if (hasItems) {
      const computed = this.computeTotals(data.items);
      normalizedItems = computed.normalized;
      subtotal = computed.subtotal;
      vatAmount = computed.vatAmount;
      totalAmount = computed.total;
    } else {
      subtotal = validateNumeric(data.subtotal ?? 0, 'Subtotal', { required: false });
      vatAmount = validateNumeric(data.vat_amount ?? 0, 'IVA', { required: false });
      totalAmount = validateNumeric(data.total_amount ?? 0, 'Total', { required: false });
    }

    // C4: Real transaction on ONE pooled client so advisory_xact_lock actually holds.
    const client = await pool.connect();
    let purchaseId: string;
    let purchaseNumber: number;
    try {
      await client.query('BEGIN');

      // Advisory lock is now scoped to THIS transaction on THIS connection → correct semantics.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`purchase_num:${companyId}`]
      );

      const numResult = await client.query(
        `SELECT COALESCE(MAX(purchase_number), 0) + 1 AS next_number FROM purchases WHERE company_id = $1`,
        [companyId]
      );
      purchaseNumber = parseInt(numResult.rows[0]?.next_number || '1', 10);
      purchaseId = uuid();

      await client.query(
        `INSERT INTO purchases (
           id, company_id, enterprise_id, purchase_number, date,
           invoice_type, invoice_number, invoice_cae,
           subtotal, vat_amount, total_amount,
           payment_method, payment_status, bank_id, notes, business_unit_id, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          purchaseId,
          companyId,
          data.enterprise_id || null,
          purchaseNumber,
          data.date || new Date().toISOString(),
          data.invoice_type || null,
          data.invoice_number || null,
          data.invoice_cae || null,
          subtotal.toString(),
          vatAmount.toString(),
          totalAmount.toString(),
          data.payment_method || null,
          data.payment_status || 'pendiente',
          data.bank_id || null,
          data.notes || null,
          data.business_unit_id || null,
          userId,
        ]
      );

      if (hasItems) {
        for (let i = 0; i < data.items.length; i++) {
          const raw = data.items[i];
          const norm = normalizedItems[i];
          const itemId = uuid();
          await client.query(
            `INSERT INTO purchase_items (
               id, purchase_id, product_id, product_name, description,
               quantity, unit_price, vat_rate, subtotal
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              itemId,
              purchaseId,
              raw.product_id && raw.product_id !== 'custom' ? raw.product_id : null,
              raw.product_name,
              raw.description || null,
              norm.quantity,
              norm.unit_price,
              norm.vat_rate,
              norm.subtotal,
            ]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Create purchase error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create purchase');
    } finally {
      client.release();
    }

    const result = await this.getPurchase(companyId, purchaseId!);

    // Auto-add stock if requested (outside TX — inventory service manages its own consistency)
    if (data.add_to_inventory) {
      const stockItems = (data.items || [])
        .filter((item: any) => item.product_id && item.product_id !== 'custom' && item.add_to_stock !== false)
        .map((item: any) => ({
          product_id: item.product_id,
          quantity: Number(item.quantity) || 0,
        }))
        .filter((item: any) => item.quantity > 0);

      if (stockItems.length > 0) {
        try {
          const purchaseLabel = `Compra #${String(purchaseNumber!).padStart(4, '0')}`;
          await inventoryService.addStockFromPurchase(
            companyId,
            userId,
            purchaseId!,
            stockItems,
            purchaseLabel
          );
          await db.execute(sql`UPDATE purchases SET stock_added = true WHERE id = ${purchaseId!}`);
          (result as any).stock_updated = true;
          (result as any).stock_added = true;
        } catch (stockError) {
          console.error('Auto stock update on purchase create failed:', stockError);
          (result as any).stock_updated = false;
          (result as any).stock_error = 'No se pudo actualizar el stock automaticamente';
        }
      }
    }

    return result;
  }

  async updatePaymentStatus(companyId: string, purchaseId: string, status: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM purchases WHERE id = ${purchaseId} AND company_id = ${companyId}
      `);
      if (getRows(check).length === 0) throw new ApiError(404, 'Purchase not found');

      await db.execute(sql`
        UPDATE purchases SET payment_status = ${status}, updated_at = NOW() WHERE id = ${purchaseId}
      `);
      return { id: purchaseId, payment_status: status };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update purchase payment status');
    }
  }

  async updatePurchase(companyId: string, purchaseId: string, userId: string, data: any) {
    await this.ensureTables();

    // Verify ownership
    const check = await db.execute(sql`SELECT id, purchase_number FROM purchases WHERE id = ${purchaseId} AND company_id = ${companyId}`);
    const rows = getRows(check);
    if (rows.length === 0) throw new ApiError(404, 'Purchase not found');

    // C7: guard against editing financially-affecting fields if purchase has linked
    // invoices or applied pagos. Must acquire a short-lived client just for the checks.
    const linkageClient = await pool.connect();
    let linkage: { invoiceCount: number; pagoCount: number };
    try {
      linkage = await this.getPurchaseLinkage(linkageClient, purchaseId);
    } finally {
      linkageClient.release();
    }

    const isLocked = linkage.invoiceCount > 0 || linkage.pagoCount > 0;
    const touchesFinancials =
      data.items !== undefined ||
      data.total_amount !== undefined ||
      data.subtotal !== undefined ||
      data.vat_amount !== undefined ||
      data.enterprise_id !== undefined;

    if (isLocked && touchesFinancials) {
      throw new ApiError(
        409,
        `No se pueden modificar items, totales o proveedor: la compra tiene ${linkage.invoiceCount} factura(s) y ${linkage.pagoCount} pago(s) asociados. Cancelalos primero.`
      );
    }

    // C1: tenant validation for any referenced foreign id (enterprise, bank, business_unit, items.product_id)
    await this.validateTenantRefs(companyId, data);

    try {
      // Fetch old items BEFORE replacing (needed for stock delta calculation)
      let oldItems: any[] = [];
      if (data.add_to_inventory && data.items && Array.isArray(data.items)) {
        const oldItemsResult = await db.execute(sql`
          SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ${purchaseId}
        `);
        oldItems = getRows(oldItemsResult);
      }

      // C2+C3: recalc with per-item vat_rate + numeric validation
      const hasItems = Array.isArray(data.items) && data.items.length > 0;
      let subtotal: number;
      let vatAmount: number;
      let totalAmount: number;
      let normalizedItems: Array<{ quantity: number; unit_price: number; vat_rate: number; subtotal: number; vat_amount: number; }> = [];

      if (hasItems) {
        const computed = this.computeTotals(data.items);
        normalizedItems = computed.normalized;
        subtotal = computed.subtotal;
        vatAmount = computed.vatAmount;
        totalAmount = computed.total;
      } else {
        subtotal = validateNumeric(data.subtotal ?? 0, 'Subtotal', { required: false });
        vatAmount = validateNumeric(data.vat_amount ?? 0, 'IVA', { required: false });
        totalAmount = validateNumeric(data.total_amount ?? 0, 'Total', { required: false });
      }

      // Update purchase
      await db.execute(sql`
        UPDATE purchases SET
          enterprise_id = ${data.enterprise_id || null},
          date = ${data.date || new Date().toISOString()},
          invoice_type = ${data.invoice_type || null},
          invoice_number = ${data.invoice_number || null},
          invoice_cae = ${data.invoice_cae || null},
          subtotal = ${subtotal.toString()},
          vat_amount = ${vatAmount.toString()},
          total_amount = ${totalAmount.toString()},
          payment_method = ${data.payment_method || null},
          bank_id = ${data.bank_id || null},
          notes = ${data.notes || null},
          updated_at = NOW()
        WHERE id = ${purchaseId} AND company_id = ${companyId}
      `);

      // Replace items if provided
      if (hasItems) {
        await db.execute(sql`DELETE FROM purchase_items WHERE purchase_id = ${purchaseId}`);
        for (let i = 0; i < data.items.length; i++) {
          const raw = data.items[i];
          const norm = normalizedItems[i];
          const itemId = uuid();
          await db.execute(sql`
            INSERT INTO purchase_items (id, purchase_id, product_id, product_name, description, quantity, unit_price, vat_rate, subtotal)
            VALUES (
              ${itemId}, ${purchaseId},
              ${raw.product_id && raw.product_id !== 'custom' ? raw.product_id : null},
              ${raw.product_name}, ${raw.description || null},
              ${norm.quantity}, ${norm.unit_price}, ${norm.vat_rate}, ${norm.subtotal}
            )
          `);
        }
      }

      const result = await this.getPurchase(companyId, purchaseId);

      // Adjust stock if requested during edit
      if (data.add_to_inventory && hasItems) {
        try {
          await this.adjustStockForPurchaseEdit(companyId, userId, purchaseId, rows[0].purchase_number, oldItems, data.items);
          await db.execute(sql`UPDATE purchases SET stock_added = true WHERE id = ${purchaseId}`);
          (result as any).stock_updated = true;
          (result as any).stock_added = true;
        } catch (stockError) {
          console.error('Stock adjustment on purchase edit failed:', stockError);
          (result as any).stock_updated = false;
          (result as any).stock_error = 'No se pudo ajustar el stock automaticamente';
        }
      }

      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update purchase');
    }
  }

  private async adjustStockForPurchaseEdit(
    companyId: string,
    userId: string,
    purchaseId: string,
    purchaseNumber: number,
    oldItems: any[],
    newItems: any[]
  ) {
    const oldQtyMap = new Map<string, number>();
    for (const item of oldItems) {
      if (!item.product_id) continue;
      const current = oldQtyMap.get(item.product_id) || 0;
      oldQtyMap.set(item.product_id, current + (Number(item.quantity) || 0));
    }

    const newQtyMap = new Map<string, number>();
    for (const item of newItems) {
      if (!item.product_id || item.product_id === 'custom' || item.add_to_stock === false) continue;
      const current = newQtyMap.get(item.product_id) || 0;
      newQtyMap.set(item.product_id, current + (Number(item.quantity) || 0));
    }

    const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);
    const deltas: { product_id: string; quantity_change: number }[] = [];

    for (const productId of allProductIds) {
      const oldQty = oldQtyMap.get(productId) || 0;
      const newQty = newQtyMap.get(productId) || 0;
      const delta = newQty - oldQty;
      if (delta !== 0) {
        deltas.push({ product_id: productId, quantity_change: delta });
      }
    }

    const purchaseLabel = `Compra #${String(purchaseNumber).padStart(4, '0')}`;
    for (const delta of deltas) {
      try {
        await inventoryService.adjustStock(companyId, userId, {
          product_id: delta.product_id,
          quantity_change: delta.quantity_change,
          reason: `Ajuste por edicion de ${purchaseLabel}`,
        });
      } catch (err) {
        console.error(`Stock adjust failed for product ${delta.product_id}:`, err);
      }
    }
  }

  /**
   * C6: deletePurchase — real transaction, full guards, stock revert via return_supplier movement.
   *   - Blocks if linked purchase_invoices (non-cancelled) exist → 409
   *   - Blocks if any pago is applied to a linked invoice → 409
   *   - If stock_added, reverts stock inline (insert return_supplier movement + UPDATE stock)
   */
  async deletePurchase(companyId: string, purchaseId: string, userId?: string) {
    await this.ensureTables();
    if (!userId) {
      throw new ApiError(400, 'userId requerido para eliminar compra');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row to serialize concurrent deletes
      const lockResult = await client.query(
        `SELECT id, stock_added, payment_status FROM purchases WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [purchaseId, companyId]
      );
      if (lockResult.rows.length === 0) {
        throw new ApiError(404, 'Purchase not found');
      }
      const purchase = lockResult.rows[0];

      // Guards: linked invoices / pagos
      const linkage = await this.getPurchaseLinkage(client, purchaseId);
      if (linkage.invoiceCount > 0) {
        throw new ApiError(
          409,
          `No se puede eliminar: hay ${linkage.invoiceCount} factura(s) de compra asociada(s). Cancelalas primero.`
        );
      }
      if (linkage.pagoCount > 0) {
        throw new ApiError(
          409,
          'No se puede eliminar: hay pagos aplicados a facturas de esta compra'
        );
      }

      // Stock revert: find original stock_movements (purchase_stock_in) and counter them with return_supplier
      if (purchase.stock_added) {
        const itemsRes = await client.query(
          `SELECT product_id, quantity FROM purchase_items WHERE purchase_id = $1 AND product_id IS NOT NULL`,
          [purchaseId]
        );

        for (const item of itemsRes.rows) {
          const qty = Number(item.quantity) || 0;
          if (qty <= 0) continue;

          // Locate the warehouse used by the original stock-in movement for this purchase+product.
          const movRes = await client.query(
            `SELECT warehouse_id FROM stock_movements
               WHERE reference_type = 'purchase' AND reference_id = $1 AND product_id = $2
               ORDER BY created_at DESC LIMIT 1`,
            [purchaseId, item.product_id]
          );
          const warehouseId = movRes.rows[0]?.warehouse_id;
          if (!warehouseId) {
            console.warn(`[deletePurchase] No original warehouse for product ${item.product_id} — stock NOT reverted`);
            continue;
          }

          // Lock stock row
          await client.query(
            `SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE`,
            [item.product_id, warehouseId]
          );

          await client.query(
            `INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity,
                movement_type, reference_type, reference_id, notes, created_by)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 'return_supplier', 'purchase_delete', $5, 'Reversion por eliminacion de compra', $6)`,
            [companyId, item.product_id, warehouseId, qty, purchaseId, userId]
          );

          await client.query(
            `UPDATE stock
                SET quantity = GREATEST(COALESCE(quantity, 0) - $1, 0),
                    quantity_num = GREATEST(COALESCE(quantity_num, 0) - $1, 0)
              WHERE product_id = $2 AND warehouse_id = $3`,
            [qty, item.product_id, warehouseId]
          );
        }
      }

      // Explicit cascade (purchase_items has ON DELETE CASCADE but we delete explicitly for clarity)
      await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [purchaseId]);
      await client.query(`DELETE FROM purchases WHERE id = $1 AND company_id = $2`, [purchaseId, companyId]);

      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK').catch((e: any) => console.error('ROLLBACK failed:', e?.message));
      if (error instanceof ApiError) throw error;
      console.error('Delete purchase error:', error);
      throw new ApiError(500, 'Failed to delete purchase');
    } finally {
      client.release();
    }
  }
}

export const purchasesService = new PurchasesService();
