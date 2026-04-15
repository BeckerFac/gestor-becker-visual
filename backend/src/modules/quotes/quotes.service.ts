import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { crmSyncService } from '../crm/crm-sync.service';
import { getRows, getFirstRow } from '../../lib/db-utils';
import { escapeHtml as sharedEscapeHtml } from '../../lib/html-escape';

export class QuotesService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`).catch(e => console.warn('Migration:', e.message));
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_number INTEGER DEFAULT 0`).catch(e => console.warn('Migration:', e.message));
      await db.execute(sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS custom_company_name TEXT`).catch(e => console.warn('Migration:', e.message));
      // Bug B safety net: prevent duplicate orders from the same accepted quote at the DB level
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_quote_id_unique ON orders(quote_id) WHERE quote_id IS NOT NULL`).catch(e => console.warn('Migration idx_orders_quote_id_unique:', e.message));
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
        // PR7-T1: offset AR -03:00 para no perder las ultimas 3h del dia en UTC
        whereClause = sql`${whereClause} AND q.created_at <= ${date_to + 'T23:59:59.999-03:00'}`;
      }

      // C9: LATERAL JOIN para tags evita subquery correlado por cada row
      // (antes: N subqueries en SELECT + 1 en enterprise fallback = 2N).
      // Despues: 2 LATERAL joins materializados 1 vez por row con predicate pushdown.
      // Impact: ~10-15x en listados grandes.
      const result = await db.execute(sql`
        SELECT q.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit) as customer,
          CASE WHEN eq.id IS NOT NULL THEN json_build_object('id', eq.id, 'name', eq.name)
          ELSE CASE WHEN e2.id IS NOT NULL THEN json_build_object('id', e2.id, 'name', e2.name) ELSE NULL END
          END as enterprise,
          COALESCE(ent_tags.tags, '[]'::json) as enterprise_tags
        FROM quotes q
        LEFT JOIN customers c ON q.customer_id = c.id
        LEFT JOIN enterprises eq ON q.enterprise_id = eq.id
        LEFT JOIN enterprises e2 ON e2.id = c.enterprise_id
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)) AS tags
          FROM entity_tags et
          JOIN tags t ON et.tag_id = t.id
          WHERE et.entity_id = COALESCE(eq.id, c.enterprise_id)
            AND et.entity_type = 'enterprise'
        ) ent_tags ON true
        WHERE ${whereClause}
        ORDER BY q.created_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `);
      const rows = getRows(result);

      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int as total
        FROM quotes q
        LEFT JOIN customers c ON q.customer_id = c.id
        WHERE ${whereClause}
      `);
      const total = getFirstRow(countResult)?.total || 0;

      return { items: rows, total };
    } catch (error) {
      console.error('Get quotes error:', error);
      throw new ApiError(500, 'Failed to get quotes');
    }
  }

  async getQuote(companyId: string, quoteId: string): Promise<Record<string, any>> {
    try {
      const result = await db.execute(sql`
        SELECT q.*,
          json_build_object('id', c.id, 'name', c.name, 'cuit', c.cuit, 'email', c.email, 'phone', c.phone, 'address', c.address) as customer
        FROM quotes q
        LEFT JOIN customers c ON q.customer_id = c.id
        WHERE q.company_id = ${companyId} AND q.id = ${quoteId}
      `);
      const rows = getRows(result);
      if (rows.length === 0) throw new ApiError(404, 'Quote not found');

      const itemsResult = await db.execute(sql`
        SELECT * FROM quote_items WHERE quote_id = ${quoteId} ORDER BY created_at ASC
      `);
      const items = getRows(itemsResult);

      return { ...rows[0], items };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get quote');
    }
  }

  async updateQuoteStatus(companyId: string, quoteId: string, newStatus: string) {
    const validStatuses = ['draft', 'sent', 'accepted', 'rejected'];
    if (!validStatuses.includes(newStatus)) {
      throw new ApiError(400, 'Invalid status');
    }

    // Bug A: wrap status update + order creation in a single transaction so
    // a failure inside convertQuoteToOrder rolls back the quote status update.
    // Bug B: SELECT ... FOR UPDATE locks the row; idempotent short-circuit if
    // the quote is already in the target status (returns the existing order).
    const client = await pool.connect();
    let order: any = null;
    let alreadyInState = false;
    try {
      await client.query('BEGIN');

      const lockResult = await client.query(
        `SELECT id, status FROM quotes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [quoteId, companyId]
      );
      if (lockResult.rows.length === 0) {
        throw new ApiError(404, 'Quote not found');
      }
      const currentQuote = lockResult.rows[0];

      if (currentQuote.status === newStatus) {
        // Idempotent: do not re-run side effects. For 'accepted', return the existing order.
        alreadyInState = true;
        if (newStatus === 'accepted') {
          const existingOrder = await client.query(
            `SELECT id, order_number FROM orders WHERE quote_id = $1 AND company_id = $2 LIMIT 1`,
            [quoteId, companyId]
          );
          order = existingOrder.rows[0] || null;
        }
        await client.query('COMMIT');
      } else {
        await client.query(
          `UPDATE quotes SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, quoteId]
        );

        if (newStatus === 'accepted') {
          order = await this.convertQuoteToOrderInTx(client, companyId, quoteId);
        } else if (newStatus === 'rejected') {
          // Bug A fix: do NOT cascade-delete orders. Preserve any existing order
          // (could be from a prior accept) and let the user handle it explicitly.
          // The previous destructive DELETE path could lose payment history,
          // cheques links, and audit trails on a simple status flip.
          console.log(`[quotes] Quote ${quoteId} rejected; preserving any existing order.`);
        }

        await client.query('COMMIT');
      }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      if (e instanceof ApiError) throw e;
      console.error('updateQuoteStatus error:', e);
      throw new ApiError(500, 'Failed to update quote status');
    }
    client.release();

    // CRM Pipeline sync: quote status changes (only when status actually changed)
    if (!alreadyInState) {
      try {
        if (newStatus === 'accepted') {
          // Resolve enterprise_id for the quote
          const quoteData = await db.execute(sql`SELECT enterprise_id, customer_id, total_amount, quote_number FROM quotes WHERE id = ${quoteId}`);
          const qd = getFirstRow(quoteData);
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
          const qd = getFirstRow(quoteData);
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
    }

    return { quote_id: quoteId, status: newStatus, order, already: alreadyInState };
  }

  private async convertQuoteToOrderInTx(client: any, companyId: string, quoteId: string) {
    // Transactional version. Uses the provided pg client so the work is rolled
    // back atomically with updateQuoteStatus on any failure.
    const quoteRes = await client.query(
      `SELECT q.* FROM quotes q WHERE q.id = $1 AND q.company_id = $2`,
      [quoteId, companyId]
    );
    if (quoteRes.rows.length === 0) throw new ApiError(404, 'Quote not found');
    const quote: any = quoteRes.rows[0];

    const itemsRes = await client.query(
      `SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY created_at ASC`,
      [quoteId]
    );
    const items = itemsRes.rows || [];

    // PR3-T1: guardrail — no se puede aceptar una cotizacion sin items
    if (items.length === 0) {
      throw new ApiError(400, 'No se puede aceptar una cotizacion sin items. Agrega al menos un producto.');
    }
    const quoteTotal = parseFloat(quote.total_amount || '0');
    if (!Number.isFinite(quoteTotal) || quoteTotal <= 0) {
      throw new ApiError(400, 'No se puede aceptar una cotizacion con total $0 o invalido.');
    }

    // Generate order_number (within the same transaction so concurrent accepts serialize)
    const numResult = await client.query(
      `SELECT COALESCE(MAX(order_number), 0) + 1 as next_number FROM orders WHERE company_id = $1`,
      [companyId]
    );
    const orderNumber = parseInt(numResult.rows[0]?.next_number || '1');

    const orderId = uuid();
    const totalAmount = parseFloat(quote.total_amount || '0');

    // Resolve enterprise_id
    let enterpriseId = quote.enterprise_id || null;
    if (!enterpriseId && quote.customer_id) {
      const custResult = await client.query(
        `SELECT enterprise_id FROM customers WHERE id = $1`,
        [quote.customer_id]
      );
      if (custResult.rows[0]?.enterprise_id) enterpriseId = custResult.rows[0].enterprise_id;
    }

    await client.query(
      `INSERT INTO orders (id, company_id, customer_id, enterprise_id, order_number, title, status, priority, quantity, unit_price, total_amount, vat_rate, payment_status, quote_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', 'normal', $7, $8, $9, $10, 'pendiente', $11, $12, $13)`,
      [orderId, companyId, quote.customer_id || null, enterpriseId, orderNumber,
       quote.title || 'Pedido desde cotización', 1,
       totalAmount.toString(), totalAmount.toString(), '21',
       quoteId, quote.notes || null, quote.created_by || null]
    );

    // Copy items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name, description, quantity, unit_price, cost, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [uuid(), orderId, item.product_id || null, item.product_name, item.description || null,
         item.quantity, item.unit_price?.toString() || '0', '0', item.subtotal?.toString() || '0']
      );
    }

    // Record initial status
    await client.query(
      `INSERT INTO order_status_history (id, order_id, new_status, notes, changed_by)
       VALUES ($1, $2, 'pendiente', $3, $4)`,
      [uuid(), orderId, 'Creado desde cotización #' + (quote.quote_number || ''), quote.created_by || null]
    );

    return { id: orderId, order_number: orderNumber };
  }

  // Bug C: validate that referenced entities (enterprise, customer, products) belong
  // to the caller's company. Without this, a crafted payload with foreign IDs
  // could create cross-tenant data bleed.
  private async validateTenantRefs(companyId: string, data: any) {
    if (data.enterprise_id) {
      const ent = await db.execute(sql`SELECT id FROM enterprises WHERE id = ${data.enterprise_id} AND company_id = ${companyId}`);
      if (getRows(ent).length === 0) {
        throw new ApiError(400, 'Empresa no encontrada en tu cuenta');
      }
    }
    if (data.customer_id) {
      const cust = await db.execute(sql`SELECT id FROM customers WHERE id = ${data.customer_id} AND company_id = ${companyId}`);
      if (getRows(cust).length === 0) {
        throw new ApiError(400, 'Cliente no encontrado en tu cuenta');
      }
    }
    if (Array.isArray(data.items)) {
      const productIds: string[] = data.items
        .map((i: any) => i?.product_id)
        .filter((pid: any) => typeof pid === 'string' && pid.length > 0);
      if (productIds.length > 0) {
        const prods = await db.execute(sql`
          SELECT id FROM products WHERE id = ANY(${productIds}::uuid[]) AND company_id = ${companyId}
        `);
        const found = new Set(getRows(prods).map((r: any) => r.id));
        for (const pid of productIds) {
          if (!found.has(pid)) {
            throw new ApiError(400, `Producto ${pid} no encontrado en tu cuenta`);
          }
        }
      }
    }
  }

  async createQuote(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      await this.validateTenantRefs(companyId, data);
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
        const custRows = getRows(custResult);
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
        const quoteNumber = getFirstRow(qnResult)?.quote_number || '';
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
    const client = await pool.connect();
    try {
      // Bug C: validate tenant refs before doing any work
      await this.validateTenantRefs(companyId, data);

      // Verify quote belongs to company
      const existing = await this.getQuote(companyId, quoteId);
      if (!existing) throw new ApiError(404, 'Quote not found');

      // Resolve enterprise_id from customer if not provided
      let enterpriseId = data.enterprise_id || existing.enterprise_id || null;
      if (!enterpriseId && data.customer_id) {
        const custResult = await db.execute(sql`SELECT enterprise_id FROM customers WHERE id = ${data.customer_id}`);
        const custRows = getRows(custResult);
        if (custRows[0]?.enterprise_id) enterpriseId = custRows[0].enterprise_id;
      }

      // Bug D: only recalc totals from items when items were actually provided.
      // Otherwise preserve the existing aggregates so a partial PATCH (e.g. { notes })
      // does not zero them out.
      const itemsProvided = Array.isArray(data.items);
      let subtotal: number;
      let vatAmount: number;
      let totalAmount: number;
      if (itemsProvided) {
        subtotal = 0;
        vatAmount = 0;
        for (const item of data.items) {
          const itemSub = Number(item.unit_price) * Number(item.quantity);
          const itemVat = itemSub * (Number(item.vat_rate || 21) / 100);
          subtotal += itemSub;
          vatAmount += itemVat;
        }
        totalAmount = subtotal + vatAmount;
      } else {
        subtotal = parseFloat(existing.subtotal || '0');
        vatAmount = parseFloat(existing.vat_amount || '0');
        totalAmount = parseFloat(existing.total_amount || '0');
      }

      // Calculate valid_until from validity_days if provided
      let validUntil = data.valid_until || existing.valid_until || null;
      if (data.validity_days && !data.valid_until) {
        const d = new Date();
        d.setDate(d.getDate() + Number(data.validity_days));
        validUntil = d.toISOString().split('T')[0];
      }

      // Bug D: wrap UPDATE + items DELETE/INSERT in a transaction so a mid-loop
      // failure does not leave a half-populated quote.
      await client.query('BEGIN');

      await client.query(
        `UPDATE quotes SET
            customer_id = $1,
            enterprise_id = $2,
            title = $3,
            valid_until = $4,
            subtotal = $5,
            vat_amount = $6,
            total_amount = $7,
            notes = $8,
            custom_company_name = $9,
            updated_at = NOW()
          WHERE id = $10 AND company_id = $11`,
        [
          data.customer_id || existing.customer_id || null,
          enterpriseId,
          data.title || existing.title || 'Cotizacion',
          validUntil,
          subtotal.toString(),
          vatAmount.toString(),
          totalAmount.toString(),
          data.notes !== undefined ? data.notes : existing.notes,
          data.custom_company_name !== undefined ? (data.custom_company_name || null) : existing.custom_company_name || null,
          quoteId,
          companyId,
        ]
      );

      // Bug D: only touch items when explicitly provided. An empty array means
      // "intentionally clear all items"; undefined means "leave them alone".
      if (itemsProvided) {
        await client.query(`DELETE FROM quote_items WHERE quote_id = $1`, [quoteId]);
        for (const item of data.items) {
          const itemSubtotal = Number(item.unit_price) * Number(item.quantity);
          await client.query(
            `INSERT INTO quote_items (id, quote_id, product_id, product_name, description, quantity, unit_price, vat_rate, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [uuid(), quoteId, item.product_id || null, item.product_name, item.description || null,
             item.quantity, item.unit_price.toString(), (item.vat_rate || 21).toString(), itemSubtotal.toString()]
          );
        }
      }

      await client.query('COMMIT');
      return { id: quoteId, total_amount: totalAmount };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Update quote error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update quote');
    } finally {
      client.release();
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
      const companyRows = getRows(companyResult);
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

  private escapeHtml(str: unknown): string {
    // HIGH-4: delegate to shared helper in src/lib/html-escape.ts
    return sharedEscapeHtml(str);
  }

  private buildQuoteHtml(company: any, quote: any, template: string = 'clasico', bannerUrl?: string): string {
    const bannerHtml = bannerUrl ? `<div style="width:100%;text-align:center;margin-bottom:16px;"><img src="${this.escapeHtml(bannerUrl)}" style="max-width:100%;max-height:120px;object-fit:contain;" /></div>` : '';

    switch (template) {
      case 'moderno': return this.buildModernoTemplate(quote, company, bannerHtml);
      case 'ejecutivo': return this.buildEjecutivoTemplate(quote, company, bannerHtml);
      default: return this.buildClasicoTemplate(quote, company, bannerHtml);
    }
  }

  // PR3-T4: label dinamico de IVA segun las rates reales de los items
  // (antes hardcodeado a "IVA (21%)" en 3 templates distintos).
  private computeVatLabel(items: any[]): string {
    const rates = new Set<number>();
    for (const it of items || []) {
      const r = Number(it.vat_rate ?? 21);
      if (Number.isFinite(r)) rates.add(r);
    }
    if (rates.size === 0) return 'IVA:';
    if (rates.size === 1) return `IVA (${[...rates][0]}%):`;
    return 'IVA (varios):';
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
        <span style="color:#666;font-size:13px;">${this.computeVatLabel(quote.items || [])}</span>
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
        <span style="color:#6b7280;font-size:13px;">${this.computeVatLabel(quote.items || [])}</span>
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
        <span style="color:#4338ca;font-size:13px;">${this.computeVatLabel(quote.items || [])}</span>
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
      const rows = getRows(result);
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
