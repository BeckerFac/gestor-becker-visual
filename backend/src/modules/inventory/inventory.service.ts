import { db, pool } from '../../config/db';
import { warehouses } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { materialsService } from '../materials/materials.service';

/**
 * PR2-T7: stock negativo reject + FOR UPDATE lock on every mutation path.
 * PR7-T2: doble escritura quantity (VARCHAR legacy) + quantity_num (DECIMAL).
 *
 * SIGN CONVENTION FOR stock_movements.quantity (changed 2026-04-13):
 * ------------------------------------------------------------------
 *   SIGNED. Positive = stock IN (purchase, return_customer, adjustment-in).
 *           Negative = stock OUT (sale, return_supplier, adjustment-out).
 *
 * Reconciliation invariant:
 *   SUM(stock_movements.quantity) for (product_id, warehouse_id)
 *     == stock.quantity_num for that pair (ignoring pre-migration rows).
 *
 * Historical rows written before 2026-04-13 may violate this because the
 * previous code stored `adjustment` type as unsigned-positive. A future
 * `reconcileStock()` helper will backfill; DO NOT attempt backfill here.
 *
 * All mutating functions in this file run inside a pg transaction and hold
 * `SELECT ... FOR UPDATE` on the target stock row BEFORE any math, which
 * guarantees serialized updates across concurrent callers.
 */

// Shape of the row returned by the locked SELECT below.
interface LockedStockRow {
  id: string;
  quantity: string | null;
  quantity_num: string | null;
}

export class InventoryService {
  // --------------------------------------------------------------------------
  // Helpers (transaction-scoped, operate on a pg client)
  // --------------------------------------------------------------------------

  /**
   * Validate that a warehouse belongs to the caller's company.
   * Throws 400 on mismatch. Returns the validated warehouse id.
   */
  private async assertWarehouseInCompany(
    client: any,
    warehouseId: string,
    companyId: string
  ): Promise<void> {
    const res = await client.query(
      'SELECT id FROM warehouses WHERE id = $1 AND company_id = $2',
      [warehouseId, companyId]
    );
    if (res.rows.length === 0) {
      throw new ApiError(400, 'Warehouse not found in your company');
    }
  }

  /**
   * Return the id of the company's default warehouse, creating it inside the
   * transaction if none exists. Safe across retries because the insert is
   * part of the caller's atomic unit of work.
   */
  private async getOrCreateDefaultWarehouse(
    client: any,
    companyId: string
  ): Promise<string> {
    const existing = await client.query(
      'SELECT id FROM warehouses WHERE company_id = $1 LIMIT 1',
      [companyId]
    );
    if (existing.rows.length > 0) return existing.rows[0].id;

    const newId = uuid();
    await client.query(
      'INSERT INTO warehouses (id, company_id, name) VALUES ($1, $2, $3)',
      [newId, companyId, 'Principal']
    );
    return newId;
  }

  /**
   * Acquire a row-level lock on the (product, warehouse) stock record if it
   * exists. If it does not, acquire a row-level lock on the product row to
   * serialize concurrent INSERTs. Returns the stock row or null.
   */
  private async lockStockRow(
    client: any,
    productId: string,
    warehouseId: string
  ): Promise<LockedStockRow | null> {
    const locked = await client.query(
      `SELECT id, quantity, quantity_num
         FROM stock
        WHERE product_id = $1 AND warehouse_id = $2
        FOR UPDATE`,
      [productId, warehouseId]
    );
    if (locked.rows.length > 0) return locked.rows[0];

    // No stock row yet — lock the product row to serialize the INSERT path.
    await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [
      productId,
    ]);
    return null;
  }

  /**
   * Parse the numeric quantity from a locked stock row, preferring the new
   * `quantity_num` (DECIMAL) column over the legacy `quantity` (VARCHAR).
   */
  private parseCurrentQty(row: LockedStockRow): number {
    const raw = row.quantity_num ?? row.quantity ?? '0';
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n)) {
      throw new ApiError(500, 'Stock corrupto: quantity no parseable');
    }
    return n;
  }

  /**
   * Apply a signed delta to the (product, warehouse) stock, inserting or
   * updating as needed. Always writes BOTH `quantity` (legacy VARCHAR) and
   * `quantity_num` (DECIMAL) to satisfy the PR7-T2 double-write invariant.
   *
   * Rejects with 400 if the resulting qty would be negative, unless
   * `allowNegative` is true (reserved for future overbooking use cases; not
   * currently exposed by any caller).
   */
  private async applyStockDelta(
    client: any,
    productId: string,
    warehouseId: string,
    delta: number,
    allowNegative = false
  ): Promise<{ newQty: number; currentQty: number }> {
    const locked = await this.lockStockRow(client, productId, warehouseId);

    if (locked === null) {
      if (delta < 0 && !allowNegative) {
        throw new ApiError(
          400,
          `Stock insuficiente: no existe registro de stock para el producto ${productId}`
        );
      }
      const newQty = delta;
      if (newQty < 0 && !allowNegative) {
        throw new ApiError(400, `Stock insuficiente. Disponible: 0, solicitado: ${-delta}`);
      }
      await client.query(
        `INSERT INTO stock (id, product_id, warehouse_id, quantity, quantity_num, min_level, max_level)
         VALUES ($1, $2, $3, $4, $5::decimal, '0', '0')`,
        [uuid(), productId, warehouseId, newQty.toString(), newQty.toString()]
      );
      return { newQty, currentQty: 0 };
    }

    const currentQty = this.parseCurrentQty(locked);
    const newQty = currentQty + delta;
    if (newQty < 0 && !allowNegative) {
      throw new ApiError(
        400,
        `Stock insuficiente. Disponible: ${currentQty}, solicitado: ${-delta}`
      );
    }
    await client.query(
      `UPDATE stock
          SET quantity = $1,
              quantity_num = $2::decimal,
              updated_at = NOW()
        WHERE id = $3`,
      [newQty.toString(), newQty.toString(), locked.id]
    );
    return { newQty, currentQty };
  }

  /**
   * Resolve sign of a movement given its type. Used exclusively to compute
   * the signed value stored in `stock_movements.quantity` and the delta
   * applied to `stock.quantity_num`.
   */
  private signedQuantityForMovement(
    movementType: string,
    rawQuantity: number
  ): number {
    const abs = Math.abs(rawQuantity);
    const incoming = new Set([
      'purchase',
      'return_customer',
      'adjustment_in',
      'production',
    ]);
    const outgoing = new Set([
      'sale',
      'return_supplier',
      'adjustment_out',
      'consumption',
    ]);
    if (incoming.has(movementType)) return abs;
    if (outgoing.has(movementType)) return -abs;
    // Generic 'adjustment' preserves the caller-provided sign (signed input).
    return rawQuantity;
  }

  // --------------------------------------------------------------------------
  // Read-only queries (no transaction needed)
  // --------------------------------------------------------------------------

  async getStock(companyId: string) {
    try {
      // NOTE: both `s.quantity` and `s.quantity_num` are NUMERIC columns
      // (legacy comments calling `quantity` VARCHAR are stale). The regex
      // operator `~` only works on text, so it used to throw on every call.
      // Simple COALESCE suffices: prefer the new column, fall back to the
      // legacy numeric column, then to 0.
      const result = await db.execute(sql`
        SELECT s.id,
               COALESCE(s.quantity_num, s.quantity, 0) as quantity,
               s.min_level, s.max_level,
               p.low_stock_threshold,
               json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
               json_build_object('id', w.id, 'name', w.name) as warehouse,
               COALESCE((SELECT json_agg(json_build_object('name', pp.name, 'sku', pp.sku))
                 FROM product_components pc JOIN products pp ON pc.product_id = pp.id
                 WHERE pc.component_product_id = p.id), '[]'::json) as used_in_products
        FROM stock s
        JOIN products p ON s.product_id = p.id
        JOIN warehouses w ON s.warehouse_id = w.id
        WHERE p.company_id = ${companyId}
        ORDER BY p.name ASC
      `);

      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Get stock error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get inventory');
    }
  }

  async getLowStock(companyId: string) {
    try {
      // See getStock above for the rationale on dropping the regex cast.
      // Both `quantity` and `quantity_num` are NUMERIC; plain COALESCE works.
      // `low_stock_threshold` and `min_level` may be NULL, hence the inner
      // COALESCE chain for the comparison threshold.
      const result = await db.execute(sql`
        SELECT s.id,
               COALESCE(s.quantity_num, s.quantity, 0) as quantity,
               s.min_level, p.low_stock_threshold,
               json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
               json_build_object('id', w.id, 'name', w.name) as warehouse
        FROM stock s
        JOIN products p ON s.product_id = p.id
        JOIN warehouses w ON s.warehouse_id = w.id
        WHERE p.company_id = ${companyId}
          AND p.controls_stock = true
          AND COALESCE(s.quantity_num, s.quantity, 0) <= COALESCE(CAST(p.low_stock_threshold AS decimal), s.min_level, 0)
          AND COALESCE(CAST(p.low_stock_threshold AS decimal), s.min_level, 0) > 0
        ORDER BY COALESCE(s.quantity_num, s.quantity, 0) ASC
      `);

      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Low stock error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get low stock items');
    }
  }

  /**
   * List stock movements. Fully parametrized (no string concatenation) to
   * eliminate the SQL injection vector that existed in the previous version.
   * Supports optional filters: product_id, date_from, date_to (AR timezone).
   */
  async getStockMovements(
    companyId: string,
    {
      skip = 0,
      limit = 50,
      product_id = '',
      date_from = '',
      date_to = '',
    }: {
      skip?: number;
      limit?: number;
      product_id?: string;
      date_from?: string;
      date_to?: string;
    } = {}
  ) {
    try {
      // Build count query with parametrized composition.
      let countQuery = sql`
        SELECT COUNT(*) as total
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        WHERE p.company_id = ${companyId}
      `;
      if (product_id) {
        countQuery = sql`${countQuery} AND sm.product_id = ${product_id}`;
      }
      if (date_from) {
        countQuery = sql`${countQuery} AND sm.created_at >= ${date_from + 'T00:00:00-03:00'}`;
      }
      if (date_to) {
        countQuery = sql`${countQuery} AND sm.created_at <= ${date_to + 'T23:59:59.999-03:00'}`;
      }

      const countResult = await db.execute(countQuery);
      const total = parseInt(((countResult as any).rows?.[0]?.total ?? '0'), 10);

      let listQuery = sql`
        SELECT sm.*,
          json_build_object('id', p.id, 'name', p.name, 'sku', p.sku) as product,
          json_build_object('id', w.id, 'name', w.name) as warehouse
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN warehouses w ON w.id = sm.warehouse_id
        WHERE p.company_id = ${companyId}
      `;
      if (product_id) {
        listQuery = sql`${listQuery} AND sm.product_id = ${product_id}`;
      }
      if (date_from) {
        listQuery = sql`${listQuery} AND sm.created_at >= ${date_from + 'T00:00:00-03:00'}`;
      }
      if (date_to) {
        listQuery = sql`${listQuery} AND sm.created_at <= ${date_to + 'T23:59:59.999-03:00'}`;
      }
      listQuery = sql`${listQuery} ORDER BY sm.created_at DESC LIMIT ${limit} OFFSET ${skip}`;

      const result = await db.execute(listQuery);
      const items = (result as any).rows || result || [];
      return { items, total, skip, limit };
    } catch (error) {
      console.error('Get stock movements error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get stock movements');
    }
  }

  // --------------------------------------------------------------------------
  // Mutating operations (all transactional)
  // --------------------------------------------------------------------------

  /**
   * Generic movement creator. The caller supplies a `movement_type`; this
   * function derives the signed quantity, locks the stock row, applies the
   * delta, and inserts a ledger row — all atomically.
   */
  async createMovement(companyId: string, userId: string, data: any) {
    const rawQuantity = parseFloat(data.quantity);
    if (!Number.isFinite(rawQuantity)) {
      throw new ApiError(400, `quantity invalido: ${data.quantity}`);
    }
    const movementType: string = data.movement_type || 'adjustment';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify product belongs to company.
      const productRes = await client.query(
        'SELECT id FROM products WHERE id = $1 AND company_id = $2',
        [data.product_id, companyId]
      );
      if (productRes.rows.length === 0) {
        throw new ApiError(404, 'Product not found');
      }

      // Resolve + validate warehouse.
      let warehouseId: string;
      if (data.warehouse_id) {
        await this.assertWarehouseInCompany(client, data.warehouse_id, companyId);
        warehouseId = data.warehouse_id;
      } else {
        warehouseId = await this.getOrCreateDefaultWarehouse(client, companyId);
      }

      // Compute signed qty per unified convention and apply it.
      const signedQty = this.signedQuantityForMovement(movementType, rawQuantity);

      const { newQty } = await this.applyStockDelta(
        client,
        data.product_id,
        warehouseId,
        signedQty
      );

      // Insert the ledger row (AFTER the lock, still inside the tx).
      const movementId = uuid();
      await client.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          movementId,
          data.product_id,
          warehouseId,
          movementType,
          signedQty.toString(),
          data.reference_type || null,
          data.reference_id || null,
          data.notes || null,
          userId,
        ]
      );

      await client.query('COMMIT');
      return {
        id: movementId,
        product_id: data.product_id,
        movement_type: movementType,
        quantity: signedQty,
        new_quantity: newQty,
      };
    } catch (error) {
      await client
        .query('ROLLBACK')
        .catch((e: any) => console.error('ROLLBACK failed:', e?.message));
      console.error('Create movement error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create inventory movement');
    } finally {
      client.release();
    }
  }

  /**
   * Signed adjustment to stock. `quantity_change` is stored as-is in the
   * ledger (signed convention). Negative adjustments that would drive stock
   * below zero are REJECTED — there is no silent clamp.
   */
  async adjustStock(
    companyId: string,
    userId: string,
    data: {
      product_id: string;
      warehouse_id?: string;
      quantity_change: number;
      reason: string;
    }
  ) {
    const quantityChange = parseFloat(String(data.quantity_change));
    if (!Number.isFinite(quantityChange)) {
      throw new ApiError(400, `quantity_change invalido: ${data.quantity_change}`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const productRes = await client.query(
        'SELECT id FROM products WHERE id = $1 AND company_id = $2',
        [data.product_id, companyId]
      );
      if (productRes.rows.length === 0) {
        throw new ApiError(404, 'Product not found');
      }

      let warehouseId: string;
      if (data.warehouse_id) {
        await this.assertWarehouseInCompany(client, data.warehouse_id, companyId);
        warehouseId = data.warehouse_id;
      } else {
        warehouseId = await this.getOrCreateDefaultWarehouse(client, companyId);
      }

      // Apply the signed delta. Rejects with 400 if result < 0.
      const { newQty } = await this.applyStockDelta(
        client,
        data.product_id,
        warehouseId,
        quantityChange
      );

      // Insert ledger row. Sign preserved (unified convention).
      const movementId = uuid();
      const notes =
        (data.reason || '') +
        (quantityChange < 0 ? ' (salida)' : ' (ingreso)');
      await client.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, movement_type, quantity, notes, created_by)
         VALUES ($1, $2, $3, 'adjustment', $4, $5, $6)`,
        [movementId, data.product_id, warehouseId, quantityChange.toString(), notes, userId]
      );

      await client.query('COMMIT');

      // Auto-consume materials for positive production adjustments. This runs
      // OUTSIDE the tx because it operates on separate records and has its
      // own error handling; a failure here must not roll back the adjustment.
      let materialConsumption: any = null;
      if (quantityChange > 0) {
        try {
          materialConsumption = await materialsService.consumeMaterialsForProduction(
            companyId,
            data.product_id,
            quantityChange,
            userId
          );
        } catch (matErr) {
          console.error('Material consumption warning (non-blocking):', matErr);
        }
      }

      return {
        id: movementId,
        product_id: data.product_id,
        quantity_change: quantityChange,
        new_quantity: newQty,
        material_consumption: materialConsumption,
      };
    } catch (error) {
      await client
        .query('ROLLBACK')
        .catch((e: any) => console.error('ROLLBACK failed:', e?.message));
      console.error('Adjust stock error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to adjust stock');
    } finally {
      client.release();
    }
  }

  /**
   * Idempotently add stock for a completed purchase. Uses a DB-level guard
   * (`purchases.stock_added`) locked FOR UPDATE inside the transaction — no
   * swallowing try/catch.
   *
   * Products with `controls_stock = false` are SKIPPED (not auto-mutated).
   * The caller must enable stock control explicitly before calling.
   */
  async addStockFromPurchase(
    companyId: string,
    userId: string,
    purchaseId: string,
    items: { product_id: string; quantity: number }[],
    customNote?: string
  ) {
    // Ensure the idempotency column exists. Safe to call repeatedly; not
    // wrapped in a swallowing try/catch — any failure here is a real bug.
    await db.execute(
      sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stock_added BOOLEAN DEFAULT FALSE`
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the purchase row + check idempotency flag atomically.
      const purchaseRes = await client.query(
        'SELECT id, stock_added FROM purchases WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [purchaseId, companyId]
      );
      if (purchaseRes.rows.length === 0) {
        throw new ApiError(404, 'Purchase not found');
      }
      if (purchaseRes.rows[0].stock_added === true) {
        throw new ApiError(409, 'El stock de esta compra ya fue agregado al inventario');
      }

      const warehouseId = await this.getOrCreateDefaultWarehouse(client, companyId);

      const results: any[] = [];
      const skipped: Array<{ product_id: string; reason: string }> = [];

      for (const item of items) {
        const productRes = await client.query(
          'SELECT id, controls_stock FROM products WHERE id = $1 AND company_id = $2',
          [item.product_id, companyId]
        );
        if (productRes.rows.length === 0) {
          skipped.push({ product_id: item.product_id, reason: 'not_found' });
          continue;
        }

        // H3 fix: DO NOT auto-enable controls_stock. Respect product config.
        if (!productRes.rows[0].controls_stock) {
          console.warn(
            `addStockFromPurchase: product ${item.product_id} has controls_stock=false, skipping`
          );
          skipped.push({ product_id: item.product_id, reason: 'controls_stock_disabled' });
          continue;
        }

        const quantity = parseFloat(String(item.quantity));
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new ApiError(
            400,
            `quantity invalido para producto ${item.product_id}: ${item.quantity}`
          );
        }

        // Purchase => incoming => positive delta.
        const { newQty } = await this.applyStockDelta(
          client,
          item.product_id,
          warehouseId,
          quantity
        );

        const movementId = uuid();
        await client.query(
          `INSERT INTO stock_movements
             (id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by)
           VALUES ($1, $2, $3, 'purchase', $4, 'purchase', $5, $6, $7)`,
          [
            movementId,
            item.product_id,
            warehouseId,
            quantity.toString(),
            purchaseId,
            customNote || 'Ingreso por compra',
            userId,
          ]
        );

        results.push({
          product_id: item.product_id,
          quantity_added: quantity,
          new_quantity: newQty,
        });
      }

      // Mark purchase as stock_added INSIDE the transaction.
      await client.query(
        'UPDATE purchases SET stock_added = true WHERE id = $1',
        [purchaseId]
      );

      await client.query('COMMIT');

      // Fire-and-forget material consumption outside the tx (same reasoning
      // as adjustStock — failure must not undo inventory receipt).
      const consumption: Record<string, any> = {};
      for (const r of results) {
        try {
          consumption[r.product_id] = await materialsService.consumeMaterialsForProduction(
            companyId,
            r.product_id,
            r.quantity_added,
            userId
          );
        } catch (matErr) {
          console.error('Material consumption warning (non-blocking):', matErr);
        }
      }
      for (const r of results) {
        r.material_consumption = consumption[r.product_id] ?? null;
      }

      return { purchase_id: purchaseId, items_processed: results, skipped };
    } catch (error) {
      await client
        .query('ROLLBACK')
        .catch((e: any) => console.error('ROLLBACK failed:', e?.message));
      console.error('Add stock from purchase error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to add stock from purchase');
    } finally {
      client.release();
    }
  }
}

export const inventoryService = new InventoryService();

// Silence unused-import lint for types-only re-exports kept for future use.
void warehouses;
