import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import puppeteer from 'puppeteer';
import { getRows, getFirstRow } from '../../lib/db-utils';
import { escapeHtml as sharedEscapeHtml } from '../../lib/html-escape';
import { validateBase64Upload } from '../../lib/upload-validation';
import { ordersService } from '../orders/orders.service';
import { activityService } from '../activity/activity.service';

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

      // PR7-T7: Backfill remito_orders para remitos huerfanos. Tres vias:
      //   1) legacy remitos.order_id ya seteado
      //   2) items con order_item_id → order_items.order_id
      // Ejecutar una sola vez (idempotente gracias a ON CONFLICT).
      await pool.query(`
        INSERT INTO remito_orders (id, remito_id, order_id)
        SELECT gen_random_uuid(), r.id, r.order_id
        FROM remitos r
        WHERE r.order_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM remito_orders ro
            WHERE ro.remito_id = r.id AND ro.order_id = r.order_id
          )
        ON CONFLICT (remito_id, order_id) DO NOTHING
      `).catch((err: any) => console.error('[PR7-T7 backfill remito_orders legacy]', err.message));
      await pool.query(`
        INSERT INTO remito_orders (id, remito_id, order_id)
        SELECT DISTINCT gen_random_uuid(), ri.remito_id, oi.order_id
        FROM remito_items ri
        JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.order_item_id IS NOT NULL
          AND oi.order_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM remito_orders ro
            WHERE ro.remito_id = ri.remito_id AND ro.order_id = oi.order_id
          )
        ON CONFLICT (remito_id, order_id) DO NOTHING
      `).catch((err: any) => console.error('[PR7-T7 backfill remito_orders items]', err.message));

      // PR7-T9: 3er via — parsear pedido_ref ("#0006" / "0006" / "Pedido 0006")
      // y matchear contra orders.order_number + company_id. Cubre remitos donde
      // el usuario tipeo la referencia pero no linkeo items.
      await pool.query(`
        INSERT INTO remito_orders (id, remito_id, order_id)
        SELECT DISTINCT gen_random_uuid(), r.id, o.id
        FROM remitos r
        JOIN orders o ON o.company_id = r.company_id
          AND o.order_number = CAST(NULLIF(regexp_replace(r.pedido_ref, '[^0-9]', '', 'g'), '') AS integer)
        WHERE r.pedido_ref IS NOT NULL
          AND r.pedido_ref ~ '[0-9]'
          AND NOT EXISTS (
            SELECT 1 FROM remito_orders ro
            WHERE ro.remito_id = r.id AND ro.order_id = o.id
          )
        ON CONFLICT (remito_id, order_id) DO NOTHING
      `).catch((err: any) => console.error('[PR7-T9 backfill remito_orders pedido_ref]', err.message));

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
    fiscal_type?: 'fiscal' | 'no_fiscal' | 'all';
    userCanAccessLuna?: boolean;
  } = {}) {
    await this.ensureTables();
    try {
      const { enterprise_id, status, tipo, search, date_from, date_to } = filters;

      // Sol/Luna circuit filter: non-Luna users NEVER see Luna rows.
      // Luna users can request 'fiscal' | 'no_fiscal' | 'all' (default: 'all').
      const canLuna = !!filters.userCanAccessLuna;
      let effectiveFiscal: 'fiscal' | 'no_fiscal' | 'all';
      if (!canLuna) {
        effectiveFiscal = 'fiscal';
      } else if (filters.fiscal_type === 'fiscal' || filters.fiscal_type === 'no_fiscal' || filters.fiscal_type === 'all') {
        effectiveFiscal = filters.fiscal_type;
      } else {
        effectiveFiscal = 'all';
      }
      // BUG S6 #3/#4: clamp limit/skip to safe ranges
      const rawLimit = Number(filters.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 100;
      const rawSkip = Number(filters.skip);
      const skip = Number.isFinite(rawSkip) && rawSkip >= 0 ? Math.floor(rawSkip) : 0;

      // BUG S6 #12: validate UUID format if enterprise_id provided
      if (enterprise_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(enterprise_id)) {
        throw new ApiError(400, 'enterprise_id invalido');
      }

      let whereClause = sql`r.company_id = ${companyId}`;
      if (effectiveFiscal === 'fiscal') {
        whereClause = sql`${whereClause} AND (r.fiscal_type = 'fiscal' OR r.fiscal_type IS NULL)`;
      } else if (effectiveFiscal === 'no_fiscal') {
        whereClause = sql`${whereClause} AND r.fiscal_type = 'no_fiscal'`;
      }
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
        // BUG S10 #9: limit search length to prevent DoS
        const safe = String(search).slice(0, 200);
        // BUG S6 #5: escape LIKE wildcards (% and _) in user input
        const escaped = safe.replace(/[\\%_]/g, (m) => '\\' + m);
        const pattern = '%' + escaped + '%';
        whereClause = sql`${whereClause} AND (c.name ILIKE ${pattern} OR r.receiver_name ILIKE ${pattern} OR r.delivery_address ILIKE ${pattern})`;
      }
      // BUG S10 #11: validate date formats
      if (date_from) {
        if (isNaN(new Date(date_from).getTime())) {
          throw new ApiError(400, 'date_from invalido');
        }
        whereClause = sql`${whereClause} AND r.date >= ${date_from}`;
      }
      if (date_to) {
        if (isNaN(new Date(date_to).getTime())) {
          throw new ApiError(400, 'date_to invalido');
        }
        // PR7-T1: offset AR -03:00
        whereClause = sql`${whereClause} AND r.date <= ${date_to + 'T23:59:59.999-03:00'}`;
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

      // BUG S6 #7: total real para paginacion (no rows.length)
      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int as total
        FROM remitos r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        WHERE ${whereClause}
      `);
      const total = Number((getRows(countResult)[0] as any)?.total || 0);

      return { items: rows, total };
    } catch (error) {
      console.error('Get remitos error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get remitos');
    }
  }

  async getRemito(companyId: string, remitoId: string, opts: { userCanAccessLuna?: boolean } = {}): Promise<Record<string, any>> {
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

      // Sol/Luna: row-level guard — non-Luna users get 404 on Luna rows.
      const rowFiscal = (rows[0].fiscal_type || 'fiscal') as 'fiscal' | 'no_fiscal';
      if (rowFiscal === 'no_fiscal' && !opts.userCanAccessLuna) {
        throw new ApiError(404, 'Remito not found');
      }

      // PR7-T18: items incluyen qty_pending_to_invoice para el flujo
      // "Crear factura desde remito". Por cada remito_item con order_item_id:
      //   order_item_total     = order_items.quantity
      //   order_item_invoiced  = SUM(invoice_items.quantity) de TODAS las facturas
      //                          no canceladas ni NC que referencian ese order_item_id
      //   qty_pending_to_invoice = LEAST(ri.quantity, order_item_total - order_item_invoiced)
      // Para items manuales (order_item_id=NULL), qty_pending_to_invoice = ri.quantity
      // (no hay forma de saber si ya se facturo manualmente).
      const itemsResult = await pool.query(`
        SELECT ri.*,
          CASE
            WHEN ri.order_item_id IS NOT NULL THEN (
              SELECT 'Pedido #' || LPAD(o2.order_number::text, 4, '0')
              FROM order_items oi2 JOIN orders o2 ON oi2.order_id = o2.id
              WHERE oi2.id = ri.order_item_id
            )
            ELSE 'Manual'
          END as source_ref,
          CASE
            WHEN ri.order_item_id IS NOT NULL THEN (
              SELECT CAST(oi.quantity AS decimal)
              FROM order_items oi WHERE oi.id = ri.order_item_id
            )
            ELSE NULL
          END as order_item_total,
          CASE
            WHEN ri.order_item_id IS NOT NULL THEN COALESCE((
              SELECT SUM(CAST(ii.quantity AS decimal))
              FROM invoice_items ii
              JOIN invoices inv ON ii.invoice_id = inv.id
              WHERE ii.order_item_id = ri.order_item_id
                AND inv.status != 'cancelled'
                AND inv.invoice_type::text NOT LIKE 'NC%'
            ), 0)
            ELSE 0
          END as order_item_invoiced,
          CASE
            WHEN ri.order_item_id IS NOT NULL THEN GREATEST(
              LEAST(
                CAST(ri.quantity AS decimal),
                (SELECT CAST(oi.quantity AS decimal) FROM order_items oi WHERE oi.id = ri.order_item_id) - COALESCE((
                  SELECT SUM(CAST(ii.quantity AS decimal))
                  FROM invoice_items ii
                  JOIN invoices inv ON ii.invoice_id = inv.id
                  WHERE ii.order_item_id = ri.order_item_id
                    AND inv.status != 'cancelled'
                    AND inv.invoice_type::text NOT LIKE 'NC%'
                ), 0)
              ),
              0
            )
            ELSE CAST(ri.quantity AS decimal)
          END as qty_pending_to_invoice
        FROM remito_items ri WHERE ri.remito_id = $1 ORDER BY ri.created_at ASC, ri.id ASC
      `, [remitoId]);
      const items = itemsResult.rows || [];

      // Also add enterprise info (BUG S6 #2: scope to company_id)
      let enterprise = null;
      if (rows[0].enterprise_id) {
        const entResult = await pool.query(
          'SELECT id, name, razon_social, cuit, tax_condition, address, city, province FROM enterprises WHERE id = $1 AND company_id = $2',
          [rows[0].enterprise_id, companyId]
        );
        enterprise = entResult.rows[0] || null;
      }

      return { ...rows[0], items, enterprise };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get remito');
    }
  }

  async createRemito(companyId: string, userId: string, data: any, opts: { userCanAccessLuna?: boolean } = {}) {
    await this.ensureTables();

    // ═══ Sol/Luna: validate fiscal_type if explicitly passed (standalone remitos) ═══
    // For order-linked remitos, fiscal_type is derived inside the tx from the
    // linked orders and must match. For standalone remitos (no order link),
    // we honor the payload (default 'fiscal'). Luna requires user access.
    if (data.fiscal_type !== undefined && data.fiscal_type !== null) {
      if (data.fiscal_type !== 'fiscal' && data.fiscal_type !== 'no_fiscal') {
        throw new ApiError(400, 'fiscal_type invalido. Valores: fiscal, no_fiscal');
      }
      if (data.fiscal_type === 'no_fiscal' && !opts.userCanAccessLuna) {
        throw new ApiError(403, 'Sin acceso al circuito Luna');
      }
    }

    // ═══ VALIDATIONS (Plan: Seccion 2 + 3 bugs) ═══
    // BUG #5/6: validate each item qty > 0 BEFORE opening connection
    // BUG #6 Seccion 3: product_name length
    const allItems = data.items || [];
    for (const item of allItems) {
      if (!item.product_name || !String(item.product_name).trim()) continue;
      if (String(item.product_name).length > 255) {
        throw new ApiError(400, 'product_name no puede exceder 255 caracteres');
      }
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(400, `Cantidad invalida en "${item.product_name}". Debe ser un numero positivo > 0`);
      }
      // BUG S10 #7: unit_price no negativo
      if (item.unit_price !== undefined && item.unit_price !== null) {
        const up = Number(item.unit_price);
        if (!Number.isFinite(up) || up < 0) {
          throw new ApiError(400, `Precio unitario invalido en "${item.product_name}". Debe ser >= 0`);
        }
      }
      // BUG S10 #8: vat_rate 0-100
      if (item.vat_rate !== undefined && item.vat_rate !== null) {
        const vr = Number(item.vat_rate);
        if (!Number.isFinite(vr) || vr < 0 || vr > 100) {
          throw new ApiError(400, `IVA invalido en "${item.product_name}". Debe estar entre 0 y 100`);
        }
      }
    }

    // BUG #7: validate date format + BUG S10 #4: date range
    if (data.date) {
      const d = new Date(data.date);
      if (isNaN(d.getTime())) {
        throw new ApiError(400, 'Fecha invalida. Debe ser formato ISO 8601');
      }
      const now = Date.now();
      const oneYearFuture = now + 365 * 24 * 3600 * 1000;
      const fiveYearsPast = now - 5 * 365 * 24 * 3600 * 1000;
      if (d.getTime() > oneYearFuture) {
        throw new ApiError(400, 'Fecha invalida: no puede ser mas de un año en el futuro');
      }
      if (d.getTime() < fiveYearsPast) {
        throw new ApiError(400, 'Fecha invalida: no puede ser mas de 5 años en el pasado');
      }
    }

    // BUG S10 #5: punto_venta validation
    if (data.punto_venta !== undefined && data.punto_venta !== null) {
      const pv = Number(data.punto_venta);
      if (!Number.isInteger(pv) || pv < 1 || pv > 9999) {
        throw new ApiError(400, 'punto_venta invalido. Debe ser un entero entre 1 y 9999');
      }
    }

    // BUG S10 #6: tipo whitelist estricto
    if (data.tipo !== undefined && data.tipo !== null && !['entrega', 'recepcion'].includes(data.tipo)) {
      throw new ApiError(400, `tipo invalido. Valores permitidos: entrega, recepcion`);
    }

    // BUG #9: validate text field lengths
    if (data.delivery_address && String(data.delivery_address).length > 500) {
      throw new ApiError(400, 'La direccion de entrega no puede exceder 500 caracteres');
    }
    if (data.receiver_name && String(data.receiver_name).length > 255) {
      throw new ApiError(400, 'El nombre del receptor no puede exceder 255 caracteres');
    }
    if (data.transport && String(data.transport).length > 255) {
      throw new ApiError(400, 'El transporte no puede exceder 255 caracteres');
    }
    if (data.notes && String(data.notes).length > 2000) {
      throw new ApiError(400, 'Las notas no pueden exceder 2000 caracteres');
    }
    // BUG S5 #6: factura_ref length
    if (data.factura_ref && String(data.factura_ref).length > 100) {
      throw new ApiError(400, 'La referencia de factura no puede exceder 100 caracteres');
    }
    if (data.pedido_ref && String(data.pedido_ref).length > 100) {
      throw new ApiError(400, 'La referencia de pedido no puede exceder 100 caracteres');
    }

    // BUG #2: validate enterprise_id belongs to company (IDOR fix)
    if (data.enterprise_id) {
      const entCheck = await pool.query(
        'SELECT id FROM enterprises WHERE id = $1 AND company_id = $2',
        [data.enterprise_id, companyId]
      );
      if (entCheck.rows.length === 0) {
        throw new ApiError(400, 'La empresa no existe o no pertenece a tu compania');
      }
    }

    // BUG #3: validate customer_id belongs to company (IDOR fix)
    if (data.customer_id) {
      const custCheck = await pool.query(
        'SELECT id, enterprise_id FROM customers WHERE id = $1 AND company_id = $2',
        [data.customer_id, companyId]
      );
      if (custCheck.rows.length === 0) {
        throw new ApiError(400, 'El cliente no existe o no pertenece a tu compania');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // BUG S3-MISSED #3: advisory lock on company to serialize remito_number generation
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`remito_num:${companyId}`]);

      // 1. Get next remito number
      const numResult = await client.query(
        'SELECT COALESCE(MAX(remito_number), 0) + 1 as next_number FROM remitos WHERE company_id = $1',
        [companyId]
      );
      const remitoNumber = parseInt(numResult.rows[0]?.next_number || '1');

      // 2. Resolve enterprise_id
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await client.query(
          'SELECT enterprise_id FROM customers WHERE id = $1 AND company_id = $2',
          [data.customer_id, companyId]
        );
        if (custResult.rows[0]?.enterprise_id) enterpriseId = custResult.rows[0].enterprise_id;
      }

      // 3. Get punto_venta from company config
      const puntoVenta = data.punto_venta || 1;

      // 4. Validate items (BUG S3-MISSED #4: reject empty product_name instead of silent drop)
      const rawItems = data.items || [];
      for (const it of rawItems) {
        if (!it.product_name || !String(it.product_name).trim()) {
          throw new ApiError(400, 'Cada item debe tener product_name no vacio');
        }
      }
      const validItems = rawItems;
      if (validItems.length === 0 && !data.order_id) {
        throw new ApiError(400, 'El remito debe tener al menos un item');
      }

      // 5. Lock and validate order_items (FOR UPDATE prevents race conditions)
      const orderItemIds = [...new Set(validItems.filter((i: any) => i.order_item_id).map((i: any) => i.order_item_id))];

      const orderIdsSet = new Set<string>();

      if (orderItemIds.length > 0) {
        // BUG S4 #1: exclude items from cancelled orders
        const lockResult = await client.query(
          `SELECT oi.id, oi.quantity, COALESCE(oi.qty_delivered, 0) as qty_delivered, o.enterprise_id, oi.order_id, o.status as order_status, o.fiscal_type
           FROM order_items oi JOIN orders o ON oi.order_id = o.id
           WHERE oi.id = ANY($1) AND o.company_id = $2
             AND o.status NOT IN ('cancelado', 'cancelled')
           FOR UPDATE OF oi`,
          [orderItemIds, companyId]
        );
        const lockedItems = new Map(lockResult.rows.map((r: any) => [r.id, r]));

        // BUG #4: if no enterpriseId provided, derive from first order_item
        if (!enterpriseId && lockResult.rows.length > 0) {
          enterpriseId = lockResult.rows[0].enterprise_id;
        }

        // BUG #1 + PR2-T8: accumulate qty by order_item_id with NaN guard
        const qtyByOrderItem = new Map<string, number>();
        for (const item of validItems) {
          if (!item.order_item_id) continue;
          const q = Number(item.quantity);
          if (!Number.isFinite(q) || q <= 0) {
            throw new ApiError(
              400,
              `Cantidad invalida en item ${item.order_item_id}: "${item.quantity}". Debe ser un numero positivo.`
            );
          }
          qtyByOrderItem.set(
            item.order_item_id,
            (qtyByOrderItem.get(item.order_item_id) || 0) + q
          );
        }

        for (const [oiId, totalQty] of qtyByOrderItem.entries()) {
          const locked = lockedItems.get(oiId);
          if (!locked) throw new ApiError(400, `Item de pedido ${oiId} no encontrado, pertenece a otra compania, o el pedido esta cancelado`);
          // BUG S4 #2: reject items with NULL enterprise_id (dirty data / bypass)
          if (!locked.enterprise_id) {
            throw new ApiError(400, `Item ${oiId} no tiene empresa asignada. Pedido invalido.`);
          }
          // BUG #4/S4: enforce enterprise consistency (all items must be from same enterprise)
          if (locked.enterprise_id !== enterpriseId) {
            throw new ApiError(400, `Los items pertenecen a distintas empresas. Un remito solo puede tener items de una empresa.`);
          }
          // PR2-T8: parseFloat puede devolver NaN si locked.quantity es string corrupto.
          // `available = NaN - X = NaN` y `totalQty > NaN` es false (bypass silencioso).
          const lockedQty = parseFloat(locked.quantity);
          const lockedDelivered = parseFloat(locked.qty_delivered);
          if (!Number.isFinite(lockedQty) || !Number.isFinite(lockedDelivered)) {
            throw new ApiError(
              400,
              `Datos corruptos en item de pedido ${oiId}: quantity/qty_delivered no numericos`
            );
          }
          const available = lockedQty - lockedDelivered;
          if (totalQty > available + 0.01) {
            throw new ApiError(400,
              `No se pueden remitar ${totalQty} unidades del item ${oiId}. Disponible: ${available}. ` +
              `(Verifica que no estes enviando el mismo item dos veces)`
            );
          }
          // Collect order_id directly from lock result (BUG #8: avoid N+1 query)
          if (locked.order_id) orderIdsSet.add(locked.order_id);
        }
      }

      // ═══ Sol/Luna: derive fiscal_type from linked orders ═══
      // Gather candidate order_ids from: item-level links + legacy order_id.
      const candidateOrderIds = new Set<string>(orderIdsSet);
      if (data.order_id) candidateOrderIds.add(data.order_id);

      let derivedFiscalType: 'fiscal' | 'no_fiscal' = 'fiscal';
      if (candidateOrderIds.size > 0) {
        const fiscalRes = await client.query(
          `SELECT DISTINCT COALESCE(fiscal_type, 'fiscal') AS fiscal_type
             FROM orders WHERE id = ANY($1) AND company_id = $2`,
          [Array.from(candidateOrderIds), companyId]
        );
        const distinctFiscals = fiscalRes.rows.map((r: any) => r.fiscal_type || 'fiscal');
        if (distinctFiscals.length > 1) {
          throw new ApiError(400, 'No se puede crear un remito con pedidos de circuitos mixtos');
        }
        if (distinctFiscals.length === 1) {
          derivedFiscalType = distinctFiscals[0] === 'no_fiscal' ? 'no_fiscal' : 'fiscal';
          // Gate: non-Luna user cannot emit a Luna remito even if derived from Luna orders.
          if (derivedFiscalType === 'no_fiscal' && !opts.userCanAccessLuna) {
            throw new ApiError(403, 'Sin acceso al circuito Luna');
          }
          // If the payload explicitly disagrees with the derived value, reject.
          if (data.fiscal_type && data.fiscal_type !== derivedFiscalType) {
            throw new ApiError(400, 'fiscal_type no coincide con los pedidos vinculados');
          }
        }
      } else {
        // Standalone remito: honor payload or default to 'fiscal'.
        derivedFiscalType = data.fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal';
      }

      // 5. Create remito
      const remitoId = uuid();
      const tipo = data.tipo === 'recepcion' ? 'recepcion' : 'entrega';
      await client.query(`
        INSERT INTO remitos (id, company_id, customer_id, enterprise_id, order_id, remito_number, punto_venta,
          date, delivery_address, receiver_name, transport, tipo, notes, status,
          factura_ref, pedido_ref, fiscal_type, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pendiente',$14,$15,$16,$17)
      `, [remitoId, companyId, data.customer_id || null, enterpriseId, data.order_id || null,
        remitoNumber, puntoVenta, data.date || new Date().toISOString(),
        data.delivery_address || null, data.receiver_name || null, data.transport || null,
        tipo, data.notes || null, data.factura_ref || null, data.pedido_ref || null,
        derivedFiscalType, userId]);

      // 6. Create items + update qty_delivered + deduct stock
      // orderIdsSet was already populated above from lockResult (no N+1 query)
      for (const item of validItems) {
        const itemId = uuid();
        const qty = Number(item.quantity);

        // PR7-T11 FIX: for order-linked items, resolve product_id from the order_item
        // BEFORE inserting the remito_item so that:
        //   (a) stock is correctly decremented when the underlying product controls_stock
        //   (b) anularRemito's stock revert (which filters by remito_items.product_id)
        //       picks up the reversal automatically.
        // If the caller passed product_id explicitly, we still verify it matches the order_item.
        let resolvedProductId: string | null = item.product_id || null;
        if (item.order_item_id) {
          const oiRes = await client.query(
            'SELECT product_id FROM order_items WHERE id = $1',
            [item.order_item_id]
          );
          const oiProductId = oiRes.rows[0]?.product_id || null;
          // Prefer the order_item's product_id as source of truth. If caller passed
          // a different product_id, trust the order_item (prevents spoofing).
          resolvedProductId = oiProductId;
        }

        await client.query(`
          INSERT INTO remito_items (id, remito_id, product_id, product_name, description, quantity, unit,
            unit_price, vat_rate, order_item_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [itemId, remitoId, resolvedProductId, item.product_name,
          item.description || null, qty, item.unit || 'unidades',
          item.unit_price || null, item.vat_rate || 21,
          item.order_item_id || null]);

        if (item.order_item_id) {
          // Item from order: update qty_delivered
          await client.query(
            'UPDATE order_items SET qty_delivered = COALESCE(qty_delivered, 0) + $1 WHERE id = $2',
            [qty, item.order_item_id]
          );

          // PR7-T11 FIX: ALSO decrement stock when the order_item's product controls stock.
          // Previously this branch only updated qty_delivered, leaving physical stock
          // untouched — catastrophic for real inventory management.
          if (resolvedProductId) {
            const prodCheck = await client.query(
              'SELECT id, controls_stock FROM products WHERE id = $1 AND company_id = $2',
              [resolvedProductId, companyId]
            );
            if (prodCheck.rows.length === 0) {
              // Product soft-deleted between order creation and remito: log + skip stock.
              // qty_delivered update still applies.
              console.warn(
                `[createRemito] Product ${resolvedProductId} for order_item ${item.order_item_id} ` +
                `not found in company ${companyId} — stock NOT decremented`
              );
            } else {
              const controlsStock = prodCheck.rows[0].controls_stock === true
                || prodCheck.rows[0].controls_stock === 't'
                || prodCheck.rows[0].controls_stock === 'true';

              if (controlsStock) {
                // Default warehouse (consistent with manual branch resolver).
                const whRes = await client.query(
                  'SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1',
                  [companyId]
                );
                const warehouseId = whRes.rows[0]?.id;
                if (!warehouseId) {
                  throw new ApiError(400, 'No hay almacenes configurados. No se puede descontar stock');
                }

                // FOR UPDATE lock to serialize concurrent remitos on the same product.
                const stockRes = await client.query(
                  'SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
                  [resolvedProductId, warehouseId]
                );
                const currentQty = stockRes.rows.length > 0
                  ? parseFloat(stockRes.rows[0].quantity || '0')
                  : 0;

                if (currentQty < qty) {
                  throw new ApiError(
                    400,
                    `Stock insuficiente para "${item.product_name}". Disponible: ${currentQty}, solicitado: ${qty}`
                  );
                }

                await client.query(`
                  INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity,
                    movement_type, reference_type, reference_id, notes, created_by)
                  VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sale', 'remito', $5, $6, $7)
                `, [companyId, resolvedProductId, warehouseId, -qty, remitoId,
                    `Remito item from order_item ${item.order_item_id}`, userId]);

                if (stockRes.rows.length > 0) {
                  // Double-write quantity AND quantity_num (PR7-T17 Phase 3 convention).
                  await client.query(
                    'UPDATE stock SET quantity = COALESCE(quantity, 0) - $1, quantity_num = COALESCE(quantity_num, 0) - $1 WHERE product_id = $2 AND warehouse_id = $3',
                    [qty, resolvedProductId, warehouseId]
                  );
                } else {
                  // Fallback: create stock row (matches manual-branch behavior).
                  await client.query(`
                    INSERT INTO stock (id, company_id, product_id, warehouse_id, quantity, quantity_num)
                    VALUES (gen_random_uuid(), $1, $2, $3, $4, $4)
                  `, [companyId, resolvedProductId, warehouseId, -qty]);
                }
              }
            }
          }
          // If resolvedProductId is null (ad-hoc item in order with no product_id),
          // skip stock logic — only qty_delivered is updated.
        } else if (item.product_id) {
          // Manual item with product: deduct stock if controls_stock
          // BUG #5: validate product EXISTS
          const prodCheck = await client.query(
            'SELECT id, controls_stock FROM products WHERE id = $1 AND company_id = $2',
            [item.product_id, companyId]
          );
          if (prodCheck.rows.length === 0) {
            throw new ApiError(400, `Producto ${item.product_id} no existe o no pertenece a tu compania`);
          }
          // BUG #7: controls_stock can be boolean true/false or string 't'/'f'
          const controlsStock = prodCheck.rows[0].controls_stock === true
            || prodCheck.rows[0].controls_stock === 't'
            || prodCheck.rows[0].controls_stock === 'true';

          if (controlsStock) {
            // Get default warehouse
            const whRes = await client.query(
              'SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1',
              [companyId]
            );
            const warehouseId = whRes.rows[0]?.id;
            if (!warehouseId) {
              throw new ApiError(400, 'No hay almacenes configurados. No se puede descontar stock');
            }

            // BUG #1: lock stock row FOR UPDATE before updating
            const stockRes = await client.query(
              'SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
              [item.product_id, warehouseId]
            );

            // BUG #4: if no stock row exists, create it with 0 (or error if we require existing)
            const currentQty = stockRes.rows.length > 0 ? parseFloat(stockRes.rows[0].quantity || '0') : 0;

            // BUG #2: prevent stock going negative
            if (currentQty < qty) {
              throw new ApiError(400,
                `Stock insuficiente para "${item.product_name}". Disponible: ${currentQty}, solicitado: ${qty}`
              );
            }

            await client.query(`
              INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity,
                movement_type, reference_type, reference_id, notes, created_by)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sale', 'remito', $5, 'Remito item manual', $6)
            `, [companyId, item.product_id, warehouseId, -qty, remitoId, userId]);

            if (stockRes.rows.length > 0) {
              await client.query(
                'UPDATE stock SET quantity = COALESCE(quantity, 0) - $1 WHERE product_id = $2 AND warehouse_id = $3',
                [qty, item.product_id, warehouseId]
              );
            } else {
              // Create stock row with -qty (we already validated currentQty >= qty, so this implies qty=0)
              await client.query(`
                INSERT INTO stock (id, company_id, product_id, warehouse_id, quantity)
                VALUES (gen_random_uuid(), $1, $2, $3, $4)
              `, [companyId, item.product_id, warehouseId, -qty]);
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
        // BUG S4 #4: validate order belongs to same company AND same enterprise as remito
        const orderCheck = await client.query(
          'SELECT id, enterprise_id, status FROM orders WHERE id = $1 AND company_id = $2',
          [data.order_id, companyId]
        );
        if (orderCheck.rows.length === 0) {
          throw new ApiError(400, 'El pedido referenciado no existe o no pertenece a tu compania');
        }
        if (['cancelado', 'cancelled'].includes(orderCheck.rows[0].status)) {
          throw new ApiError(400, 'No se puede vincular un remito a un pedido cancelado');
        }
        if (enterpriseId && orderCheck.rows[0].enterprise_id && orderCheck.rows[0].enterprise_id !== enterpriseId) {
          throw new ApiError(400, 'El pedido referenciado pertenece a otra empresa');
        }
        await client.query(`
          INSERT INTO remito_orders (id, remito_id, order_id) VALUES (gen_random_uuid(), $1, $2)
          ON CONFLICT (remito_id, order_id) DO NOTHING
        `, [remitoId, data.order_id]);
        orderIdsSet.add(data.order_id);
      }

      // 8. Auto-transition order status to 'entregado' when all items are fully delivered
      //    (consolidated list of affected orders from both item-level links and legacy order_id)
      for (const affectedOrderId of orderIdsSet) {
        const allDelivered = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE CAST(oi.quantity AS decimal) > COALESCE(oi.qty_delivered, 0)) as pending_count,
            COUNT(*) as total_count
          FROM order_items oi
          WHERE oi.order_id = $1
        `, [affectedOrderId]);
        const row = allDelivered.rows[0];
        if (row && Number(row.total_count) > 0 && Number(row.pending_count) === 0) {
          // All items delivered → mark order as entregado (but don't overwrite terminal states)
          await client.query(`
            UPDATE orders
            SET status = 'entregado', updated_at = NOW()
            WHERE id = $1
              AND status NOT IN ('entregado', 'cancelado', 'cancelled')
          `, [affectedOrderId]);
        }
      }

      await client.query('COMMIT');

      // Sol/Luna: lock every linked order post-create (idempotent).
      for (const affectedOrderId of orderIdsSet) {
        try {
          await ordersService.lockOrder(affectedOrderId, 'remito emitido', userId);
        } catch (e) {
          console.warn('[createRemito] lockOrder failed for', affectedOrderId, (e as Error).message);
        }
      }

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId,
          module: 'remitos',
          action: 'create',
          entityType: 'remito',
          entityId: remitoId,
          circuit: derivedFiscalType,
          metadata: { remito_number: remitoNumber },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return { id: remitoId, remito_number: remitoNumber, fiscal_type: derivedFiscalType };
    } catch (error) {
      await client.query('ROLLBACK').catch(e => console.error('ROLLBACK failed:', e.message));
      console.error('Create remito error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to create remito: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Remitos son INMUTABLES post-creacion. Una vez creado un remito, los datos
   * quedan congelados como registro fiscal/logistico. Si hay error, se anula
   * y se crea uno nuevo. Lo unico que puede cambiar es el STATUS (workflow)
   * via updateRemitoStatus, o anular via anularRemito.
   */
  async updateRemito(_companyId: string, _remitoId: string, _data: any): Promise<any> {
    throw new ApiError(
      403,
      'Los remitos no se pueden modificar una vez creados. Si hay un error, anula el remito y crea uno nuevo.'
    );
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

      // BUG S10 #10: state machine transitions
      const allowed: Record<string, string[]> = {
        pendiente: ['entregado'],
        entregado: ['firmado'],
        firmado: [],
      };
      const current = rows[0].status || 'pendiente';
      if (current === status) {
        return { id: remitoId, status };
      }
      if (!allowed[current]?.includes(status)) {
        throw new ApiError(400, `Transicion invalida: ${current} → ${status}. Permitidas desde ${current}: [${allowed[current]?.join(', ') || 'ninguna'}]`);
      }

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
    // BUG S8 #7: reject system user (violates FK)
    if (!userId || userId === 'system') {
      throw new ApiError(400, 'userId valido requerido para anular');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // BUG S8 #1: FOR UPDATE to prevent concurrent double-anular
      const result = await client.query(
        'SELECT id, status FROM remitos WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [remitoId, companyId]
      );
      if (result.rows.length === 0) throw new ApiError(404, 'Remito not found');
      if (result.rows[0].status === 'anulado') throw new ApiError(400, 'El remito ya esta anulado');

      // Get all items
      const itemsResult = await client.query(
        'SELECT id, order_item_id, product_id, quantity FROM remito_items WHERE remito_id = $1',
        [remitoId]
      );

      // BUG S8 #3: mark anulado FIRST so recalculate excludes this remito's items
      await client.query(
        `UPDATE remitos SET status = 'anulado', updated_at = NOW() WHERE id = $1`,
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

        // PR7-T11: return stock even if item also has order_item_id (when product_id present).
        // Usa 'sale' (enum stock_movement_type) para matchear el INSERT de create.
        // Revierte con 'return_customer' (entrada de stock porque el cliente "devuelve").
        if (item.product_id) {
          const movRes = await client.query(`
            SELECT warehouse_id FROM stock_movements
            WHERE reference_type = 'remito' AND reference_id = $1 AND product_id = $2
              AND movement_type::text = 'sale'
            ORDER BY created_at DESC LIMIT 1
          `, [remitoId, item.product_id]);
          const originalWarehouseId = movRes.rows[0]?.warehouse_id;

          if (originalWarehouseId) {
            // Lock stock row before update
            await client.query(
              'SELECT quantity FROM stock WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE',
              [item.product_id, originalWarehouseId]
            );
            await client.query(`
              INSERT INTO stock_movements (id, company_id, product_id, warehouse_id, quantity,
                movement_type, reference_type, reference_id, notes, created_by)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 'return_customer', 'anulacion_remito', $5, 'Anulacion remito', $6)
            `, [companyId, item.product_id, originalWarehouseId, qty, remitoId, userId]);
            await client.query(
              'UPDATE stock SET quantity = COALESCE(quantity, 0) + $1, quantity_num = COALESCE(quantity_num, 0) + $1 WHERE product_id = $2 AND warehouse_id = $3',
              [qty, item.product_id, originalWarehouseId]
            );
          } else {
            console.warn(`[anularRemito] No original warehouse found for product ${item.product_id} in remito ${remitoId} — stock NOT returned`);
          }
        }
      }

      // BUG S8 #2: use transactional client for recalculate (inside same TX)
      // BUG S8 #4: exclude anulado remitos from SUM
      const affectedOrderItemIds = Array.from(new Set(
        itemsResult.rows.filter((r: any) => r.order_item_id).map((r: any) => r.order_item_id)
      ));
      for (const oiId of affectedOrderItemIds) {
        await client.query(`
          UPDATE order_items SET qty_delivered = (
            SELECT COALESCE(SUM(ri.quantity), 0)
            FROM remito_items ri
            JOIN remitos r ON ri.remito_id = r.id
            WHERE ri.order_item_id = order_items.id AND r.status != 'anulado'
          ) WHERE id = $1
        `, [oiId]);
      }

      // Revert order status 'entregado' → 'pendiente' if items are no longer fully delivered
      if (affectedOrderItemIds.length > 0) {
        const affectedOrders = await client.query(`
          SELECT DISTINCT order_id FROM order_items WHERE id = ANY($1)
        `, [affectedOrderItemIds]);
        for (const { order_id } of affectedOrders.rows) {
          const check = await client.query(`
            SELECT COUNT(*) FILTER (WHERE CAST(oi.quantity AS decimal) > COALESCE(oi.qty_delivered, 0)) as pending_count
            FROM order_items oi WHERE oi.order_id = $1
          `, [order_id]);
          if (Number(check.rows[0]?.pending_count || 0) > 0) {
            await client.query(`
              UPDATE orders SET status = 'pendiente', updated_at = NOW()
              WHERE id = $1 AND status = 'entregado'
            `, [order_id]);
          }
        }
      }

      // Capture linked order_ids BEFORE deleting remito_orders so we can unlock them.
      const linkedOrdersRes = await client.query(
        `SELECT DISTINCT order_id FROM remito_orders WHERE remito_id = $1`,
        [remitoId]
      );
      const linkedOrderIds: string[] = linkedOrdersRes.rows.map((r: any) => r.order_id).filter(Boolean);

      // PR7-T11: desvincular el remito del pedido borrando las entradas de remito_orders.
      // El remito queda como fila historica (status='anulado') pero no sigue "linkeado" al pedido.
      await client.query(`DELETE FROM remito_orders WHERE remito_id = $1`, [remitoId]);

      await client.query('COMMIT');

      // Sol/Luna: attempt unlock on every previously linked order. unlockOrder's
      // cascade check decides whether the order actually clears.
      for (const orderId of linkedOrderIds) {
        try {
          await ordersService.unlockOrder(orderId);
        } catch (e) {
          console.warn('[anularRemito] unlockOrder failed for', orderId, (e as Error).message);
        }
      }

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId,
          module: 'remitos',
          action: 'anular',
          entityType: 'remito',
          entityId: remitoId,
          circuit: null,
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return { id: remitoId, status: 'anulado' };
    } catch (error) {
      await client.query('ROLLBACK').catch(e => console.error('ROLLBACK failed:', e.message));
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to void remito: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  /** @deprecated Use anularRemito instead. Kept for backward compat. */
  async deleteRemito(companyId: string, remitoId: string, userId?: string) {
    // BUG S8 #7: require real userId (no 'system' fallback)
    if (!userId) throw new ApiError(400, 'userId requerido para anular');
    return this.anularRemito(companyId, remitoId, userId);
  }

  async uploadSignedPdf(companyId: string, remitoId: string, base64Data: string) {
    await this.ensureTables();
    try {
      // HIGH-5: centralized base64 validation (magic bytes + size).
      // C6: 2MB cap because the PDF is stored inline in a TEXT column;
      // migration to external storage is tracked separately.
      validateBase64Upload(String(base64Data || ''), {
        maxSize: 2 * 1024 * 1024,
        allowedMimes: ['application/pdf'],
      });

      const result = await db.execute(sql`
        SELECT id, status FROM remitos WHERE id = ${remitoId} AND company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');
      // BUG S7 #10: reject upload to anulado
      if (rows[0].status === 'anulado') {
        throw new ApiError(400, 'No se puede subir firmado a un remito anulado');
      }

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
    let browser: any = null;
    try {
      const remito = await this.getRemito(companyId, remitoId);

      const companyResult = await db.execute(sql`SELECT * FROM companies WHERE id = ${companyId}`);
      const companyRows = getRows(companyResult);
      if (companyRows.length === 0) throw new ApiError(404, 'Company not found');
      const company = companyRows[0];

      const html = this.buildRemitoHtml(company, remito);

      browser = await puppeteer.launch({
        headless: 'new' as any,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      const page = await browser.newPage();
      // BUG S7 #1/#3: block ALL network requests to prevent SSRF/LFI via injected HTML
      await page.setRequestInterception(true);
      page.on('request', (req: any) => {
        const type = req.resourceType();
        if (type === 'document') return req.continue();
        req.abort();
      });
      // BUG S7 #7: timeout
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
        printBackground: true,
        timeout: 10000,
      });
      return pdf;
    } catch (error) {
      console.error('Generate remito PDF error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate remito PDF');
    } finally {
      // BUG S7 #2: always close browser even on error
      if (browser) {
        try { await browser.close(); } catch (e) { console.error('Browser close failed:', e); }
      }
    }
  }

  /** BUG S7 #1 / HIGH-4: delegate to shared helper in src/lib/html-escape.ts */
  private escapeHtml(value: any): string {
    return sharedEscapeHtml(value);
  }

  private buildRemitoHtml(company: any, remito: any, tipo?: string): string {
    const esc = (v: any) => this.escapeHtml(v);
    const items = remito.items || [];
    const enterprise = remito.enterprise || {};
    const customer = remito.customer || {};
    // BUG S7 #6: validate date, fallback to today if invalid
    const rawDate = new Date(remito.date || remito.created_at || Date.now());
    const fecha = isNaN(rawDate.getTime())
      ? new Date().toLocaleDateString('es-AR')
      : rawDate.toLocaleDateString('es-AR');
    const pv = String(remito.punto_venta || company.punto_venta_remito || company.punto_venta || 1).padStart(4, '0');
    const num = String(remito.remito_number || 0).padStart(8, '0');
    const remitoTipo = tipo || remito.tipo || 'entrega';
    const isRecepcion = remitoTipo === 'recepcion';

    // Receptor data: prefer enterprise, fallback to customer (raw, escaped at interpolation site)
    const receptor = {
      name: esc(enterprise.razon_social || enterprise.name || customer.name || ''),
      address: esc(remito.delivery_address || enterprise.address || customer.address || ''),
      city: esc(enterprise.city || ''),
      province: esc(enterprise.province || ''),
      cp: esc(enterprise.postal_code || ''),
      cuit: esc(enterprise.cuit || customer.cuit || ''),
      iva: esc(enterprise.tax_condition || ''),
    };
    const domicilio = [receptor.address, receptor.city, receptor.cp ? `(${receptor.cp})` : ''].filter(Boolean).join(', ');

    // Cross-references (escaped)
    const facturaRef = esc(remito.factura_ref || '');
    const pedidoRef = esc(remito.pedido_ref || (remito.order ? `${pv}-${String(remito.order.order_number || 0).padStart(8, '0')}` : ''));

    // Item rows — escape all user text
    const itemRows = items.map((item: any) => `
      <tr>
        <td class="qty">${Number(item.quantity) || 0}</td>
        <td class="desc">${Number(item.quantity) || 0}x ${esc(item.product_name)}${item.description ? '  ' + esc(item.description) : ''}</td>
      </tr>
    `).join('');

    // Empty rows to fill the page
    const emptyRows = Math.max(0, 15 - items.length);
    const emptyRowsHtml = Array(emptyRows).fill('<tr><td class="qty">&nbsp;</td><td class="desc">&nbsp;</td></tr>').join('');

    // Company config (escaped - defense in depth even for trusted fields)
    const companyName = esc(company.razon_social || company.name || '');
    const companyRubro = esc(company.rubro_descripcion || '');
    const companyAddress = esc([company.address, company.city ? `(${company.postal_code || ''}) ${company.city}` : ''].filter(Boolean).join(' - '));
    const companyProvince = company.province ? `Prov. de ${esc(company.province)} - Argentina` : '';
    const companyPhone = company.phone ? `Tel.: ${esc(company.phone)}` : '';
    const companyEmail = esc(company.email || '');
    const companyWeb = esc(company.website || '');
    const companyIva = esc(company.condicion_iva || company.tax_condition || 'IVA RESPONSABLE INSCRIPTO');
    const companyCuit = esc(company.cuit || '');
    const companyIIBB = esc(company.ingresos_brutos || '');
    const companyInicio = company.inicio_actividad ? new Date(company.inicio_actividad).toLocaleDateString('es-AR') : '';
    const caiRemito = esc(company.cai_remito || '');
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
      WHERE o.company_id = $1 AND o.id = $2 AND o.status NOT IN ('cancelado', 'cancelled')
        AND oi.quantity - COALESCE(oi.qty_delivered, 0) > 0
      ORDER BY oi.created_at ASC
    `, [companyId, orderId]);
    return r.rows;
  }

  /** Items de TODOS los pedidos de una empresa que se pueden remitar */
  async getAvailableOrderItemsForRemitoByEnterprise(companyId: string, enterpriseId: string) {
    await this.ensureTables();
    // BUG S4 #3: validate enterprise belongs to company (IDOR fix)
    const entCheck = await pool.query(
      'SELECT id FROM enterprises WHERE id = $1 AND company_id = $2',
      [enterpriseId, companyId]
    );
    if (entCheck.rows.length === 0) {
      throw new ApiError(404, 'Empresa no encontrada o no pertenece a tu compania');
    }
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
      WHERE o.company_id = $1 AND o.enterprise_id = $2 AND o.status NOT IN ('cancelado', 'cancelled')
        AND oi.quantity - COALESCE(oi.qty_delivered, 0) > 0
      ORDER BY o.order_number ASC, oi.created_at ASC
    `, [companyId, enterpriseId]);
    return r.rows;
  }

  /** Items de una factura resueltos a order_items para crear remito desde factura */
  async getInvoiceItemsForRemito(companyId: string, invoiceId: string) {
    await this.ensureTables();
    // BUG S5 #10: validate UUID format before query (prevents error leak)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
      throw new ApiError(400, 'Invoice ID invalido');
    }
    // BUG S5 #4: validate invoice exists in company (404 instead of empty)
    // BUG S5 #1/#2: reject cancelled (ES+EN) and non-authorized invoices
    const invCheck = await pool.query(
      `SELECT id, status FROM invoices WHERE id = $1 AND company_id = $2`,
      [invoiceId, companyId]
    );
    if (invCheck.rows.length === 0) {
      throw new ApiError(404, 'Factura no encontrada o no pertenece a tu compania');
    }
    const status = invCheck.rows[0].status;
    if (['cancelled', 'cancelado'].includes(status)) {
      throw new ApiError(400, 'No se puede generar un remito desde una factura cancelada');
    }
    if (['draft', 'borrador'].includes(status)) {
      throw new ApiError(400, 'No se puede generar un remito desde una factura en borrador. Autorizala primero.');
    }

    const r = await pool.query(`
      SELECT ii.id as invoice_item_id, ii.product_id, ii.product_name,
        ii.quantity as invoice_qty, CAST(ii.unit_price AS text) as unit_price,
        COALESCE(ii.vat_rate, 21) as vat_rate,
        ii.order_item_id,
        i.enterprise_id,
        CASE WHEN ii.order_item_id IS NOT NULL THEN
          LEAST(ii.quantity, GREATEST(oi.quantity - COALESCE(oi.qty_delivered, 0), 0))
        ELSE ii.quantity END as qty_available,
        CASE WHEN ii.order_item_id IS NOT NULL THEN
          'Pedido #' || LPAD(o.order_number::text, 4, '0')
        ELSE 'Manual' END as source_ref,
        o.id as order_id
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      LEFT JOIN order_items oi ON ii.order_item_id = oi.id AND oi.order_id IN (SELECT id FROM orders WHERE company_id = i.company_id)
      LEFT JOIN orders o ON oi.order_id = o.id AND o.company_id = i.company_id
      WHERE i.company_id = $1 AND i.id = $2
        AND i.status != 'cancelled'
      ORDER BY ii.created_at ASC
    `, [companyId, invoiceId]);
    return r.rows.filter((row: any) => parseFloat(row.qty_available || '0') > 0);
  }

  /** Datos de contexto de un remito (items status) */
  async getRemitoContextData(companyId: string, remitoId: string) {
    await this.ensureTables();

    // BUG S6 #1: validate remito belongs to company (IDOR fix)
    const ownership = await pool.query(
      'SELECT id FROM remitos WHERE id = $1 AND company_id = $2',
      [remitoId, companyId]
    );
    if (ownership.rows.length === 0) {
      throw new ApiError(404, 'Remito no encontrado');
    }

    // BUG S6 #9: stable ordering via created_at then id
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
      ORDER BY ri.created_at ASC, ri.id ASC
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
