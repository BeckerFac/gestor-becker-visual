import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import puppeteer from 'puppeteer';

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
      const rows = (result as any).rows || result || [];
      return { items: rows, total: rows.length };
    } catch (error) {
      console.error('Get remitos error:', error);
      throw new ApiError(500, 'Failed to get remitos');
    }
  }

  async getRemito(companyId: string, remitoId: string) {
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
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Remito not found');

      const itemsResult = await db.execute(sql`
        SELECT * FROM remito_items WHERE remito_id = ${remitoId} ORDER BY id ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

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
      const numRows = (numResult as any).rows || numResult || [];
      const remitoNumber = parseInt(numRows[0]?.next_number || '1');

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = (custResult as any).rows || custResult || [];
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
      const rows = (result as any).rows || result || [];
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
      const rows = (result as any).rows || result || [];
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
      const rows = (result as any).rows || result || [];
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
      const rows = (result as any).rows || result || [];
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
      const companyRows = (companyResult as any).rows || companyResult || [];
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
}

export const remitosService = new RemitosService();
