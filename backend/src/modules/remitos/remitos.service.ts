import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import puppeteer from 'puppeteer';
import { getRows, getFirstRow } from '../../lib/db-utils';

export class RemitosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS remitos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id),
          customer_id UUID REFERENCES customers(id),
          order_id UUID REFERENCES orders(id),
          remito_number INTEGER NOT NULL,
          date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          delivery_address TEXT,
          receiver_name VARCHAR(255),
          transport VARCHAR(255),
          tipo VARCHAR(20) DEFAULT 'entrega',
          notes TEXT,
          status VARCHAR(50) DEFAULT 'pendiente',
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS remito_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
          product_name VARCHAR(255) NOT NULL,
          description TEXT,
          quantity INTEGER NOT NULL DEFAULT 1,
          unit VARCHAR(50) DEFAULT 'unidades'
        )
      `);
      // Migration: add tipo column if missing
      await db.execute(sql`
        ALTER TABLE remitos ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'entrega'
      `).catch(() => {});
      // Migration: add enterprise_id
      await db.execute(sql`
        ALTER TABLE remitos ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)
      `).catch(() => {});

      // ═══ Plan 11: Remitos ↔ Pedidos ↔ Facturas — Migraciones ═══

      // Migration: remito_items new columns for item-level linking
      await pool.query(`ALTER TABLE remito_items ALTER COLUMN quantity TYPE DECIMAL(12,2) USING quantity::decimal(12,2)`).catch(() => {});
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL`).catch(() => {});
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12,2)`).catch(() => {});
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 21`).catch(() => {});
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS order_item_id UUID`).catch(() => {});
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`).catch(() => {});

      // Index for order_item linking
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_remito_items_order_item ON remito_items(order_item_id) WHERE order_item_id IS NOT NULL`).catch(() => {});

      // Migration: remito_orders (N:N remito ↔ orders)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS remito_orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
          UNIQUE(remito_id, order_id)
        )
      `).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_remito_orders_remito ON remito_orders(remito_id)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_remito_orders_order ON remito_orders(order_id)`).catch(() => {});

      // Migration: qty_delivered in order_items (denormalized delivery tracking)
      await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_delivered DECIMAL(12,2) DEFAULT 0`).catch(() => {});
      await pool.query(`UPDATE order_items SET qty_delivered = 0 WHERE qty_delivered IS NULL`).catch(() => {});

      // Migration: remitos format fields (punto de venta + cross-references)
      await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS punto_venta INTEGER DEFAULT 1`).catch(() => {});
      await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS factura_ref TEXT`).catch(() => {});
      await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS pedido_ref TEXT`).catch(() => {});
      await pool.query(`ALTER TABLE remitos ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT`).catch(() => {});

      // Migration: company config for remito PDF
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255)`).catch(() => {});
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ingresos_brutos VARCHAR(50)`).catch(() => {});
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS inicio_actividad DATE`).catch(() => {});
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS rubro_descripcion TEXT`).catch(() => {});
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS punto_venta_remito INTEGER DEFAULT 1`).catch(() => {});
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cai_remito VARCHAR(20)`).catch(() => {});
      await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cai_remito_vto DATE`).catch(() => {});

      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure remitos tables error:', error);
    }
  }

  async getRemitos(companyId: string, filters: {
    enterprise_id?: string;
    status?: string;
    tipo?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  } = {}) {
    await this.ensureTables();
    try {
      const { enterprise_id, status, tipo, search, date_from, date_to, skip = 0, limit = 100 } = filters;

      let whereClause = sql`r.company_id = ${companyId}`;
      if (enterprise_id) {
        whereClause = sql`${whereClause} AND (r.enterprise_id = ${enterprise_id} OR c.enterprise_id = ${enterprise_id})`;
      }
      if (status) {
        whereClause = sql`${whereClause} AND r.status = ${status}`;
      }
      if (tipo) {
        whereClause = sql`${whereClause} AND r.tipo = ${tipo}`;
      }
      if (search) {
        whereClause = sql`${whereClause} AND (c.name ILIKE ${'%' + search + '%'} OR r.receiver_name ILIKE ${'%' + search + '%'} OR r.delivery_address ILIKE ${'%' + search + '%'})`;
      }
      if (date_from) {
        whereClause = sql`${whereClause} AND r.date >= ${date_from}`;
      }
      if (date_to) {
        whereClause = sql`${whereClause} AND r.date <= ${date_to + 'T23:59:59'}`;
      }

      const result = await db.execute(sql`
        SELECT r.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'name', e.name)
          ELSE CASE WHEN c.enterprise_id IS NOT NULL THEN (SELECT json_build_object('id', e2.id, 'name', e2.name) FROM enterprises e2 WHERE e2.id = c.enterprise_id) ELSE NULL END
          END as enterprise,
          CASE WHEN r.order_id IS NOT NULL THEN
            json_build_object('id', o.id, 'order_number', o.order_number, 'title', o.title)
          ELSE NULL END as "order",
          (SELECT COUNT(*) FROM remito_items ri WHERE ri.remito_id = r.id)::int as item_count,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(e.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM remitos r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        LEFT JOIN orders o ON r.order_id = o.id
        WHERE ${whereClause}
        ORDER BY r.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);
      const rows = getRows(result);
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Get remitos error:', error);
      throw new ApiError(500, 'Failed to get remitos');
    }
  }

  async getRemito(companyId: string, remitoId: string): Promise<Record<string, any>> {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT r.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit, 'email', c.email, 'phone', c.phone, 'address', c.address) as customer,
          CASE WHEN r.order_id IS NOT NULL THEN
            json_build_object('id', o.id, 'order_number', o.order_number, 'title', o.title)
          ELSE NULL END as "order"
        FROM remitos r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN orders o ON r.order_id = o.id
        WHERE r.company_id = ${companyId} AND r.id = ${remitoId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');

      // Items with invoicing status and source reference
      const itemsResult = await pool.query(`
        SELECT ri.*,
          COALESCE((SELECT SUM(ii.quantity) FROM invoice_items ii
            WHERE ii.remito_item_id = ri.id
            AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled')
          ), 0) as qty_invoiced,
          CASE
            WHEN ri.order_item_id IS NOT NULL THEN (
              SELECT 'Pedido #' || LPAD(o2.order_number::text, 4, '0')
              FROM order_items oi2 JOIN orders o2 ON oi2.order_id = o2.id
              WHERE oi2.id = ri.order_item_id
            )
            WHEN ri.invoice_item_id IS NOT NULL THEN 'Factura'
            ELSE 'Manual'
          END as source_ref
        FROM remito_items ri WHERE ri.remito_id = $1 ORDER BY ri.id ASC
      `, [remitoId]);
      const items = itemsResult.rows || [];

      // Also add enterprise info
      let enterprise = null;
      if (rows[0].enterprise_id) {
        const entResult = await pool.query(
          'SELECT id, name, razon_social, cuit, tax_condition, address, city, province FROM enterprises WHERE id = $1',
          [rows[0].enterprise_id]
        );
        enterprise = entResult.rows[0] || null;
      }

      return { ...rows[0], items, enterprise };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get remito');
    }
  }

  async createRemito(companyId: string, userId: string, data: any) {
    await this.ensureTables();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Get next remito number
      const numResult = await client.query(
        'SELECT COALESCE(MAX(remito_number), 0) + 1 as next_number FROM remitos WHERE company_id = $1',
        [companyId]
      );
      const remitoNumber = parseInt(numResult.rows[0]?.next_number || '1');

      // 2. Resolve enterprise_id
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await client.query('SELECT enterprise_id FROM customers WHERE id = $1', [data.customer_id]);
        if (custResult.rows[0]?.enterprise_id) enterpriseId = custResult.rows[0].enterprise_id;
      }

      // 3. Get punto_venta from company config
      const puntoVenta = data.punto_venta || 1;

      // 4. Validate items
      const validItems = (data.items || []).filter((i: any) => i.product_name?.trim());
      if (validItems.length === 0 && !data.order_id) {
        throw new ApiError(400, 'El remito debe tener al menos un item');
      }

      // 5. Lock and validate order_items (FOR UPDATE prevents race conditions)
      const orderItemIds = validItems.filter((i: any) => i.order_item_id).map((i: any) => i.order_item_id);

      if (orderItemIds.length > 0) {
        const lockResult = await client.query(
          `SELECT oi.id, oi.quantity, COALESCE(oi.qty_delivered, 0) as qty_delivered, o.enterprise_id
           FROM order_items oi JOIN orders o ON oi.order_id = o.id
           WHERE oi.id = ANY($1) AND o.company_id = $2 FOR UPDATE OF oi`,
          [orderItemIds, companyId]
        );
        const lockedItems = new Map(lockResult.rows.map((r: any) => [r.id, r]));

        for (const item of validItems) {
          if (!item.order_item_id) continue;
          const locked = lockedItems.get(item.order_item_id);
          if (!locked) throw new ApiError(400, `Item de pedido ${item.order_item_id} no encontrado`);
          if (enterpriseId && locked.enterprise_id && locked.enterprise_id !== enterpriseId) {
            throw new ApiError(400, `El item "${item.product_name}" pertenece a otra empresa`);
          }
          const available = parseFloat(locked.quantity) - parseFloat(locked.qty_delivered);
          if ((item.quantity || 1) > available + 0.01) {
            throw new ApiError(400, `No se pueden remitar ${item.quantity} de "${item.product_name}". Disponible: ${available}`);
          }
        }
      }

      // 5. Create remito
      const remitoId = uuid();
      const tipo = data.tipo === 'recepcion' ? 'recepcion' : 'entrega';
      await client.query(`
        INSERT INTO remitos (id, company_id, customer_id, enterprise_id, order_id, remito_number, punto_venta,
          date, delivery_address, receiver_name, transport, tipo, notes, status,
          factura_ref, pedido_ref, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pendiente',$14,$15,$16)
      `, [remitoId, companyId, data.customer_id || null, enterpriseId, data.order_id || null,
        remitoNumber, puntoVenta, data.date || new Date().toISOString(),
        data.delivery_address || null, data.receiver_name || null, data.transport || null,
        tipo, data.notes || null, data.factura_ref || null, data.pedido_ref || null, userId]);

      // 6. Create items + update qty_delivered + deduct stock for manual items
      const orderIdsSet = new Set<string>();
      for (const item of validItems) {
        const itemId = uuid();
        const qty = item.quantity || 1;
        await client.query(`
          INSERT INTO remito_items (id, remito_id, product_id, product_name, description, quantity, unit,
            unit_price, vat_rate, order_item_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [itemId, remitoId, item.product_id || null, item.product_name,
          item.description || null, qty, item.unit || 'unidades',
          item.unit_price || null, item.vat_rate || 21,
          item.order_item_id || null]);

        if (item.order_item_id) {
          // Item from order: update qty_delivered
          await client.query(
            'UPDATE order_items SET qty_delivered = COALESCE(qty_delivered, 0) + $1 WHERE id = $2',
            [qty, item.order_item_id]
          );
          const oiRes = await client.query('SELECT order_id FROM order_items WHERE id = $1', [item.order_item_id]);
          if (oiRes.rows[0]?.order_id) orderIdsSet.add(oiRes.rows[0].order_id);
        } else if (item.product_id) {
          // Manual item with product: deduct stock if controls_stock
          const prodCheck = await client.query(
            'SELECT controls_stock FROM products WHERE id = $1 AND company_id = $2',
            [item.product_id, companyId]
          );
          if (prodCheck.rows[0]?.controls_stock) {
            // Get default warehouse
            const whRes = await client.query(
              'SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1',
              [companyId]
            );
            const warehouseId = whRes.rows[0]?.id;
            if (warehouseId) {
              await client.query(`
                INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity,
                  movement_type, reference_type, reference_id, notes, created_by)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, 'salida', 'remito', $5, 'Remito item manual', $6)
              `, [companyId, item.product_id, warehouseId, -qty, remitoId, userId]);
              await client.query(
                'UPDATE stock SET quantity = COALESCE(quantity, 0) - $1 WHERE product_id = $2 AND warehouse_id = $3',
                [qty, item.product_id, warehouseId]
              );
            }
          }
        }
        // else: manual without product — just text, no stock/qty tracking
      }

      // 7. Create remito_orders entries
      for (const orderId of orderIdsSet) {
        await client.query(`
          INSERT INTO remito_orders (id, remito_id, order_id) VALUES (gen_random_uuid(), $1, $2)
          ON CONFLICT (remito_id, order_id) DO NOTHING
        `, [remitoId, orderId]);
      }
      // Also add legacy order_id if provided
      if (data.order_id && !orderIdsSet.has(data.order_id)) {
        // Validate order exists and belongs to same company before linking
        const orderCheck = await client.query(
          'SELECT id FROM orders WHERE id = $1 AND company_id = $2', [data.order_id, companyId]
        );
        if (orderCheck.rows.length > 0) {
          await client.query(`
            INSERT INTO remito_orders (id, remito_id, order_id) VALUES (gen_random_uuid(), $1, $2)
            ON CONFLICT (remito_id, order_id) DO NOTHING
          `, [remitoId, data.order_id]);
        }
      }

      await client.query('COMMIT');
      return { id: remitoId, remito_number: remitoNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create remito error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to create remito: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  async updateRemito(companyId: string, remitoId: string, data: any) {
    await this.ensureTables();
    try {
      // Verify remito belongs to company
      const existing = await this.getRemito(companyId, remitoId);
      if (!existing) throw new ApiError(404, 'Remito not found');

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || existing.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = getRows(custResult);
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      // Update remito record
      await db.execute(sql`
        UPDATE remitos SET
          customer_id = ${data.customer_id || existing.customer_id || null},
          enterprise_id = ${enterpriseId},
          delivery_address = ${data.delivery_address !== undefined ? data.delivery_address : existing.delivery_address},
          receiver_name = ${data.receiver_name !== undefined ? data.receiver_name : existing.receiver_name},
          transport = ${data.transport !== undefined ? data.transport : existing.transport},
          notes = ${data.notes !== undefined ? data.notes : existing.notes},
          date = ${data.date || existing.date},
          updated_at = NOW()
        WHERE id = ${remitoId} AND company_id = ${companyId}
      `);

      // Replace items if provided
      if (data.items && Array.isArray(data.items)) {
        await db.execute(sql`DELETE FROM remito_items WHERE remito_id = ${remitoId}`);
        for (const item of data.items) {
          await db.execute(sql`
            INSERT INTO remito_items (id, remito_id, product_name, description, quantity, unit)
            VALUES (${uuid()}, ${remitoId}, ${item.product_name}, ${item.description || null}, ${item.quantity || 1}, ${item.unit || 'unidades'})
          `);
        }
      }

      return { id: remitoId };
    } catch (error) {
      console.error('Update remito error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update remito');
    }
  }

  async updateRemitoStatus(companyId: string, remitoId: string, status: string) {
    await this.ensureTables();
    try {
      const validStatuses = ['pendiente', 'entregado', 'firmado'];
      if (!validStatuses.includes(status)) {
        throw new ApiError(400, 'Invalid status');
      }

      const result = await db.execute(sql`
        SELECT id, status FROM remitos WHERE id = ${remitoId} AND company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');
      if (rows[0].status === 'anulado') throw new ApiError(400, 'No se puede modificar un remito anulado');

      await db.execute(sql`
        UPDATE remitos SET status = ${status}, updated_at = NOW() WHERE id = ${remitoId}
      `);

      return { id: remitoId, status };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update remito status');
    }
  }

  /** Anular remito: revierte qty_delivered + devuelve stock de items manuales. No se elimina. */
  async anularRemito(companyId: string, remitoId: string, userId: string) {
    await this.ensureTables();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        'SELECT id, status FROM remitos WHERE id = $1 AND company_id = $2', [remitoId, companyId]
      );
      if (result.rows.length === 0) throw new ApiError(404, 'Remito not found');
      if (result.rows[0].status === 'anulado') throw new ApiError(400, 'El remito ya esta anulado');

      // Get all items
      const itemsResult = await client.query(
        'SELECT id, order_item_id, product_id, quantity FROM remito_items WHERE remito_id = $1',
        [remitoId]
      );

      for (const item of itemsResult.rows) {
        const qty = parseFloat(item.quantity || '0');

        if (item.order_item_id) {
          // Revert qty_delivered on order_item
          await client.query(
            'UPDATE order_items SET qty_delivered = GREATEST(COALESCE(qty_delivered, 0) - $1, 0) WHERE id = $2',
            [qty, item.order_item_id]
          );
        }

        if (item.product_id && !item.order_item_id) {
          // Manual item with product: return stock if controls_stock
          const prodCheck = await client.query(
            'SELECT controls_stock FROM products WHERE id = $1 AND company_id = $2',
            [item.product_id, companyId]
          );
          if (prodCheck.rows[0]?.controls_stock) {
            const whRes = await client.query(
              'SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1',
              [companyId]
            );
            const warehouseId = whRes.rows[0]?.id;
            if (warehouseId) {
              await client.query(`
                INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity,
                  movement_type, reference_type, reference_id, notes, created_by)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, 'entrada', 'anulacion_remito', $5, 'Anulacion remito', $6)
              `, [companyId, item.product_id, warehouseId, qty, remitoId, userId]);
              await client.query(
                'UPDATE stock SET quantity = COALESCE(quantity, 0) + $1 WHERE product_id = $2 AND warehouse_id = $3',
                [qty, item.product_id, warehouseId]
              );
            }
          }
        }
      }

      // Safety: recalculate qty_delivered for affected order_items
      for (const item of itemsResult.rows) {
        if (item.order_item_id) {
          await this.recalculateQtyDelivered(item.order_item_id);
        }
      }

      // Mark as anulado (don't delete)
      await client.query(
        'UPDATE remitos SET status = $1, updated_at = NOW() WHERE id = $2',
        ['anulado', remitoId]
      );

      await client.query('COMMIT');
      return { id: remitoId, status: 'anulado' };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to void remito: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  /** @deprecated Use anularRemito instead. Kept for backward compat. */
  async deleteRemito(companyId: string, remitoId: string) {
    // Redirect to anular
    return this.anularRemito(companyId, remitoId, '');
  }

  async uploadSignedPdf(companyId: string, remitoId: string, base64Data: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT id FROM remitos WHERE id = ${remitoId} AND company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');

      await db.execute(sql`
        UPDATE remitos SET signed_pdf_url = ${base64Data} WHERE id = ${remitoId}
      `);

      return { id: remitoId, uploaded: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to upload signed PDF');
    }
  }

  async getSignedPdf(companyId: string, remitoId: string): Promise<string | null> {
    try {
      const result = await db.execute(sql`
        SELECT signed_pdf_url FROM remitos WHERE id = ${remitoId} AND company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');
      return rows[0].signed_pdf_url || null;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get signed PDF');
    }
  }

  async generateRemitoPdf(companyId: string, remitoId: string): Promise<Buffer> {
    try {
      const remito = await this.getRemito(companyId, remitoId);

      const companyResult = await db.execute(sql`SELECT * FROM companies WHERE id = ${companyId}`);
      const companyRows = getRows(companyResult);
      if (companyRows.length === 0) throw new ApiError(404, 'Company not found');
      const company = companyRows[0];

      const html = this.buildRemitoHtml(company, remito);

      const browser = await puppeteer.launch({
        headless: 'new' as any,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
        printBackground: true,
      });
      await browser.close();

      return pdf;
    } catch (error) {
      console.error('Generate remito PDF error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate remito PDF');
    }
  }

  private buildRemitoHtml(company: any, remito: any, tipo?: string): string {
    const items = remito.items || [];
    const enterprise = remito.enterprise || {};
    const customer = remito.customer || {};
    const fecha = new Date(remito.date || remito.created_at).toLocaleDateString('es-AR');
    const pv = String(remito.punto_venta || company.punto_venta_remito || company.punto_venta || 1).padStart(4, '0');
    const num = String(remito.remito_number || 0).padStart(8, '0');
    const remitoTipo = tipo || remito.tipo || 'entrega';
    const isRecepcion = remitoTipo === 'recepcion';

    // Receptor data: prefer enterprise, fallback to customer
    const receptor = {
      name: enterprise.razon_social || enterprise.name || customer.name || '',
      address: remito.delivery_address || enterprise.address || customer.address || '',
      city: enterprise.city || '',
      province: enterprise.province || '',
      cp: enterprise.postal_code || '',
      cuit: enterprise.cuit || customer.cuit || '',
      iva: enterprise.tax_condition || '',
    };
    const domicilio = [receptor.address, receptor.city, receptor.cp ? `(${receptor.cp})` : ''].filter(Boolean).join(', ');

    // Cross-references
    const facturaRef = remito.factura_ref || '';
    const pedidoRef = remito.pedido_ref || (remito.order ? `${pv}-${String(remito.order.order_number || 0).padStart(8, '0')}` : '');

    // Item rows
    const itemRows = items.map((item: any) => `
      <tr>
        <td class="qty">${Number(item.quantity)}</td>
        <td class="desc">${item.quantity}x ${item.product_name}${item.description ? '  ' + item.description : ''}</td>
      </tr>
    `).join('');

    // Empty rows to fill the page
    const emptyRows = Math.max(0, 15 - items.length);
    const emptyRowsHtml = Array(emptyRows).fill('<tr><td class="qty">&nbsp;</td><td class="desc">&nbsp;</td></tr>').join('');

    // Company config
    const companyName = company.razon_social || company.name || '';
    const companyRubro = company.rubro_descripcion || '';
    const companyAddress = [company.address, company.city ? `(${company.postal_code || ''}) ${company.city}` : ''].filter(Boolean).join(' - ');
    const companyProvince = company.province ? `Prov. de ${company.province} - Argentina` : '';
    const companyPhone = company.phone ? `Tel.: ${company.phone}` : '';
    const companyEmail = company.email || '';
    const companyWeb = company.website || '';
    const companyIva = company.condicion_iva || company.tax_condition || 'IVA RESPONSABLE INSCRIPTO';
    const companyCuit = company.cuit || '';
    const companyIIBB = company.ingresos_brutos || '';
    const companyInicio = company.inicio_actividad ? new Date(company.inicio_actividad).toLocaleDateString('es-AR') : '';
    const caiRemito = company.cai_remito || '';
    const caiVto = company.cai_remito_vto ? new Date(company.cai_remito_vto).toLocaleDateString('es-AR') : '';

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#000; font-size:11px; line-height:1.3; }
  @page { margin: 10mm; }
  table { border-collapse:collapse; }
  .outer { border:2px solid #000; width:100%; }
  .outer td, .outer th { border:1px solid #000; padding:4px 6px; vertical-align:top; }
  .header-left { width:50%; font-size:10px; }
  .header-right { width:50%; }
  .company-name { font-size:18px; font-weight:bold; text-align:center; margin-bottom:2px; }
  .company-sub { font-size:9px; text-align:center; color:#333; }
  .r-box { width:70px; height:70px; border:2px solid #000; text-align:center; margin:0 auto; }
  .r-letter { font-size:32px; font-weight:bold; line-height:1; margin-top:6px; }
  .r-sub { font-size:7px; color:#333; border-top:1px solid #000; margin-top:2px; padding-top:2px; }
  .remito-title { font-size:16px; font-weight:bold; }
  .remito-num { font-size:14px; font-weight:bold; margin-top:2px; }
  .items-table { width:100%; }
  .items-table td { border-bottom:1px solid #ccc; padding:3px 6px; min-height:20px; }
  .items-table .qty { width:60px; text-align:center; border-right:1px solid #000; }
  .items-table .desc { text-align:left; }
  .items-header { background:#f0f0f0; font-weight:bold; font-size:10px; text-transform:uppercase; }
  .items-header td { border-bottom:2px solid #000; }
  .firma-section td { padding:8px 6px; height:60px; vertical-align:bottom; }
  .footer-row { font-size:8px; color:#333; }
  .footer-row td { padding:3px 6px; }
</style></head>
<body>

<!-- Remito documento — formato fiscal argentino -->
<table class="outer">
  <!-- ROW 1: Header (emisor left | R badge center | remito info right) -->
  <tr>
    <td class="header-left" rowspan="2" style="width:48%; vertical-align:top; padding:8px 10px;">
      <div class="company-name">${companyName}</div>
      ${companyRubro ? `<div class="company-sub">${companyRubro}</div>` : ''}
      <div class="company-sub" style="margin-top:4px;">${companyAddress}</div>
      ${companyProvince ? `<div class="company-sub">${companyProvince}</div>` : ''}
      ${companyPhone ? `<div class="company-sub">${companyPhone}</div>` : ''}
      ${companyEmail ? `<div class="company-sub">${companyEmail}</div>` : ''}
      ${companyWeb ? `<div class="company-sub">${companyWeb}</div>` : ''}
      <div class="company-sub" style="font-weight:bold; margin-top:4px;">${companyIva}</div>
    </td>
    <td style="width:4%; vertical-align:top; text-align:center; padding:6px;">
      <div class="r-box">
        <div class="r-letter">R</div>
        <div class="r-sub">DOCUMENTO<br>NO VALIDO<br>COMO FACTURA<br>COD. N&deg; 91</div>
      </div>
    </td>
    <td class="header-right" style="width:48%; vertical-align:top; padding:8px 10px;">
      <div class="remito-title">REMITO</div>
      <div class="remito-num">N&deg; ${pv}-${num}</div>
      <div style="margin-top:8px; font-size:11px;">
        <strong>FECHA:</strong> &nbsp;&nbsp;&nbsp; ${fecha}
      </div>
    </td>
  </tr>
  <tr>
    <!-- header-left continues (rowspan) -->
    <td style="border-top:1px solid #000; text-align:center; font-size:8px; padding:2px;">
      <!-- empty under R box -->
    </td>
    <td style="vertical-align:top; padding:6px 10px; font-size:10px;">
      <div>C.U.I.T. &nbsp;${companyCuit}</div>
      ${companyIIBB ? `<div>ING. BRUTOS: ${companyIIBB}</div>` : ''}
      ${companyInicio ? `<div>Inicio de Actividad ${companyInicio}</div>` : ''}
    </td>
  </tr>

  <!-- ROW 2: Receptor (SEÑOR/ES + DOMICILIO) -->
  <tr>
    <td colspan="2" style="padding:6px 10px;">
      <div style="font-size:9px; font-weight:bold; color:#333;">SEÑOR(ES):</div>
      <div style="font-size:13px; font-weight:bold; margin-top:2px;">${receptor.name || '&nbsp;'}</div>
    </td>
    <td style="padding:6px 10px;">
      <div style="font-size:9px; font-weight:bold; color:#333;">DOMICILIO:</div>
      <div style="font-size:11px; margin-top:2px;">${domicilio || '&nbsp;'}</div>
    </td>
  </tr>

  <!-- ROW 3: IVA + CUIT receptor -->
  <tr>
    <td style="padding:4px 10px;">
      <span style="font-size:9px; font-weight:bold;">IVA</span>
      &nbsp;&nbsp;${receptor.iva || '&nbsp;'}
    </td>
    <td colspan="2" style="padding:4px 10px;">
      <span style="font-size:9px; font-weight:bold;">CUIT N&deg;:</span>
      &nbsp;&nbsp;${receptor.cuit || '&nbsp;'}
    </td>
  </tr>

  <!-- ROW 4: CONDICIONES DE PAGO | N° CLIENTE | FACTURA N° | O. PEDIDO N° -->
  <tr style="font-size:9px;">
    <td style="padding:2px 6px; font-weight:bold;">CONDICIONES DE PAGO</td>
    <td style="padding:2px 6px; font-weight:bold; text-align:center;">N&deg; CLIENTE:</td>
    <td style="padding:2px 6px;">
      <table style="width:100%; border:none;">
        <tr>
          <td style="border:none; padding:0 4px; font-weight:bold;">FACTURA N&deg;:</td>
          <td style="border:none; padding:0 4px; font-weight:bold;">O. PEDIDO N&deg;:</td>
        </tr>
      </table>
    </td>
  </tr>
  <tr style="font-size:10px;">
    <td style="padding:4px 6px;">&nbsp;</td>
    <td style="padding:4px 6px; text-align:center;">&nbsp;</td>
    <td style="padding:4px 6px;">
      <table style="width:100%; border:none;">
        <tr>
          <td style="border:none; padding:0 4px;">${facturaRef || '&nbsp;'}</td>
          <td style="border:none; padding:0 4px;">${pedidoRef || '&nbsp;'}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- ITEMS TABLE -->
<table class="items-table" style="border:2px solid #000; border-top:none; margin-top:-2px;">
  <tr class="items-header">
    <td class="qty" style="border-top:2px solid #000;">CANTIDAD</td>
    <td class="desc" style="border-top:2px solid #000;">DESCRIPCION</td>
  </tr>
  ${itemRows}
  ${emptyRowsHtml}
</table>

<!-- RECIBI CONFORME -->
<table style="width:100%; border:2px solid #000; border-top:none; margin-top:-2px;">
  <tr class="firma-section">
    <td style="width:100%; padding:10px; font-size:10px; font-weight:bold; border:none;">
      RECIBI CONFORME:
    </td>
  </tr>
  <tr>
    <td style="border:none; padding:8px 10px;">
      <table style="width:100%; border:none;">
        <tr>
          <td style="border:none; width:50%; padding:8px 0; vertical-align:bottom;">
            <div style="border-bottom:1px solid #000; padding-bottom:30px; margin-right:20px;">
              <span style="font-size:9px; font-weight:bold;">ACLARACION:</span>
            </div>
          </td>
          <td style="border:none; width:50%; padding:8px 0; vertical-align:bottom;">
            <div style="border-bottom:1px solid #000; padding-bottom:30px; margin-left:20px;">
              <span style="font-size:9px; font-weight:bold;">FIRMA:</span>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- FOOTER: imprenta datos -->
<table style="width:100%; margin-top:8px; font-size:7px; color:#666;">
  <tr class="footer-row">
    <td style="border:none; width:40%;">&nbsp;</td>
    <td style="border:none; width:30%; text-align:center;">
      ORIGINAL &nbsp;BLANCO<br>
      DUPLICADO &nbsp;COLOR
    </td>
    <td style="border:none; width:30%; text-align:right;">
      ${caiRemito ? `C.A.I.: ${caiRemito}` : ''}
      ${caiVto ? `<br>F. VTO.: ${caiVto}` : ''}
    </td>
  </tr>
</table>

</body>
</html>`;
  }
  // ═══════════════════════════════════════════════════════════════════
  // AVAILABILITY QUERIES — Plan 11, Fase 2
  // ═══════════════════════════════════════════════════════════════════

  /** Items de un pedido que se pueden remitar (qty_available > 0) */
  async getAvailableOrderItemsForRemito(companyId: string, orderId: string) {
    await this.ensureTables();
    const r = await pool.query(`
      SELECT
        oi.id as order_item_id, oi.product_id, oi.product_name, oi.description,
        oi.quantity, CAST(oi.unit_price AS text) as unit_price, COALESCE(oi.vat_rate, 21) as vat_rate,
        COALESCE(oi.qty_delivered, 0) as qty_delivered,
        oi.quantity - COALESCE(oi.qty_delivered, 0) as qty_available,
        o.order_number, o.title as order_title, o.enterprise_id,
        e.name as enterprise_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      WHERE o.company_id = $1 AND o.id = $2 AND o.status != 'cancelado'
        AND oi.quantity - COALESCE(oi.qty_delivered, 0) > 0
      ORDER BY oi.created_at ASC
    `, [companyId, orderId]);
    return r.rows;
  }

  /** Items de TODOS los pedidos de una empresa que se pueden remitar */
  async getAvailableOrderItemsForRemitoByEnterprise(companyId: string, enterpriseId: string) {
    await this.ensureTables();
    const r = await pool.query(`
      SELECT
        oi.id as order_item_id, oi.product_id, oi.product_name, oi.description,
        oi.quantity, CAST(oi.unit_price AS text) as unit_price, COALESCE(oi.vat_rate, 21) as vat_rate,
        COALESCE(oi.qty_delivered, 0) as qty_delivered,
        oi.quantity - COALESCE(oi.qty_delivered, 0) as qty_available,
        o.id as order_id, o.order_number, o.title as order_title, o.enterprise_id,
        e.name as enterprise_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      WHERE o.company_id = $1 AND o.enterprise_id = $2 AND o.status != 'cancelado'
        AND oi.quantity - COALESCE(oi.qty_delivered, 0) > 0
      ORDER BY o.order_number ASC, oi.created_at ASC
    `, [companyId, enterpriseId]);
    return r.rows;
  }

  /** Items de una factura resueltos a order_items para crear remito desde factura */
  async getInvoiceItemsForRemito(companyId: string, invoiceId: string) {
    await this.ensureTables();
    const r = await pool.query(`
      SELECT ii.id as invoice_item_id, ii.product_id, ii.product_name,
        ii.quantity as invoice_qty, CAST(ii.unit_price AS text) as unit_price,
        COALESCE(ii.vat_rate, 21) as vat_rate,
        ii.order_item_id,
        i.enterprise_id,
        CASE WHEN ii.order_item_id IS NOT NULL THEN
          oi.quantity - COALESCE(oi.qty_delivered, 0)
        ELSE ii.quantity END as qty_available,
        CASE WHEN ii.order_item_id IS NOT NULL THEN
          'Pedido #' || LPAD(o.order_number::text, 4, '0')
        ELSE 'Manual' END as source_ref,
        o.id as order_id
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      LEFT JOIN order_items oi ON ii.order_item_id = oi.id
      LEFT JOIN orders o ON oi.order_id = o.id
      WHERE i.company_id = $1 AND i.id = $2 AND i.status != 'cancelled'
      ORDER BY ii.created_at ASC
    `, [companyId, invoiceId]);
    return r.rows.filter((row: any) => parseFloat(row.qty_available || '0') > 0);
  }

  /** Datos de contexto de un remito (items status) */
  async getRemitoContextData(companyId: string, remitoId: string) {
    await this.ensureTables();

    // Items con origen
    const itemsRes = await pool.query(`
      SELECT ri.id, ri.product_name, ri.quantity, ri.order_item_id, ri.product_id,
        CASE
          WHEN ri.order_item_id IS NOT NULL THEN (
            SELECT 'Pedido #' || LPAD(o.order_number::text, 4, '0')
            FROM order_items oi JOIN orders o ON oi.order_id = o.id
            WHERE oi.id = ri.order_item_id
          )
          ELSE 'Manual'
        END as source_ref
      FROM remito_items ri
      WHERE ri.remito_id = $1
      ORDER BY ri.id
    `, [remitoId]);

    return {
      items_status: itemsRes.rows,
    };
  }

  /** Reconciliar qty_delivered (safety net) */
  async recalculateQtyDelivered(orderItemId: string) {
    await pool.query(`
      UPDATE order_items SET qty_delivered = (
        SELECT COALESCE(SUM(ri.quantity), 0)
        FROM remito_items ri WHERE ri.order_item_id = order_items.id
      ) WHERE id = $1
    `, [orderItemId]);
  }
}

export const remitosService = new RemitosService();
