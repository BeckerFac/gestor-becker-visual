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
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS invoice_item_id UUID`).catch(() => {});
      await pool.query(`ALTER TABLE remito_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`).catch(() => {});

      // Indices for linking columns
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_remito_items_order_item ON remito_items(order_item_id) WHERE order_item_id IS NOT NULL`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_remito_items_invoice_item ON remito_items(invoice_item_id) WHERE invoice_item_id IS NOT NULL`).catch(() => {});

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

      // Migration: invoice_remitos (N:N invoice ↔ remitos)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS invoice_remitos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          remito_id UUID NOT NULL REFERENCES remitos(id) ON DELETE CASCADE,
          UNIQUE(invoice_id, remito_id)
        )
      `).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_remitos_invoice ON invoice_remitos(invoice_id)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_remitos_remito ON invoice_remitos(remito_id)`).catch(() => {});

      // Migration: remito_item_id in invoice_items (link factura item → remito item)
      await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS remito_item_id UUID`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_remito_item ON invoice_items(remito_item_id) WHERE remito_item_id IS NOT NULL`).catch(() => {});

      // Migration: qty_delivered in order_items (denormalized delivery tracking)
      await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_delivered DECIMAL(12,2) DEFAULT 0`).catch(() => {});

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

      const itemsResult = await db.execute(sql`
        SELECT * FROM remito_items WHERE remito_id = ${remitoId} ORDER BY id ASC
      `);
      const items = getRows(itemsResult);

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get remito');
    }
  }

  async createRemito(companyId: string, userId: string, data: any) {
    await this.ensureTables();
    try {
      const remitoId = uuid();

      const numResult = await db.execute(sql`
        SELECT COALESCE(MAX(remito_number), 0) + 1 as next_number FROM remitos WHERE company_id = ${companyId}
      `);
      const numRows = getRows(numResult);
      const remitoNumber = parseInt(numRows[0]?.next_number || '1');

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = getRows(custResult);
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      const tipo = data.tipo === 'recepcion' ? 'recepcion' : 'entrega';
      await db.execute(sql`
        INSERT INTO remitos (id, company_id, customer_id, enterprise_id, order_id, remito_number, date, delivery_address, receiver_name, transport, tipo, notes, status, created_by)
        VALUES (${remitoId}, ${companyId}, ${data.customer_id || null}, ${enterpriseId}, ${data.order_id || null}, ${remitoNumber}, ${data.date || new Date().toISOString()}, ${data.delivery_address || null}, ${data.receiver_name || null}, ${data.transport || null}, ${tipo}, ${data.notes || null}, 'pendiente', ${userId})
      `);

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const itemId = uuid();
          await db.execute(sql`
            INSERT INTO remito_items (id, remito_id, product_name, description, quantity, unit)
            VALUES (${itemId}, ${remitoId}, ${item.product_name}, ${item.description || null}, ${item.quantity || 1}, ${item.unit || 'unidades'})
          `);
        }
      }

      return { id: remitoId, remito_number: remitoNumber };
    } catch (error) {
      console.error('Create remito error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create remito');
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
        SELECT id FROM remitos WHERE id = ${remitoId} AND company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');

      await db.execute(sql`
        UPDATE remitos SET status = ${status}, updated_at = NOW() WHERE id = ${remitoId}
      `);

      return { id: remitoId, status };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update remito status');
    }
  }

  async deleteRemito(companyId: string, remitoId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT id FROM remitos WHERE id = ${remitoId} AND company_id = ${companyId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');

      await db.execute(sql`DELETE FROM remito_items WHERE remito_id = ${remitoId}`);
      await db.execute(sql`DELETE FROM remitos WHERE id = ${remitoId}`);

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete remito');
    }
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
    const customer = remito.customer || {};
    const createdAt = new Date(remito.date || remito.created_at).toLocaleDateString('es-AR');
    const remitoNum = String(remito.remito_number || '').padStart(6, '0');
    const pvNum = String(company.punto_venta || 3).padStart(5, '0');

    const itemRows = items.map((item: any, idx: number) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center;">${idx + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#111827;">${item.product_name}</strong>
          ${item.description ? `<br><span style="color:#6b7280;font-size:12px;">${item.description}</span>` : ''}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;font-weight:600;">${Number(item.quantity)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">${item.unit || 'unidades'}</td>
      </tr>
    `).join('');

    const remitoTipo = tipo || remito.tipo || 'entrega';
    const isRecepcion = remitoTipo === 'recepcion';
    const orderRef = remito.order ? `Pedido #${String(remito.order.order_number || '').padStart(4, '0')} — ${remito.order.title || ''}` : '';

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; color:#333; line-height:1.5; font-size:13px; }
  @page { margin: 0; }
</style></head>
<body>

  <!-- HEADER with R badge -->
  <div style="position:relative;padding:20px 40px 16px;border-bottom:2px solid #1a1a2e;display:flex;justify-content:space-between;align-items:flex-start;">
    <!-- Left: Company info -->
    <div style="flex:1;padding-right:50px;">
      <div style="font-size:22px;font-weight:700;color:#1a1a2e;letter-spacing:1px;">BECKER<span style="color:#c8102e;">VISUAL</span></div>
      <div style="font-size:11px;color:#666;margin-top:4px;">${company.name}</div>
      ${company.address ? `<div style="font-size:11px;color:#666;">${company.address}${company.city ? `, ${company.city}` : ''}${company.province ? ` - ${company.province}` : ''}</div>` : ''}
      <div style="font-size:11px;color:#666;">CUIT: ${company.cuit}</div>
      ${company.iva_condition ? `<div style="font-size:11px;color:#666;">${company.iva_condition}</div>` : ''}
    </div>
    <!-- Letter badge R -->
    <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:60px;height:70px;background:white;border:2px solid #333;text-align:center;z-index:10;">
      <div style="font-size:28px;font-weight:bold;margin-top:8px;">R</div>
      <div style="font-size:9px;color:#666;border-top:1px solid #333;padding-top:2px;">COD. 91</div>
    </div>
    <!-- Right: Remito number and date -->
    <div style="flex:1;text-align:right;padding-left:50px;">
      <div style="font-size:16px;font-weight:700;color:#1a1a2e;letter-spacing:0.5px;">REMITO</div>
      <div style="font-size:18px;font-weight:700;color:#1a1a2e;margin-top:2px;">${pvNum}-${String(remito.remito_number || '').padStart(8, '0')}</div>
      <div style="font-size:12px;color:#666;margin-top:4px;"><strong>Fecha:</strong> ${createdAt}</div>
    </div>
  </div>

  <!-- DOCUMENT TYPE BANNER -->
  <div style="background:${isRecepcion ? '#065f46' : '#1a1a2e'};padding:12px 40px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:18px;font-weight:700;color:white;letter-spacing:1px;">${isRecepcion ? 'REMITO DE RECEPCION' : 'REMITO DE ENTREGA'}</div>
    <div style="color:rgba(255,255,255,0.8);font-size:13px;"><strong>Fecha:</strong> ${createdAt}</div>
  </div>

  <!-- EMISOR + DESTINATARIO -->
  <div style="padding:20px 40px;display:flex;gap:24px;">
    <div style="flex:1;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#999;margin-bottom:6px;font-weight:600;">Remitente</div>
      <div style="font-size:15px;font-weight:600;color:#1a1a2e;">${company.name}</div>
      <div style="font-size:12px;color:#666;margin-top:2px;">CUIT: ${company.cuit}</div>
      ${company.address ? `<div style="font-size:12px;color:#666;">${company.address}${company.city ? `, ${company.city}` : ''}${company.province ? ` - ${company.province}` : ''}</div>` : ''}
      ${company.phone ? `<div style="font-size:12px;color:#666;">Tel: ${company.phone}</div>` : ''}
      ${company.email ? `<div style="font-size:12px;color:#666;">${company.email}</div>` : ''}
    </div>
    <div style="flex:1;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#999;margin-bottom:6px;font-weight:600;">Destinatario</div>
      <div style="font-size:15px;font-weight:600;color:#1a1a2e;">${customer.name || 'Sin especificar'}</div>
      ${customer.cuit ? `<div style="font-size:12px;color:#666;margin-top:2px;">CUIT: ${customer.cuit}</div>` : ''}
      ${customer.address ? `<div style="font-size:12px;color:#666;">${customer.address}</div>` : ''}
      ${customer.email ? `<div style="font-size:12px;color:#666;">${customer.email}</div>` : ''}
      ${customer.phone ? `<div style="font-size:12px;color:#666;">Tel: ${customer.phone}</div>` : ''}
    </div>
  </div>

  <!-- DELIVERY INFO -->
  <div style="padding:0 40px 16px;">
    <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:12px 16px;">
      <div style="display:flex;gap:32px;flex-wrap:wrap;">
        ${remito.delivery_address ? `<div><span style="font-size:11px;color:#6366f1;font-weight:600;text-transform:uppercase;">Dirección de Entrega:</span><br><span style="font-size:13px;color:#1e1b4b;">${remito.delivery_address}</span></div>` : ''}
        ${remito.receiver_name ? `<div><span style="font-size:11px;color:#6366f1;font-weight:600;text-transform:uppercase;">Receptor:</span><br><span style="font-size:13px;color:#1e1b4b;">${remito.receiver_name}</span></div>` : ''}
        ${remito.transport ? `<div><span style="font-size:11px;color:#6366f1;font-weight:600;text-transform:uppercase;">Transporte:</span><br><span style="font-size:13px;color:#1e1b4b;">${remito.transport}</span></div>` : ''}
        ${orderRef ? `<div><span style="font-size:11px;color:#6366f1;font-weight:600;text-transform:uppercase;">Referencia:</span><br><span style="font-size:13px;color:#1e1b4b;">${orderRef}</span></div>` : ''}
      </div>
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <div style="padding:0 40px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#1a1a2e;color:white;">
          <th style="padding:10px 12px;text-align:center;font-weight:600;width:40px;font-size:12px;">#</th>
          <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:12px;">Descripción</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;width:80px;font-size:12px;">Cantidad</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;width:100px;font-size:12px;">Unidad</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  ${remito.notes ? `
  <div style="padding:16px 40px;">
    <div style="background:#fef9e7;border-left:4px solid #f0c040;padding:10px 14px;">
      <div style="font-size:11px;font-weight:600;color:#8a6d00;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px;">Observaciones</div>
      <div style="font-size:12px;color:#5a4800;">${remito.notes}</div>
    </div>
  </div>` : ''}

  ${isRecepcion ? `
  <!-- SELLO RECEPCIÓN PROPIA — sin firma -->
  <div style="padding:24px 40px;">
    <div style="border:3px solid #065f46;border-radius:8px;padding:28px 32px;text-align:center;background:#ecfdf5;">
      <div style="font-size:28px;font-weight:800;color:#065f46;letter-spacing:1px;margin-bottom:4px;">&#10003; PRODUCTOS RECIBIDOS</div>
      <div style="font-size:14px;color:#047857;font-weight:500;">Mercadería recibida en conformidad — ${createdAt}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:8px;">${company.name} — CUIT: ${company.cuit}</div>
    </div>
  </div>
  ` : `
  <!-- SELLO ENTREGA AL CLIENTE — con firma -->
  <div style="padding:24px 40px;">
    <div style="border:3px solid #1a1a2e;border-radius:8px;padding:24px;position:relative;">
      <div style="position:absolute;top:-14px;left:24px;background:white;padding:0 12px;">
        <span style="font-size:16px;font-weight:700;color:#059669;letter-spacing:0.5px;">&#10003; PRODUCTOS RECIBIDOS EN CONFORMIDAD</span>
      </div>
      <div style="margin-top:12px;display:flex;gap:24px;">
        <div style="flex:1;">
          <div style="border-bottom:1px solid #ccc;padding:8px 0;margin-bottom:12px;">
            <span style="font-size:11px;color:#666;font-weight:500;">Firma:</span>
          </div>
          <div style="border-bottom:1px solid #ccc;padding:8px 0;">
            <span style="font-size:11px;color:#666;font-weight:500;">Aclaración:</span>
          </div>
        </div>
        <div style="flex:1;">
          <div style="border-bottom:1px solid #ccc;padding:8px 0;margin-bottom:12px;">
            <span style="font-size:11px;color:#666;font-weight:500;">DNI:</span>
          </div>
          <div style="border-bottom:1px solid #ccc;padding:8px 0;">
            <span style="font-size:11px;color:#666;font-weight:500;">Fecha de Recepción:</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  `}

  <!-- FOOTER -->
  <div style="position:fixed;bottom:0;left:0;right:0;border-top:3px solid #c8102e;padding:12px 40px;background:white;">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#999;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:700;color:#1a1a2e;font-size:12px;">BECKER<span style="color:#c8102e;">VISUAL</span></span>
        <span style="color:#666;">${company.name} — Remito N° ${remitoNum}</span>
      </div>
      <div>Documento no válido como factura</div>
      <div>Generado el ${new Date().toLocaleDateString('es-AR')}</div>
    </div>
  </div>

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

  /** Items de una factura que todavia no fueron remitados */
  async getAvailableInvoiceItemsForRemito(companyId: string, invoiceId: string) {
    await this.ensureTables();
    const r = await pool.query(`
      SELECT
        ii.id as invoice_item_id, ii.product_id, ii.product_name,
        ii.quantity, CAST(ii.unit_price AS text) as unit_price, COALESCE(ii.vat_rate, 21) as vat_rate,
        ii.order_item_id,
        i.invoice_type, i.invoice_number, i.enterprise_id,
        e.name as enterprise_name,
        COALESCE(SUM(ri.quantity), 0) as qty_delivered,
        ii.quantity - COALESCE(SUM(ri.quantity), 0) as qty_available
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      LEFT JOIN remito_items ri ON ri.invoice_item_id = ii.id
        AND ri.remito_id IN (SELECT id FROM remitos WHERE company_id = $1)
      WHERE i.company_id = $1 AND i.id = $2 AND i.status != 'cancelled'
      GROUP BY ii.id, ii.product_id, ii.product_name, ii.quantity, ii.unit_price, ii.vat_rate,
        ii.order_item_id, i.invoice_type, i.invoice_number, i.enterprise_id, e.name
      HAVING ii.quantity - COALESCE(SUM(ri.quantity), 0) > 0
      ORDER BY ii.created_at ASC
    `, [companyId, invoiceId]);
    return r.rows;
  }

  /** Facturas de una empresa que tienen items sin remitar */
  async getInvoicesWithPendingDelivery(companyId: string, enterpriseId: string) {
    await this.ensureTables();
    const r = await pool.query(`
      SELECT i.id, i.invoice_type, i.invoice_number, CAST(i.total_amount AS text) as total_amount,
        i.status, i.invoice_date,
        COALESCE((
          SELECT json_agg(json_build_object(
            'invoice_item_id', ii.id,
            'product_name', ii.product_name,
            'quantity', ii.quantity,
            'unit_price', CAST(ii.unit_price AS text),
            'vat_rate', COALESCE(ii.vat_rate, 21),
            'order_item_id', ii.order_item_id,
            'qty_delivered', COALESCE((
              SELECT SUM(ri.quantity) FROM remito_items ri WHERE ri.invoice_item_id = ii.id
            ), 0),
            'qty_available', ii.quantity - COALESCE((
              SELECT SUM(ri.quantity) FROM remito_items ri WHERE ri.invoice_item_id = ii.id
            ), 0)
          ))
          FROM invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.quantity - COALESCE((
              SELECT SUM(ri.quantity) FROM remito_items ri WHERE ri.invoice_item_id = ii.id
            ), 0) > 0
        ), '[]'::json) as items
      FROM invoices i
      WHERE i.company_id = $1 AND i.enterprise_id = $2 AND i.status != 'cancelled'
      ORDER BY i.invoice_date ASC
    `, [companyId, enterpriseId]);
    // Filter out invoices with no available items
    return r.rows.filter((inv: any) => {
      const items = inv.items;
      return Array.isArray(items) && items.length > 0;
    });
  }

  /** Datos de contexto de un remito (facturas vinculadas + status items) */
  async getRemitoContextData(companyId: string, remitoId: string) {
    await this.ensureTables();
    // Facturas vinculadas
    const invoicesRes = await pool.query(`
      SELECT i.id, i.invoice_number, i.invoice_type, CAST(i.total_amount AS text) as total_amount, i.status
      FROM invoices i
      JOIN invoice_remitos ir ON ir.invoice_id = i.id
      WHERE ir.remito_id = $1 AND i.company_id = $2
      ORDER BY i.created_at DESC
    `, [remitoId, companyId]);

    // Items con status de facturacion
    const itemsRes = await pool.query(`
      SELECT ri.id, ri.product_name, ri.quantity, ri.order_item_id, ri.invoice_item_id,
        COALESCE(SUM(ii.quantity), 0) as qty_invoiced,
        ri.quantity - COALESCE(SUM(ii.quantity), 0) as qty_pending,
        CASE
          WHEN ri.order_item_id IS NOT NULL THEN (
            SELECT 'Pedido #' || LPAD(o.order_number::text, 4, '0')
            FROM order_items oi JOIN orders o ON oi.order_id = o.id
            WHERE oi.id = ri.order_item_id
          )
          WHEN ri.invoice_item_id IS NOT NULL THEN 'Factura'
          ELSE 'Manual'
        END as source_ref
      FROM remito_items ri
      LEFT JOIN invoice_items ii ON ii.remito_item_id = ri.id
        AND ii.invoice_id IN (SELECT id FROM invoices WHERE status != 'cancelled' AND company_id = $2)
      WHERE ri.remito_id = $1
      GROUP BY ri.id, ri.product_name, ri.quantity, ri.order_item_id, ri.invoice_item_id
      ORDER BY ri.id
    `, [remitoId, companyId]);

    return {
      invoices: invoicesRes.rows,
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
