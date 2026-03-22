import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { crmSyncService } from '../crm/crm-sync.service';

export class QuotesService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`).catch(e => console.warn('Migration:', e.message));
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_number INTEGER DEFAULT 0`).catch(e => console.warn('Migration:', e.message));
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS custom_company_name TEXT`).catch(e => console.warn('Migration:', e.message));
      // Fix existing quotes with quote_number = 0 or NULL - assign sequential numbers by company
      await db.execute(sql`
        WITH numbered AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at) as rn
          FROM quotes
          WHERE quote_number IS NULL OR quote_number = 0
        )
        UPDATE quotes SET quote_number = numbered.rn
        FROM numbered WHERE quotes.id = numbered.id
      `).catch(e => console.warn('Migration fix quote_numbers:', e.message));
      this.migrationsRun = true;
    } catch (error) {
      console.error('Quotes migrations error:', error);
    }
  }

  async getQuotes(companyId: string, filters: {
    enterprise_id?: string;
    status?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  } = {}) {
    await this.ensureMigrations();
    try {
      const { enterprise_id, status, search, date_from, date_to } = filters;
      const skip = Math.max(0, Number(filters.skip) || 0);
      const limit = Math.max(1, Math.min(Number(filters.limit) || 50, 100));

      let whereClause = sql`q.company_id = ${companyId}`;
      if (enterprise_id) {
        whereClause = sql`${whereClause} AND (q.enterprise_id = ${enterprise_id} OR c.enterprise_id = ${enterprise_id})`;
      }
      if (status) {
        whereClause = sql`${whereClause} AND q.status = ${status}`;
      }
      if (search) {
        whereClause = sql`${whereClause} AND (c.name ILIKE ${'%' + search + '%'} OR q.title ILIKE ${'%' + search + '%'} OR CAST(q.quote_number AS TEXT) ILIKE ${'%' + search + '%'})`;
      }
      if (date_from) {
        whereClause = sql`${whereClause} AND q.created_at >= ${date_from}`;
      }
      if (date_to) {
        whereClause = sql`${whereClause} AND q.created_at <= ${date_to + 'T23:59:59'}`;
      }

      const result = await db.execute(sql`
        SELECT q.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN eq.id IS NOT NULL THEN json_build_object('id', eq.id, 'name', eq.name)
          ELSE CASE WHEN c.enterprise_id IS NOT NULL THEN (SELECT json_build_object('id', e2.id, 'name', e2.name) FROM enterprises e2 WHERE e2.id = c.enterprise_id) ELSE NULL END
          END as enterprise,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=COALESCE(eq.id, c.enterprise_id) AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM quotes q
        LEFT JOIN customers c ON q.customer_id = c.id
        LEFT JOIN enterprises eq ON q.enterprise_id = eq.id
        WHERE ${whereClause}
        ORDER BY q.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);
      const rows = (result as any).rows || result || [];

      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int as total
        FROM quotes q
        LEFT JOIN customers c ON q.customer_id = c.id
        WHERE ${whereClause}
      `);
      const total = ((countResult as any).rows || [])[0]?.total || 0;

      return { items: rows, total };
    } catch (error) {
      console.error('Get quotes error:', error);
      throw new ApiError(500, 'Failed to get quotes');
    }
  }

  async getQuote(companyId: string, quoteId: string) {
    try {
      const result = await db.execute(sql`
        SELECT q.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit, 'email', c.email, 'phone', c.phone, 'address', c.address) as customer
        FROM quotes q
        LEFT JOIN customers c ON q.customer_id = c.id
        WHERE q.company_id = ${companyId} AND q.id = ${quoteId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Quote not found');

      const itemsResult = await db.execute(sql`
        SELECT * FROM quote_items WHERE quote_id = ${quoteId} ORDER BY created_at ASC
      `);
      const items = (itemsResult as any).rows || itemsResult || [];

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get quote');
    }
  }

  async updateQuoteStatus(companyId: string, quoteId: string, newStatus: string) {
    try {
      const validStatuses = ['draft', 'sent', 'accepted', 'rejected'];
      if (!validStatuses.includes(newStatus)) {
        throw new ApiError(400, 'Invalid status');
      }

      // Verify quote belongs to company
      const result = await db.execute(sql`
        SELECT id, status FROM quotes WHERE id = ${quoteId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Quote not found');

      await db.execute(sql`
        UPDATE quotes SET status = ${newStatus}, updated_at = NOW() WHERE id = ${quoteId}
      `);

      let order = null;
      if (newStatus === 'accepted') {
        order = await this.convertQuoteToOrder(companyId, quoteId);
      } else if (newStatus === 'rejected') {
        // Delete any order created from this quote
        const orderResult = await db.execute(sql`
          SELECT id FROM orders WHERE quote_id = ${quoteId} AND company_id = ${companyId}
        `);
        const orderRows = (orderResult as any).rows || orderResult || [];
        if (orderRows.length > 0) {
          const orderId = orderRows[0].id;
          await db.execute(sql`DELETE FROM order_status_history WHERE order_id = ${orderId}`);
          await db.execute(sql`DELETE FROM order_items WHERE order_id = ${orderId}`);
          await db.execute(sql`UPDATE cheques SET order_id = NULL WHERE order_id = ${orderId}`);
          await db.execute(sql`DELETE FROM orders WHERE id = ${orderId}`);
        }
      }

      // CRM Pipeline sync: quote status changes
      try {
        if (newStatus === 'accepted') {
          // Resolve enterprise_id for the quote
          const quoteData = await db.execute(sql`SELECT enterprise_id, customer_id, total_amount, quote_number FROM quotes WHERE id = ${quoteId}`);
          const qd = ((quoteData as any).rows || [])[0];
          if (qd) {
            await crmSyncService.handleEvent({
              companyId,
              event: 'quote_accepted',
              enterpriseId: qd.enterprise_id || undefined,
              customerId: qd.customer_id || undefined,
              documentId: quoteId,
              documentType: 'quote',
              metadata: { title: `Cotizacion #${qd.quote_number || ''}`, amount: parseFloat(qd.total_amount || '0') },
            });
          }
        } else if (newStatus === 'rejected') {
          const quoteData = await db.execute(sql`SELECT enterprise_id, customer_id, quote_number FROM quotes WHERE id = ${quoteId}`);
          const qd = ((quoteData as any).rows || [])[0];
          if (qd) {
            await crmSyncService.handleEvent({
              companyId,
              event: 'quote_rejected',
              enterpriseId: qd.enterprise_id || undefined,
              customerId: qd.customer_id || undefined,
              documentId: quoteId,
              documentType: 'quote',
            });
          }
        }
      } catch (e) { console.error('CRM sync error (quote_status):', e); }

      return { quote_id: quoteId, status: newStatus, order };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update quote status');
    }
  }

  private async convertQuoteToOrder(companyId: string, quoteId: string) {
    const quote = await this.getQuote(companyId, quoteId);
    const items = quote.items || [];

    // Generate order_number
    const numResult = await db.execute(sql`
      SELECT COALESCE(MAX(order_number), 0) + 1 as next_number FROM orders WHERE company_id = ${companyId}
    `);
    const numRows = (numResult as any).rows || numResult || [];
    const orderNumber = parseInt(numRows[0]?.next_number || '1');

    const orderId = uuid();
    const totalAmount = parseFloat(quote.total_amount || '0');

    // Resolve enterprise_id
    let enterpriseId = quote.enterprise_id || null;
    if (!enterpriseId && quote.customer_id) {
      const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${quote.customer_id}`);
      const custRows = (custResult as any).rows || custResult || [];
      if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
    }

    await db.execute(sql`
      INSERT INTO orders (id, company_id, customer_id, enterprise_id, order_number, title, status, priority, quantity, unit_price, total_amount, vat_rate, payment_status, quote_id, notes, created_by)
      VALUES (${orderId}, ${companyId}, ${quote.customer_id || null}, ${enterpriseId}, ${orderNumber}, ${quote.title || 'Pedido desde cotización'}, 'pendiente', 'normal', ${1}, ${totalAmount.toString()}, ${totalAmount.toString()}, ${'21'}, 'pendiente', ${quoteId}, ${quote.notes || null}, ${quote.created_by || null})
    `);

    // Copy items
    for (const item of items) {
      await db.execute(sql`
        INSERT INTO order_items (id, order_id, product_id, product_name, description, quantity, unit_price, cost, subtotal)
        VALUES (${uuid()}, ${orderId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity}, ${item.unit_price?.toString() || '0'}, ${'0'}, ${item.subtotal?.toString() || '0'})
      `);
    }

    // Record initial status
    await db.execute(sql`
      INSERT INTO order_status_history (id, order_id, new_status, notes, changed_by)
      VALUES (${uuid()}, ${orderId}, 'pendiente', ${'Creado desde cotización #' + (quote.quote_number || '')}, ${quote.created_by || null})
    `);

    return { id: orderId, order_number: orderNumber };
  }

  async createQuote(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const quoteId = uuid();

      let subtotal = 0;
      let vatAmount = 0;

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const itemSub = Number(item.unit_price) * Number(item.quantity);
          const itemVat = itemSub * (Number(item.vat_rate || 21) / 100);
          subtotal += itemSub;
          vatAmount += itemVat;
        }
      }

      const totalAmount = subtotal + vatAmount;

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = (custResult as any).rows || custResult || [];
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      // Generate quote_number atomically using subquery to prevent race conditions
      await db.execute(sql`
        INSERT INTO quotes (id, company_id, customer_id, enterprise_id, quote_number, title, valid_until, subtotal, vat_amount, total_amount, status, notes, custom_company_name, created_by)
        VALUES (${quoteId}, ${companyId}, ${data.customer_id || null}, ${enterpriseId}, (SELECT COALESCE(MAX(quote_number), 0) + 1 FROM quotes WHERE company_id = ${companyId}), ${data.title || 'Cotización'}, ${data.valid_until || null}, ${subtotal.toString()}, ${vatAmount.toString()}, ${totalAmount.toString()}, 'draft', ${data.notes || null}, ${data.custom_company_name || null}, ${userId})
      `);

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const itemSubtotal = Number(item.unit_price) * Number(item.quantity);
          await db.execute(sql`
            INSERT INTO quote_items (id, quote_id, product_id, product_name, description, quantity, unit_price, vat_rate, subtotal)
            VALUES (${uuid()}, ${quoteId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity}, ${item.unit_price.toString()}, ${(item.vat_rate || 21).toString()}, ${itemSubtotal.toString()})
          `);
        }
      }

      // CRM Pipeline sync: quote_created
      try {
        // Fetch quote_number for metadata title
        const qnResult = await db.execute(sql`SELECT quote_number FROM quotes WHERE id = ${quoteId}`);
        const quoteNumber = ((qnResult as any).rows || [])[0]?.quote_number || '';
        await crmSyncService.handleEvent({
          companyId,
          event: 'quote_created',
          enterpriseId: enterpriseId || undefined,
          customerId: data.customer_id || undefined,
          documentId: quoteId,
          documentType: 'quote',
          metadata: { title: `Cotizacion #${quoteNumber}`, amount: totalAmount },
        });
      } catch (e) { console.error('CRM sync error (quote_created):', e); }

      return { id: quoteId, total_amount: totalAmount };
    } catch (error) {
      console.error('Create quote error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create quote');
    }
  }

  async updateQuote(companyId: string, quoteId: string, data: any) {
    await this.ensureMigrations();
    try {
      // Verify quote belongs to company
      const existing = await this.getQuote(companyId, quoteId);
      if (!existing) throw new ApiError(404, 'Quote not found');

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || existing.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = (custResult as any).rows || custResult || [];
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      // Recalculate totals from items
      let subtotal = 0;
      let vatAmount = 0;
      const newItems = data.items || [];
      for (const item of newItems) {
        const itemSub = Number(item.unit_price) * Number(item.quantity);
        const itemVat = itemSub * (Number(item.vat_rate || 21) / 100);
        subtotal += itemSub;
        vatAmount += itemVat;
      }
      const totalAmount = subtotal + vatAmount;

      // Calculate valid_until from validity_days if provided
      let validUntil = data.valid_until || existing.valid_until || null;
      if (data.validity_days && !data.valid_until) {
        const d = new Date();
        d.setDate(d.getDate() + Number(data.validity_days));
        validUntil = d.toISOString().split('T')[0];
      }

      // Update quote record
      await db.execute(sql`
        UPDATE quotes SET
          customer_id = ${data.customer_id || existing.customer_id || null},
          enterprise_id = ${enterpriseId},
          title = ${data.title || existing.title || 'Cotizacion'},
          valid_until = ${validUntil},
          subtotal = ${subtotal.toString()},
          vat_amount = ${vatAmount.toString()},
          total_amount = ${totalAmount.toString()},
          notes = ${data.notes !== undefined ? data.notes : existing.notes},
          custom_company_name = ${data.custom_company_name !== undefined ? (data.custom_company_name || null) : existing.custom_company_name || null},
          updated_at = NOW()
        WHERE id = ${quoteId} AND company_id = ${companyId}
      `);

      // Replace items: delete old, insert new
      await db.execute(sql`DELETE FROM quote_items WHERE quote_id = ${quoteId}`);
      for (const item of newItems) {
        const itemSubtotal = Number(item.unit_price) * Number(item.quantity);
        await db.execute(sql`
          INSERT INTO quote_items (id, quote_id, product_id, product_name, description, quantity, unit_price, vat_rate, subtotal)
          VALUES (${uuid()}, ${quoteId}, ${item.product_id || null}, ${item.product_name}, ${item.description || null}, ${item.quantity}, ${item.unit_price.toString()}, ${(item.vat_rate || 21).toString()}, ${itemSubtotal.toString()})
        `);
      }

      return { id: quoteId, total_amount: totalAmount };
    } catch (error) {
      console.error('Update quote error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update quote');
    }
  }

  async generateQuotePdf(companyId: string, quoteId: string, template: string = 'clasico', bannerUrl?: string): Promise<Buffer> {
    try {
      // Get quote with items
      const quote = await this.getQuote(companyId, quoteId);

      // Get company info (including stored banner)
      const companyResult = await db.execute(sql`
        SELECT * FROM companies WHERE id = ${companyId}
      `);
      const companyRows = (companyResult as any).rows || companyResult || [];
      const company = companyRows[0];

      if (!company) throw new ApiError(404, 'Company not found');

      // Use explicit banner if provided, otherwise fall back to stored banner
      const effectiveBanner = bannerUrl || (company.quote_banner_base64 ? `data:image/png;base64,${company.quote_banner_base64}` : undefined);

      const html = this.buildQuoteHtml(company, quote, template, effectiveBanner);

      // Use puppeteer to generate PDF
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: 'new',
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
      console.error('Generate quote PDF error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate quote PDF');
    }
  }

  private escapeHtml(str: string): string {
    // Prevent double-escaping: first unescape any existing HTML entities
    let clean = String(str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    // Then escape properly
    return clean
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private buildQuoteHtml(company: any, quote: any, template: string = 'clasico', bannerUrl?: string): string {
    const bannerHtml = bannerUrl ? `<div style="width:100%;text-align:center;margin-bottom:16px;"><img src="${this.escapeHtml(bannerUrl)}" style="max-width:100%;max-height:120px;object-fit:contain;" /></div>` : '';

    switch (template) {
      case 'moderno': return this.buildModernoTemplate(quote, company, bannerHtml);
      case 'ejecutivo': return this.buildEjecutivoTemplate(quote, company, bannerHtml);
      default: return this.buildClasicoTemplate(quote, company, bannerHtml);
    }
  }

  private buildClasicoTemplate(quote: any, company: any, bannerHtml: string): string {
    const esc = (s: string) => this.escapeHtml(s);
    const items = quote.items || [];
    const customer = quote.customer || {};
    const validUntil = quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('es-AR') : 'N/A';
    const createdAt = new Date(quote.created_at).toLocaleDateString('es-AR');

    const itemRows = items.map((item: any, idx: number) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${idx + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#111827;">${esc(item.product_name)}</strong>
          ${item.description ? `<br><span style="color:#6b7280;font-size:12px;">${esc(item.description)}</span>` : ''}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">${Number(item.quantity)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">$ ${Number(item.unit_price).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;">$ ${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; color:#333; line-height:1.5; font-size:13px; }
  @page { margin: 0; }
</style></head>
<body>

  ${bannerHtml}

  <!-- HEADER -->
  <div style="padding:28px 40px 20px;border-bottom:2px solid #1a1a2e;">
    <div style="font-size:24px;font-weight:700;color:#1a1a2e;letter-spacing:1px;">BECKER<span style="color:#c8102e;">VISUAL</span></div>
  </div>

  <!-- COTIZACION HEADER -->
  <div style="padding:20px 40px 16px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e0e0e0;">
    <div>
      <div style="font-size:24px;font-weight:700;color:#1a1a2e;letter-spacing:0.5px;">COTIZACION</div>
      <div style="font-size:13px;color:#666;margin-top:2px;">N° ${String(quote.quote_number || '').padStart(6, '0')}</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#555;">
      <div><strong>Fecha:</strong> ${createdAt}</div>
      <div><strong>Valida hasta:</strong> ${validUntil}</div>
    </div>
  </div>

  <!-- EMISOR + CLIENTE -->
  <div style="padding:20px 40px;display:flex;gap:24px;">
    <div style="flex:1;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#999;margin-bottom:6px;font-weight:600;">De</div>
      <div style="font-size:15px;font-weight:600;color:#1a1a2e;">${esc(quote.custom_company_name || company.name)}</div>
      <div style="font-size:12px;color:#666;margin-top:2px;">CUIT: ${esc(company.cuit)}</div>
      ${company.address ? `<div style="font-size:12px;color:#666;">${esc(company.address)}${company.city ? `, ${esc(company.city)}` : ''}${company.province ? ` - ${esc(company.province)}` : ''}</div>` : ''}
      ${company.phone ? `<div style="font-size:12px;color:#666;">Tel: ${esc(company.phone)}</div>` : ''}
      ${company.email ? `<div style="font-size:12px;color:#666;">${esc(company.email)}</div>` : ''}
    </div>
    <div style="flex:1;background:#f8f9fa;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#999;margin-bottom:6px;font-weight:600;">Para</div>
      <div style="font-size:15px;font-weight:600;color:#1a1a2e;">${esc(customer.name || 'Consumidor Final')}</div>
      ${customer.cuit ? `<div style="font-size:12px;color:#666;margin-top:2px;">CUIT: ${esc(customer.cuit)}</div>` : ''}
      ${customer.address ? `<div style="font-size:12px;color:#666;">${esc(customer.address)}</div>` : ''}
      ${customer.email ? `<div style="font-size:12px;color:#666;">${esc(customer.email)}</div>` : ''}
      ${customer.phone ? `<div style="font-size:12px;color:#666;">Tel: ${esc(customer.phone)}</div>` : ''}
    </div>
  </div>

  ${quote.title ? `<div style="padding:0 40px 12px;"><div style="font-size:16px;font-weight:600;color:#1a1a2e;">${esc(quote.title)}</div></div>` : ''}

  <!-- ITEMS TABLE -->
  <div style="padding:0 40px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#1a1a2e;color:white;">
          <th style="padding:10px 12px;text-align:left;font-weight:600;width:36px;font-size:12px;">#</th>
          <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:12px;">Descripcion</th>
          <th style="padding:10px 12px;text-align:center;font-weight:600;width:70px;font-size:12px;">Cant.</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;width:110px;font-size:12px;">P. Unitario</th>
          <th style="padding:10px 12px;text-align:right;font-weight:600;width:110px;font-size:12px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- TOTALS -->
  <div style="padding:16px 40px;display:flex;justify-content:flex-end;">
    <div style="width:260px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;padding:8px 14px;background:#f8f9fa;border-bottom:1px solid #e5e7eb;">
        <span style="color:#666;font-size:13px;">Subtotal Neto:</span>
        <span style="font-weight:500;font-size:13px;">$ ${Number(quote.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 14px;background:#f8f9fa;border-bottom:1px solid #e5e7eb;">
        <span style="color:#666;font-size:13px;">IVA (21%):</span>
        <span style="font-weight:500;font-size:13px;">$ ${Number(quote.vat_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#1a1a2e;">
        <span style="font-size:15px;font-weight:700;color:white;">TOTAL:</span>
        <span style="font-size:15px;font-weight:700;color:white;">$ ${Number(quote.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  </div>

  ${quote.notes ? `
  <div style="padding:12px 40px;">
    <div style="background:#fef9e7;border-left:4px solid #f0c040;padding:10px 14px;">
      <div style="font-size:11px;font-weight:600;color:#8a6d00;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px;">Observaciones</div>
      <div style="font-size:12px;color:#5a4800;">${esc(quote.notes)}</div>
    </div>
  </div>` : ''}

  <!-- FOOTER -->
  <div style="position:fixed;bottom:0;left:0;right:0;border-top:3px solid #c8102e;padding:12px 40px;background:white;">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#999;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:700;color:#1a1a2e;font-size:12px;">BECKER<span style="color:#c8102e;">VISUAL</span></span>
        <span style="color:#666;">${esc(quote.custom_company_name || company.name)} — Cotizacion N° ${String(quote.quote_number || '').padStart(6, '0')}</span>
      </div>
      <div>Precios en Pesos Argentinos (ARS), IVA incluido</div>
      <div>Generado el ${new Date().toLocaleDateString('es-AR')}</div>
    </div>
  </div>

</body>
</html>`;
  }

  private buildModernoTemplate(quote: any, company: any, bannerHtml: string): string {
    const esc = (s: string) => this.escapeHtml(s);
    const items = quote.items || [];
    const customer = quote.customer || {};
    const validUntil = quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('es-AR') : 'N/A';
    const createdAt = new Date(quote.created_at).toLocaleDateString('es-AR');

    const itemRows = items.map((item: any, idx: number) => `
      <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="padding:12px 16px;color:#6b7280;font-size:12px;">${idx + 1}</td>
        <td style="padding:12px 16px;">
          <div style="color:#111827;font-weight:500;">${esc(item.product_name)}</div>
          ${item.description ? `<div style="color:#9ca3af;font-size:11px;margin-top:2px;">${esc(item.description)}</div>` : ''}
        </td>
        <td style="padding:12px 16px;text-align:center;color:#374151;">${Number(item.quantity)}</td>
        <td style="padding:12px 16px;text-align:right;color:#374151;">$ ${Number(item.unit_price).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        <td style="padding:12px 16px;text-align:right;font-weight:600;color:#111827;">$ ${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; color:#333; line-height:1.6; font-size:14px; }
  @page { margin: 0; }
</style></head>
<body>

  <!-- Accent top border -->
  <div style="height:4px;background:linear-gradient(90deg,#3b82f6,#2563eb);"></div>

  ${bannerHtml}

  <!-- HEADER -->
  <div style="padding:32px 48px 24px;background:#f8f9fa;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:28px;font-weight:300;color:#1f2937;letter-spacing:2px;">${esc(quote.custom_company_name || company.name)}</div>
        ${company.cuit ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">CUIT: ${esc(company.cuit)}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;font-weight:500;">Cotizacion</div>
        <div style="font-size:28px;font-weight:700;color:#3b82f6;margin-top:2px;">N° ${String(quote.quote_number || '').padStart(6, '0')}</div>
      </div>
    </div>
  </div>

  <!-- Dates -->
  <div style="padding:16px 48px;display:flex;gap:32px;font-size:13px;color:#6b7280;">
    <div>Fecha: <strong style="color:#374151;">${createdAt}</strong></div>
    <div>Valida hasta: <strong style="color:#374151;">${validUntil}</strong></div>
  </div>

  <!-- EMISOR + CLIENTE -->
  <div style="padding:16px 48px 24px;display:flex;gap:32px;">
    <div style="flex:1;background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#3b82f6;margin-bottom:8px;font-weight:600;">Emisor</div>
      <div style="font-size:15px;font-weight:600;color:#1f2937;">${esc(quote.custom_company_name || company.name)}</div>
      ${company.address ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${esc(company.address)}${company.city ? `, ${esc(company.city)}` : ''}${company.province ? ` - ${esc(company.province)}` : ''}</div>` : ''}
      ${company.phone ? `<div style="font-size:12px;color:#6b7280;">Tel: ${esc(company.phone)}</div>` : ''}
      ${company.email ? `<div style="font-size:12px;color:#6b7280;">${esc(company.email)}</div>` : ''}
    </div>
    <div style="flex:1;background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#3b82f6;margin-bottom:8px;font-weight:600;">Cliente</div>
      <div style="font-size:15px;font-weight:600;color:#1f2937;">${esc(customer.name || 'Consumidor Final')}</div>
      ${customer.cuit ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">CUIT: ${esc(customer.cuit)}</div>` : ''}
      ${customer.address ? `<div style="font-size:12px;color:#6b7280;">${esc(customer.address)}</div>` : ''}
      ${customer.email ? `<div style="font-size:12px;color:#6b7280;">${esc(customer.email)}</div>` : ''}
      ${customer.phone ? `<div style="font-size:12px;color:#6b7280;">Tel: ${esc(customer.phone)}</div>` : ''}
    </div>
  </div>

  ${quote.title ? `<div style="padding:0 48px 16px;"><div style="font-size:17px;font-weight:500;color:#1f2937;">${esc(quote.title)}</div></div>` : ''}

  <!-- ITEMS TABLE -->
  <div style="padding:0 48px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;border-radius:12px;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:12px 16px;text-align:left;font-weight:600;width:36px;font-size:12px;color:#6b7280;">#</th>
          <th style="padding:12px 16px;text-align:left;font-weight:600;font-size:12px;color:#6b7280;">Descripcion</th>
          <th style="padding:12px 16px;text-align:center;font-weight:600;width:70px;font-size:12px;color:#6b7280;">Cant.</th>
          <th style="padding:12px 16px;text-align:right;font-weight:600;width:110px;font-size:12px;color:#6b7280;">P. Unitario</th>
          <th style="padding:12px 16px;text-align:right;font-weight:600;width:110px;font-size:12px;color:#6b7280;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- TOTALS -->
  <div style="padding:20px 48px;display:flex;justify-content:flex-end;">
    <div style="width:280px;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="display:flex;justify-content:space-between;padding:10px 16px;background:white;">
        <span style="color:#6b7280;font-size:13px;">Subtotal Neto:</span>
        <span style="font-weight:500;font-size:13px;color:#374151;">$ ${Number(quote.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 16px;background:white;border-top:1px solid #f3f4f6;">
        <span style="color:#6b7280;font-size:13px;">IVA (21%):</span>
        <span style="font-weight:500;font-size:13px;color:#374151;">$ ${Number(quote.vat_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:12px 16px;background:#3b82f6;">
        <span style="font-size:15px;font-weight:700;color:white;">TOTAL:</span>
        <span style="font-size:15px;font-weight:700;color:white;">$ ${Number(quote.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  </div>

  ${quote.notes ? `
  <div style="padding:12px 48px;">
    <div style="background:#f0f9ff;border-left:3px solid #3b82f6;padding:12px 16px;border-radius:0 8px 8px 0;">
      <div style="font-size:11px;font-weight:600;color:#1d4ed8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Observaciones</div>
      <div style="font-size:12px;color:#1e40af;">${esc(quote.notes)}</div>
    </div>
  </div>` : ''}

  <!-- FOOTER -->
  <div style="position:fixed;bottom:0;left:0;right:0;padding:14px 48px;background:white;border-top:1px solid #e5e7eb;">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#9ca3af;">
      <div>${esc(quote.custom_company_name || company.name)} — Cotizacion N° ${String(quote.quote_number || '').padStart(6, '0')}</div>
      <div>Precios en Pesos Argentinos (ARS), IVA incluido</div>
      <div>Generado el ${new Date().toLocaleDateString('es-AR')}</div>
    </div>
  </div>

</body>
</html>`;
  }

  private buildEjecutivoTemplate(quote: any, company: any, bannerHtml: string): string {
    const esc = (s: string) => this.escapeHtml(s);
    const items = quote.items || [];
    const customer = quote.customer || {};
    const validUntil = quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('es-AR') : 'N/A';
    const createdAt = new Date(quote.created_at).toLocaleDateString('es-AR');
    const accentColor = '#4f46e5';
    const accentLight = '#eef2ff';

    const itemRows = items.map((item: any, idx: number) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${idx + 1}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#111827;">${esc(item.product_name)}</strong>
          ${item.description ? `<br><span style="color:#6b7280;font-size:11px;">${esc(item.description)}</span>` : ''}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">${Number(item.quantity)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">$ ${Number(item.unit_price).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">$ ${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; color:#333; line-height:1.5; font-size:13px; }
  @page { margin: 0; }
</style></head>
<body>

  ${bannerHtml}

  <!-- FULL-WIDTH HEADER -->
  <div style="background:${accentColor};padding:32px 48px;color:white;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:26px;font-weight:800;letter-spacing:1px;">${esc(quote.custom_company_name || company.name)}</div>
        ${company.cuit ? `<div style="font-size:12px;opacity:0.8;margin-top:4px;">CUIT: ${esc(company.cuit)}</div>` : ''}
        ${company.phone ? `<div style="font-size:12px;opacity:0.8;">Tel: ${esc(company.phone)}</div>` : ''}
        ${company.email ? `<div style="font-size:12px;opacity:0.8;">${esc(company.email)}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:3px;opacity:0.7;font-weight:500;">Cotizacion</div>
        <div style="font-size:36px;font-weight:800;margin-top:4px;">N° ${String(quote.quote_number || '').padStart(6, '0')}</div>
      </div>
    </div>
  </div>

  <!-- DATES BAR -->
  <div style="background:${accentLight};padding:12px 48px;display:flex;gap:40px;font-size:13px;border-bottom:1px solid #c7d2fe;">
    <div style="color:#4338ca;">Fecha: <strong>${createdAt}</strong></div>
    <div style="color:#4338ca;">Valida hasta: <strong>${validUntil}</strong></div>
    ${quote.title ? `<div style="color:#4338ca;font-weight:600;">${esc(quote.title)}</div>` : ''}
  </div>

  <!-- TWO-COLUMN INFO -->
  <div style="padding:24px 48px;display:flex;gap:32px;">
    <div style="flex:1;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:${accentColor};margin-bottom:8px;font-weight:700;">Datos del Emisor</div>
      <div style="font-size:14px;font-weight:600;color:#1f2937;">${esc(quote.custom_company_name || company.name)}</div>
      ${company.address ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${esc(company.address)}${company.city ? `, ${esc(company.city)}` : ''}${company.province ? ` - ${esc(company.province)}` : ''}</div>` : ''}
    </div>
    <div style="flex:1;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:${accentColor};margin-bottom:8px;font-weight:700;">Datos del Cliente</div>
      <div style="font-size:14px;font-weight:600;color:#1f2937;">${esc(customer.name || 'Consumidor Final')}</div>
      ${customer.cuit ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">CUIT: ${esc(customer.cuit)}</div>` : ''}
      ${customer.address ? `<div style="font-size:12px;color:#6b7280;">${esc(customer.address)}</div>` : ''}
      ${customer.email ? `<div style="font-size:12px;color:#6b7280;">${esc(customer.email)}</div>` : ''}
      ${customer.phone ? `<div style="font-size:12px;color:#6b7280;">Tel: ${esc(customer.phone)}</div>` : ''}
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <div style="padding:0 48px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:${accentColor};color:white;">
          <th style="padding:12px 14px;text-align:left;font-weight:600;width:36px;font-size:12px;">#</th>
          <th style="padding:12px 14px;text-align:left;font-weight:600;font-size:12px;">Descripcion</th>
          <th style="padding:12px 14px;text-align:center;font-weight:600;width:70px;font-size:12px;">Cant.</th>
          <th style="padding:12px 14px;text-align:right;font-weight:600;width:110px;font-size:12px;">P. Unitario</th>
          <th style="padding:12px 14px;text-align:right;font-weight:600;width:110px;font-size:12px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- TOTALS -->
  <div style="padding:20px 48px;display:flex;justify-content:flex-end;">
    <div style="width:280px;background:${accentLight};border:2px solid ${accentColor};border-radius:8px;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #c7d2fe;">
        <span style="color:#4338ca;font-size:13px;">Subtotal Neto:</span>
        <span style="font-weight:600;font-size:13px;color:#312e81;">$ ${Number(quote.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #c7d2fe;">
        <span style="color:#4338ca;font-size:13px;">IVA (21%):</span>
        <span style="font-weight:600;font-size:13px;color:#312e81;">$ ${Number(quote.vat_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:14px 16px;background:${accentColor};">
        <span style="font-size:16px;font-weight:800;color:white;">TOTAL:</span>
        <span style="font-size:16px;font-weight:800;color:white;">$ ${Number(quote.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  </div>

  ${quote.notes ? `
  <div style="padding:12px 48px;">
    <div style="background:${accentLight};border-left:4px solid ${accentColor};padding:12px 16px;">
      <div style="font-size:11px;font-weight:700;color:${accentColor};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Observaciones</div>
      <div style="font-size:12px;color:#312e81;">${esc(quote.notes)}</div>
    </div>
  </div>` : ''}

  <!-- FOOTER -->
  <div style="position:fixed;bottom:0;left:0;right:0;background:${accentColor};padding:12px 48px;">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:rgba(255,255,255,0.8);">
      <div style="font-weight:600;color:white;">${esc(quote.custom_company_name || company.name)} — Cotizacion N° ${String(quote.quote_number || '').padStart(6, '0')}</div>
      <div>Precios en Pesos Argentinos (ARS), IVA incluido</div>
      <div>Generado el ${new Date().toLocaleDateString('es-AR')}</div>
    </div>
  </div>

</body>
</html>`;
  }

  // --- Banner management ---

  async ensureBannerColumn() {
    try {
      await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS quote_banner_base64 TEXT`).catch(() => {});
    } catch (e) {
      console.warn('Banner column migration:', e);
    }
  }

  async uploadBanner(companyId: string, base64Data: string) {
    await this.ensureBannerColumn();
    try {
      await db.execute(sql`
        UPDATE companies SET quote_banner_base64 = ${base64Data} WHERE id = ${companyId}
      `);
      return { success: true };
    } catch (error) {
      console.error('Upload banner error:', error);
      throw new ApiError(500, 'Failed to upload banner');
    }
  }

  async getBanner(companyId: string): Promise<string | null> {
    await this.ensureBannerColumn();
    try {
      const result = await db.execute(sql`
        SELECT quote_banner_base64 FROM companies WHERE id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0]?.quote_banner_base64 || null;
    } catch (error) {
      console.error('Get banner error:', error);
      throw new ApiError(500, 'Failed to get banner');
    }
  }

  async deleteBanner(companyId: string) {
    await this.ensureBannerColumn();
    try {
      await db.execute(sql`
        UPDATE companies SET quote_banner_base64 = NULL WHERE id = ${companyId}
      `);
      return { success: true };
    } catch (error) {
      console.error('Delete banner error:', error);
      throw new ApiError(500, 'Failed to delete banner');
    }
  }
}

export const quotesService = new QuotesService();
