import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { crmSyncService } from '../crm/crm-sync.service';
import { ordersService } from '../orders/orders.service';

interface PaymentMethodInput {
  method: string;
  amount: number;
  bank_id?: string;
  reference?: string;
  cheque_data?: {
    number: string;
    bank: string;
    drawer: string;
    drawer_cuit?: string;
    cheque_type: string;
    issue_date: string;
    due_date: string;
  };
}

/**
 * CobrosService handles payment collection (cobranzas).
 *
 * IMPORTANT: As of the Razones Sociales refactor (2026-03-23):
 * - cobros.order_id and cobros.invoice_id are DEPRECATED direct links
 * - New system uses cobro_invoice_applications table for N:N cobro↔invoice linking
 * - Use CobroApplicationsService for linking/unlinking cobros to invoices
 * - cobros.pending_status = 'pending_invoice' marks cobros not yet linked to any invoice
 * - CC calculation uses cobro_invoice_applications, not these direct fields
 * - The recalculateOrderPaymentStatus() here is LEGACY - new calculation is in
 *   CobroApplicationsService.recalculateOrderPaymentStatusFromInvoices()
 */
export class CobrosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cobros (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          order_id UUID REFERENCES orders(id),
          invoice_id UUID REFERENCES invoices(id),
          amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          notes TEXT,
          receipt_image TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS receipt_image TEXT`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS cobro_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
          order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
          amount_paid DECIMAL(12,2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      // Ensure retenciones has all columns referenced by getCobros query
      await db.execute(sql`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS rate DECIMAL(5,2) DEFAULT 0`).catch(() => {});
      await db.execute(sql`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS base_amount DECIMAL(12,2) DEFAULT 0`).catch(() => {});
      await db.execute(sql`ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS certificate_file TEXT`).catch(() => {});

      // PR7-T5: soft-delete columns. ALTER guarded so old tenants get them on first call.
      // Don't fully swallow: log so failures are visible, but don't crash service init.
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'activo'`).catch((e: any) => console.error('ensureTables cobros migration (status):', e));
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS anulled_at TIMESTAMPTZ`).catch((e: any) => console.error('ensureTables cobros migration (anulled_at):', e));
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS anulled_by UUID REFERENCES users(id)`).catch((e: any) => console.error('ensureTables cobros migration (anulled_by):', e));
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS anulled_reason TEXT`).catch((e: any) => console.error('ensureTables cobros migration (anulled_reason):', e));
      await db.execute(sql`UPDATE cobros SET status = 'activo' WHERE status IS NULL`).catch((e: any) => console.error('ensureTables cobros migration (backfill status):', e));
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cobros_status ON cobros(company_id, status)`).catch((e: any) => console.error('ensureTables cobros migration (idx_cobros_status):', e));

      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure cobros tables error:', error);
    }
  }

  async getCobros(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
    fiscal_type?: 'fiscal' | 'no_fiscal' | 'all';
    userCanAccessLuna?: boolean;
  } = {}) {
    await this.ensureTables();
    try {
      // Sol/Luna circuit filter: non-Luna users NEVER see Luna rows.
      const canLuna = !!filters.userCanAccessLuna;
      let effectiveFiscal: 'fiscal' | 'no_fiscal' | 'all';
      if (!canLuna) {
        effectiveFiscal = 'fiscal';
      } else if (filters.fiscal_type === 'fiscal' || filters.fiscal_type === 'no_fiscal' || filters.fiscal_type === 'all') {
        effectiveFiscal = filters.fiscal_type;
      } else {
        effectiveFiscal = 'all';
      }

      let whereClause = sql`c.company_id = ${companyId}`;
      if (effectiveFiscal === 'fiscal') {
        whereClause = sql`${whereClause} AND (c.fiscal_type = 'fiscal' OR c.fiscal_type IS NULL)`;
      } else if (effectiveFiscal === 'no_fiscal') {
        whereClause = sql`${whereClause} AND c.fiscal_type = 'no_fiscal'`;
      }
      if (filters.business_unit_id) {
        // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
        whereClause = sql`${whereClause} AND (c.business_unit_id = ${filters.business_unit_id} OR c.business_unit_id IS NULL)`;
      }
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND c.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT c.*,
          COALESCE(c.total_amount, CAST(c.amount AS decimal)) as total_amount,
          e.name as enterprise_name,
          o.order_number, o.title as order_title,
          b.bank_name,
          c.receipt_image IS NOT NULL as has_receipt,
          -- Retenciones sufridas linked to this cobro
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', r.id, 'type', r.type, 'rate', r.rate,
              'base_amount', r.base_amount, 'amount', r.amount,
              'certificate_file', r.certificate_file
            ))
            FROM retenciones r
            WHERE r.cobro_id = c.id AND r.direction = 'sufrida'
          ), '[]'::json) as retenciones_sufridas,
          -- Linked invoices via cobro_invoice_applications
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', cia.id,
              'invoice_id', cia.invoice_id,
              'amount', cia.amount_applied,
              'invoice_number', i.invoice_number,
              'invoice_type', i.invoice_type,
              'invoice_total', i.total_amount,
              'fiscal_type', i.fiscal_type,
              'enterprise_name', COALESCE(ie.name, ''),
              'customer_name', COALESCE(ic.name, 'Consumidor Final')
            ))
            FROM cobro_invoice_applications cia
            JOIN invoices i ON cia.invoice_id = i.id
            LEFT JOIN enterprises ie ON i.enterprise_id = ie.id
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE cia.cobro_id = c.id
          ), '[]'::json) as linked_invoices,
          -- Total assigned to invoices
          COALESCE((SELECT SUM(CAST(cia2.amount_applied AS decimal)) FROM cobro_invoice_applications cia2 JOIN cobros c2 ON cia2.cobro_id = c2.id WHERE cia2.cobro_id = c.id AND (c2.status IS NULL OR c2.status != 'anulado')), 0) as total_assigned,
          -- Payment methods breakdown
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', rpm.id, 'method', rpm.method, 'amount', CAST(rpm.amount AS decimal),
              'bank_id', rpm.bank_id, 'reference', rpm.reference, 'cheque_data', rpm.cheque_data
            )) FROM receipt_payment_methods rpm WHERE rpm.cobro_id = c.id),
            '[]'::json
          ) as payment_methods,
          -- Enterprise tags
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM entity_tags et JOIN tags t ON et.tag_id=t.id WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY c.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('getCobros error:', error);
      throw new ApiError(500, 'Failed to get cobros');
    }
  }

  /**
   * Sol/Luna row-level guard. Non-Luna users get 404 for Luna rows
   * (existence leak prevention).
   */
  async getCobroById(companyId: string, cobroId: string, opts: { userCanAccessLuna?: boolean } = {}) {
    await this.ensureTables();
    const result = await db.execute(sql`
      SELECT c.* FROM cobros c
      WHERE c.id = ${cobroId} AND c.company_id = ${companyId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) throw new ApiError(404, 'Cobro not found');
    const rowFiscal = (rows[0].fiscal_type || 'fiscal') as 'fiscal' | 'no_fiscal';
    if (rowFiscal === 'no_fiscal' && !opts.userCanAccessLuna) {
      throw new ApiError(404, 'Cobro not found');
    }
    return rows[0];
  }

  async createCobro(companyId: string, userId: string, data: any, opts: { userCanAccessLuna?: boolean } = {}) {
    await this.ensureTables();

    // ═══ Sol/Luna: validate fiscal_type ═══
    // Default 'fiscal'. Luna requires user access.
    const cobroFiscalType: 'fiscal' | 'no_fiscal' =
      data.fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal';
    if (data.fiscal_type !== undefined && data.fiscal_type !== null &&
        data.fiscal_type !== 'fiscal' && data.fiscal_type !== 'no_fiscal') {
      throw new ApiError(400, 'fiscal_type invalido. Valores: fiscal, no_fiscal');
    }
    if (cobroFiscalType === 'no_fiscal' && !opts.userCanAccessLuna) {
      throw new ApiError(403, 'Sin acceso al circuito Luna');
    }

    // Sol/Luna: Luna cobros do NOT admit retenciones sufridas.
    if (cobroFiscalType === 'no_fiscal' && Array.isArray(data.retenciones_sufridas)) {
      const hasEnabled = data.retenciones_sufridas.some(
        (r: any) => r && (r.enabled === undefined ? true : !!r.enabled) && parseFloat(r.amount || '0') > 0
      );
      if (hasEnabled) {
        throw new ApiError(400, 'Los cobros Luna no admiten retenciones');
      }
    }

    // Sol/Luna: cross-circuit invoice application check.
    // Every invoice referenced in invoice_items must share the cobro's circuit.
    if (Array.isArray(data.invoice_items) && data.invoice_items.length > 0) {
      const invoiceIds = [...new Set(
        data.invoice_items
          .map((it: any) => it?.invoice_id)
          .filter((x: any) => typeof x === 'string' && x.length > 0)
      )] as string[];
      if (invoiceIds.length > 0) {
        const ftRes = await db.execute(sql`
          SELECT id, COALESCE(fiscal_type, 'fiscal') AS fiscal_type
          FROM invoices
          WHERE company_id = ${companyId} AND id = ANY(${invoiceIds as any})
        `);
        const ftRows = ((ftRes as any).rows || []);
        for (const r of ftRows) {
          const invFt = r.fiscal_type === 'no_fiscal' ? 'no_fiscal' : 'fiscal';
          if (invFt !== cobroFiscalType) {
            throw new ApiError(
              400,
              'No se puede aplicar un cobro a comprobantes de otro circuito'
            );
          }
        }
      }
    }

    // Auto-assign default business_unit_id if not provided
    if (!data.business_unit_id) {
      try {
        const buResult = await db.execute(sql`SELECT id FROM business_units WHERE company_id = ${companyId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
        const defaultBu = ((buResult as any).rows || [])[0];
        if (defaultBu) data.business_unit_id = defaultBu.id;
      } catch { /* no business units yet */ }
    }

    // PR7: cheques guardan el banco como string en cheque_data.bank (del dropdown nuevo),
    // no en bank_id (UUID). Solo transferencia top-level necesita bank_id UUID.
    // Si hay payment_methods array, cada metodo valida su propio bank_id/cheque_data.
    if (
      data.payment_method === 'transferencia' &&
      !data.bank_id &&
      !(Array.isArray(data.payment_methods) && data.payment_methods.length > 0)
    ) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia');
    }

    // B.1.2: Parse payment_methods with backward compat
    const paymentMethods: PaymentMethodInput[] = data.payment_methods
      ? data.payment_methods.map((pm: any) => ({
          method: pm.method,
          amount: parseFloat(pm.amount?.toString() || '0'),
          bank_id: pm.bank_id,
          reference: pm.reference,
          cheque_data: pm.cheque_data,
        }))
      : [{
          method: data.payment_method || 'efectivo',
          amount: parseFloat(data.amount?.toString() || '0'),
          bank_id: data.bank_id,
          reference: data.reference,
          cheque_data: data.cheque_data,
        }];

    // PR7-T5: validate each payment method individually (per-item) BEFORE inserts.
    // Antes solo se validaba el top-level, los items dentro del array entraban sin validar.
    for (const pm of paymentMethods) {
      if (pm.method === 'transferencia' && !pm.bank_id) {
        throw new ApiError(400, `Transferencia requiere bank_id`);
      }
      if (pm.method === 'cheque') {
        if (!pm.cheque_data) throw new ApiError(400, 'Cheque requiere cheque_data');
        const cd = pm.cheque_data;
        if (!cd.bank || !cd.number || !cd.drawer) {
          throw new ApiError(400, 'Cheque incompleto: bank/number/drawer requeridos');
        }
      }
    }

    // B.1.3: Total = sum of payment methods (payment methods define the amount received)
    const pmTotal = paymentMethods.reduce((s, pm) => s + pm.amount, 0);
    const cobroAmount = pmTotal; // The cobro amount IS the sum of payment methods

    // Defense-in-depth: the amount assigned to invoices can NEVER exceed the
    // amount actually received (payment methods + retenciones sufridas).
    // This prevents the "recibo $200k, aplicado $605k" bug where a receipt
    // appeared to cover the full invoice despite only partial cash entering.
    const retencionesTotal = data.retenciones_sufridas?.reduce(
      (s: number, r: any) => s + parseFloat(r.amount || '0'), 0
    ) || 0;
    const totalReceived = pmTotal + retencionesTotal;
    if (data.invoice_items && Array.isArray(data.invoice_items) && data.invoice_items.length > 0) {
      const assigned = data.invoice_items.reduce(
        (s: number, it: any) => s + parseFloat(it.amount || '0'), 0
      );
      if (assigned > totalReceived + 0.01) {
        throw new ApiError(
          400,
          `La suma aplicada a facturas ($${assigned.toFixed(2)}) no puede superar el total recibido ($${totalReceived.toFixed(2)})`
        );
      }
    }

    // B.1.4: summaryMethod for the cobro header
    const summaryMethod = paymentMethods.length === 1 ? paymentMethods[0].method : 'mixto';

    // Bug B fix: validar bank_id (top-level + por payment method) pertenezca a la company.
    // Previene IDOR donde un user de otra company referencia un banco ajeno.
    const bankIdsToCheck = new Set<string>();
    if (data.bank_id) bankIdsToCheck.add(data.bank_id);
    for (const pm of paymentMethods) {
      if (pm.bank_id) bankIdsToCheck.add(pm.bank_id);
    }
    for (const bankId of bankIdsToCheck) {
      const bankCheck = await db.execute(sql`
        SELECT id FROM banks WHERE id = ${bankId} AND company_id = ${companyId}
      `);
      if (((bankCheck as any).rows || []).length === 0) {
        throw new ApiError(400, `Banco ${bankId} no pertenece a esta empresa`);
      }
    }

    // Integridad financiera: si viene invoice_id legacy directo, validar que no este pagada.
    if (data.invoice_id) {
      const invCheck = await db.execute(sql`
        SELECT invoice_number, invoice_type, payment_status
        FROM invoices WHERE id = ${data.invoice_id} AND company_id = ${companyId}
      `);
      const invRow = ((invCheck as any).rows || [])[0];
      if (invRow && invRow.payment_status === 'pagado') {
        throw new ApiError(
          400,
          `La factura ${invRow.invoice_type} ${invRow.invoice_number} ya esta completamente pagada. No se pueden vincular mas cobros.`
        );
      }
    }

    try {
      const cobroId = uuid();
      // Check if invoice_items are provided (N:N linking to invoices)
      const hasInvoiceItems = data.invoice_items && Array.isArray(data.invoice_items) && data.invoice_items.length > 0;
      const pendingStatus = (data.invoice_id || hasInvoiceItems) ? null : 'pending_invoice';

      // Auto-generate receipt_number (sequential per company)
      const nextNumResult = await db.execute(sql`
        SELECT COALESCE(MAX(receipt_number), 0) + 1 as next_number FROM cobros WHERE company_id = ${companyId}
      `);
      const receiptNumber = parseInt(((nextNumResult as any).rows || [])[0]?.next_number || '1');

      // Transaction: all inserts succeed or all rollback
      await db.execute(sql`BEGIN`);
      try {

      const cobroCurrency = data.currency || 'ARS';
      let cobroExchangeRate: number | null = data.exchange_rate ? parseFloat(data.exchange_rate) : null;
      // PR3-T5: auto-fetch BCRA rate si moneda != ARS y no se paso manual.
      // Evita el bug de guardar NULL y despues `amount * null = NaN` en reports.
      if (cobroCurrency !== 'ARS' && (!cobroExchangeRate || !Number.isFinite(cobroExchangeRate))) {
        try {
          const { currencyService } = await import('../currency/currency.service');
          const dateStr = data.payment_date ? String(data.payment_date).slice(0, 10) : undefined;
          cobroExchangeRate = await currencyService.getExchangeRate(cobroCurrency, dateStr);
        } catch (e) {
          throw new ApiError(
            400,
            `No se pudo obtener cotizacion BCRA para ${cobroCurrency}. Ingresa el tipo de cambio manualmente.`
          );
        }
      }

      // Calculate total_amount = payment methods sum + retenciones sufridas
      const totalRetenciones = data.retenciones_sufridas?.reduce((s: number, r: any) => s + parseFloat(r.amount), 0) || 0;
      const receiptAmount = pmTotal; // Use payment methods sum, not data.amount
      const totalAmount = receiptAmount + totalRetenciones;

      await db.execute(sql`
        INSERT INTO cobros (id, company_id, enterprise_id, order_id, invoice_id, amount, total_amount, payment_method, bank_id, reference, payment_date, notes, receipt_image, business_unit_id, pending_status, receipt_number, created_by, currency, exchange_rate, fiscal_type)
        VALUES (${cobroId}, ${companyId}, ${data.enterprise_id || null}, ${data.order_id || null}, ${data.invoice_id || null}, ${receiptAmount.toString()}, ${totalAmount.toString()}, ${summaryMethod}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${data.receipt_image || null}, ${data.business_unit_id || null}, ${pendingStatus}, ${receiptNumber}, ${userId}, ${cobroCurrency}, ${cobroExchangeRate}, ${cobroFiscalType})
      `);

      // B.1.4: Insert receipt_payment_methods for each payment method
      for (const pm of paymentMethods) {
        await db.execute(sql`
          INSERT INTO receipt_payment_methods (cobro_id, method, amount, bank_id, reference, cheque_data)
          VALUES (${cobroId}, ${pm.method}, ${pm.amount}, ${pm.bank_id || null}, ${pm.reference || null},
                  ${pm.cheque_data ? JSON.stringify(pm.cheque_data) : null}::jsonb)
        `);
      }

      // Create retenciones sufridas linked to this cobro
      if (data.retenciones_sufridas && Array.isArray(data.retenciones_sufridas) && data.retenciones_sufridas.length > 0) {
        const enterpriseId = data.enterprise_id || null;
        const retencionDate = data.payment_date || new Date().toISOString();
        for (const ret of data.retenciones_sufridas) {
          // C8: sanity check para retenciones (IIBB / Ganancias / IVA).
          // Rates tipicos AR: IIBB 0-5%, Ganancias 0-6%, IVA 0-21%.
          // Si rate > 30% o base_amount <= 0, algo esta mal — loguear warning.
          // La tabla por jurisdiccion queda diferida a futuro PR.
          const rate = parseFloat(ret.rate || '0');
          const baseAmount = parseFloat(ret.base_amount || '0');
          const amount = parseFloat(ret.amount || '0');
          if (!Number.isFinite(rate) || rate < 0 || rate > 30) {
            console.warn(`[retencion ${ret.type}] rate fuera de rango esperado [0-30%]: ${rate}% — cobroId=${cobroId}`);
          }
          if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
            throw new ApiError(400, `Retencion ${ret.type}: base_amount invalido (${ret.base_amount})`);
          }
          if (!Number.isFinite(amount) || amount < 0) {
            throw new ApiError(400, `Retencion ${ret.type}: amount invalido (${ret.amount})`);
          }
          // Sanity: amount no deberia exceder base_amount * 1.1 (10% margen por redondeo)
          if (amount > baseAmount * 1.1) {
            throw new ApiError(
              400,
              `Retencion ${ret.type}: el amount ($${amount}) excede el base_amount ($${baseAmount})`
            );
          }

          await db.execute(sql`
            INSERT INTO retenciones (id, company_id, type, enterprise_id, cobro_id, base_amount, rate, amount, certificate_file, date, created_by, direction)
            VALUES (gen_random_uuid(), ${companyId}, ${ret.type}, ${enterpriseId}, ${cobroId}, ${baseAmount.toString()}, ${rate.toString()}, ${amount.toString()}, ${ret.certificate_file || null}, ${retencionDate}, ${userId}, 'sufrida')
          `);
        }
      }

      // B.1.5: Create cheques for each payment method that is cheque.
      // Bug A fix: usar las columnas reales de la tabla cheques (number, bank, drawer,
      // drawer_cuit, cheque_type, due_date) en vez de los nombres legacy inexistentes
      // (cheque_number, bank_name, issuer_name, issuer_cuit, payment_date, tipo).
      // Mirror del INSERT correcto en receipts.service.ts:280.
      for (const pm of paymentMethods) {
        if (pm.method === 'cheque' && pm.cheque_data) {
          const cd = pm.cheque_data;
          await db.execute(sql`
            INSERT INTO cheques (
              id, company_id, number, bank, drawer, drawer_cuit, cheque_type,
              amount, issue_date, due_date, status, cobro_id, business_unit_id, created_by
            )
            VALUES (
              ${uuid()}, ${companyId}, ${cd.number}, ${cd.bank}, ${cd.drawer},
              ${cd.drawer_cuit || null}, ${cd.cheque_type || 'comun'},
              ${pm.amount.toString()},
              ${new Date(cd.issue_date)}, ${new Date(cd.due_date)},
              'a_cobrar', ${cobroId}, ${data.business_unit_id || null}, ${userId}
            )
          `);
        }
      }

      // Create cobro_invoice_applications entries (N:N cobro↔invoice)
      if (hasInvoiceItems) {
        // Group by invoice_id to calculate total per invoice
        const invoiceTotals = new Map<string, number>();

        for (const item of data.invoice_items) {
          if (!item.invoice_id) continue;

          if (item.amount && parseFloat(item.amount) > 0) {
            const current = invoiceTotals.get(item.invoice_id) || 0;
            invoiceTotals.set(item.invoice_id, current + parseFloat(item.amount));
          }
        }

        // Bug B fix: validar cada factura DENTRO de la transaccion con FOR UPDATE.
        // Esto previene la race condition donde dos cobros concurrentes pagaban
        // la misma factura dos veces. Tambien valida tenant, status, NC, balance.
        const NC_TYPES = ['NC_A', 'NC_B', 'NC_C', 'NC_E'];
        for (const [invoiceId, applyAmount] of invoiceTotals.entries()) {
          const invCheck = await db.execute(sql`
            SELECT id, enterprise_id, business_unit_id, status, payment_status,
                   invoice_type, invoice_number, total_amount, currency
            FROM invoices
            WHERE id = ${invoiceId} AND company_id = ${companyId}
            FOR UPDATE
          `);
          const invRow = ((invCheck as any).rows || [])[0];
          if (!invRow) {
            throw new ApiError(404, `Factura ${invoiceId} no encontrada`);
          }

          // V1: invoice not cancelled
          if (invRow.status === 'cancelled') {
            throw new ApiError(400, `No se puede vincular cobro a factura cancelada (${invRow.invoice_number})`);
          }

          // V2: not a credit note
          if (invRow.invoice_type && NC_TYPES.includes(invRow.invoice_type)) {
            throw new ApiError(400, `No se pueden aplicar cobros a Notas de Credito (${invRow.invoice_type} ${invRow.invoice_number})`);
          }

          // V3: same enterprise (tenant + IDOR)
          if (data.enterprise_id && invRow.enterprise_id && invRow.enterprise_id !== data.enterprise_id) {
            throw new ApiError(400, `La factura ${invRow.invoice_number} pertenece a otro cliente`);
          }

          // V4: same business unit
          if (data.business_unit_id && invRow.business_unit_id && invRow.business_unit_id !== data.business_unit_id) {
            throw new ApiError(400, `La factura ${invRow.invoice_number} pertenece a otra razon social`);
          }

          // V5: not already fully paid
          if (invRow.payment_status === 'pagado') {
            throw new ApiError(
              400,
              `La factura ${invRow.invoice_type} ${invRow.invoice_number} ya esta completamente pagada. No se pueden vincular mas cobros.`
            );
          }

          // V6: do not exceed remaining balance.
          // remaining = total - sum(applied de cobros NO anulados) - sum(retenciones sufridas NO anuladas)
          const balanceRes = await db.execute(sql`
            SELECT
              CAST(${invRow.total_amount} AS decimal) as total,
              COALESCE((
                SELECT SUM(CAST(cia.amount_applied AS decimal))
                FROM cobro_invoice_applications cia
                JOIN cobros c ON c.id = cia.cobro_id
                WHERE cia.invoice_id = ${invoiceId}
                  AND (c.status IS NULL OR c.status != 'anulado')
              ), 0) as applied_cash,
              COALESCE((
                SELECT SUM(CAST(r.amount AS decimal))
                FROM retenciones r
                LEFT JOIN cobros c2 ON c2.id = r.cobro_id
                WHERE r.invoice_id = ${invoiceId}
                  AND r.direction = 'sufrida'
                  AND (c2.status IS NULL OR c2.status != 'anulado')
              ), 0) as retenciones_total
          `);
          const balRow = ((balanceRes as any).rows || [])[0];
          const totalInv = parseFloat(balRow?.total || '0');
          const alreadyApplied = parseFloat(balRow?.applied_cash || '0') + parseFloat(balRow?.retenciones_total || '0');
          const remaining = totalInv - alreadyApplied;
          if (applyAmount > remaining + 0.01) {
            throw new ApiError(
              400,
              `La factura ${invRow.invoice_number} solo tiene $${remaining.toFixed(2)} pendiente. Estas intentando aplicar $${applyAmount.toFixed(2)}.`
            );
          }
        }

        // Create invoice-level applications from totals + cascade to orders.
        // Bug B fix: removido ON CONFLICT DO NOTHING — silenciaba re-bindings.
        // Las validaciones de arriba previenen duplicados legitimos.
        for (const [invoiceId, totalAmount] of invoiceTotals.entries()) {
          await db.execute(sql`
            INSERT INTO cobro_invoice_applications (id, cobro_id, invoice_id, amount_applied, created_by)
            VALUES (${uuid()}, ${cobroId}, ${invoiceId}, ${totalAmount.toString()}, ${userId})
          `);
          // Cascade: recalculate invoice → then order
          await this.recalculateInvoicePaymentStatus(invoiceId);
          await this.recalculateOrderStatusFromInvoice(invoiceId);
        }
      }

      // Legacy: insert cobro_items for partial payments by order_item
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        for (const item of data.items) {
          if (!item.order_item_id || !item.amount_paid || Number(item.amount_paid) <= 0) continue;
          await db.execute(sql`
            INSERT INTO cobro_items (id, cobro_id, order_item_id, amount_paid)
            VALUES (${uuid()}, ${cobroId}, ${item.order_item_id}, ${Number(item.amount_paid).toString()})
          `);
        }
      }

      await db.execute(sql`COMMIT`);
      } catch (txError) {
        try { await db.execute(sql`ROLLBACK`); } catch (e) { /* rollback best-effort */ }
        throw txError;
      }

      // Sol/Luna: lock every unique order derived from applied invoices.
      // Idempotent — safe even if the order is already locked.
      try {
        const orderIdsToLock = new Set<string>();
        if (Array.isArray(data.invoice_items) && data.invoice_items.length > 0) {
          const invoiceIds = [...new Set(
            data.invoice_items.map((it: any) => it?.invoice_id).filter((x: any) => !!x)
          )] as string[];
          if (invoiceIds.length > 0) {
            const ordRes = await db.execute(sql`
              SELECT DISTINCT order_id FROM (
                SELECT order_id FROM invoices WHERE id = ANY(${invoiceIds as any}) AND order_id IS NOT NULL
                UNION
                SELECT order_id FROM invoice_orders WHERE invoice_id = ANY(${invoiceIds as any})
              ) sub WHERE order_id IS NOT NULL
            `);
            for (const r of ((ordRes as any).rows || [])) {
              if (r.order_id) orderIdsToLock.add(r.order_id);
            }
          }
        }
        if (data.order_id) orderIdsToLock.add(data.order_id);
        for (const oid of orderIdsToLock) {
          try {
            await ordersService.lockOrder(oid, 'cobro aplicado', userId);
          } catch (e) {
            console.warn('[createCobro] lockOrder failed for', oid, (e as Error).message);
          }
        }
      } catch (e) {
        console.warn('[createCobro] lockOrder derivation failed:', (e as Error).message);
      }

      // Accounting entry
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        await accountingEntriesService.createEntryForCobro({
          id: cobroId,
          company_id: companyId,
          date: data.payment_date || new Date().toISOString(),
          amount: pmTotal,
          payment_method: summaryMethod,
          bank_id: data.bank_id,
          pending_status: pendingStatus,
          // Sol/Luna: thread circuit + payment method breakdown so the
          // entry hits the right chart-of-accounts lanes (caja vs banco).
          fiscal_type: cobroFiscalType,
          payment_methods: paymentMethods.map((pm) => ({
            method: pm.method,
            amount: pm.amount,
            bank_id: pm.bank_id || null,
          })),
        });
      } catch (accErr) { console.warn('Accounting entry skipped (cobro):', (accErr as Error).message); }

      const result = await db.execute(sql`
        SELECT c.*, e.name as enterprise_name, o.order_number, b.bank_name
        FROM cobros c
        LEFT JOIN enterprises e ON c.enterprise_id = e.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN banks b ON c.bank_id = b.id
        WHERE c.id = ${cobroId}
      `);
      const rows = (result as any).rows || result || [];
      const cobro = rows[0];

      // CRM Pipeline sync: check if fully paid, then trigger payment_received
      try {
        // Check if the linked order/invoice is now fully paid
        let isFullyPaid = false;
        if (data.order_id) {
          const orderPayStatus = await db.execute(sql`
            SELECT payment_status FROM orders WHERE id = ${data.order_id}
          `);
          const ps = ((orderPayStatus as any).rows || [])[0]?.payment_status;
          isFullyPaid = ps === 'pagado';
        }

        if (isFullyPaid) {
          // If order has an invoice, also link cobro to deal via invoice
          if (data.order_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.order_id, 'order');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }
          if (data.invoice_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.invoice_id, 'invoice');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }

          await crmSyncService.handleEvent({
            companyId,
            event: 'payment_received',
            enterpriseId: data.enterprise_id || undefined,
            documentId: cobroId,
            documentType: 'cobro',
            metadata: { amount: parseFloat(data.amount || '0') },
          });
        } else {
          // Partial payment: still link cobro to deal but don't trigger stage move
          if (data.order_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.order_id, 'order');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }
          if (data.invoice_id) {
            const existingDeal = await crmSyncService.findDealByRelatedDocument(companyId, data.invoice_id, 'invoice');
            if (existingDeal) {
              await crmSyncService.linkDocumentToDeal(existingDeal.id, 'cobro', cobroId);
            }
          }
        }
      } catch (e) { console.error('CRM sync error (cobro_created):', e); }

      return cobro;
    } catch (error) {
      console.error('Create cobro error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create cobro');
    }
  }

  /**
   * PR7-T5: Anular cobro (soft delete) en vez de DELETE fisico.
   *
   * Fraude interno: si un empleado podia DELETE un cobro legitimo, podia
   * robar el dinero y que no quede rastro. Ahora:
   * - status = 'anulado'
   * - anulled_at, anulled_by, anulled_reason persistidos (audit trail)
   * - cobro_invoice_applications se preservan (no CASCADE DELETE)
   * - recalculateInvoicePaymentStatus excluye cobros anulados al sumar
   * - La row sigue visible en /api/cobros con badge "Anulado"
   */
  async deleteCobro(companyId: string, cobroId: string, userId?: string, reason?: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id, order_id, company_id, status
        FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Cobro not found');

      // Idempotencia: si ya esta anulado, no fallar, solo avisar
      if (rows[0].status === 'anulado') {
        throw new ApiError(400, 'Este cobro ya esta anulado');
      }

      const cobroForAccounting: any = rows[0];

      // Transaction: anular + get linked invoices atomicamente
      let invoiceIds: string[] = [];
      await db.execute(sql`BEGIN`);
      try {
        // Get linked invoices ANTES de anular (para recalcular)
        const linkedInvoices = await db.execute(sql`
          SELECT invoice_id FROM cobro_invoice_applications WHERE cobro_id = ${cobroId}
        `);
        invoiceIds = ((linkedInvoices as any).rows || []).map((r: any) => r.invoice_id);

        // PR7-T5: SOFT DELETE — UPDATE status en vez de DELETE fisico
        // Las cobro_invoice_applications se mantienen (audit trail),
        // pero recalculateInvoicePaymentStatus las excluye via JOIN con cobro status.
        await db.execute(sql`
          UPDATE cobros
          SET status = 'anulado',
              anulled_at = NOW(),
              anulled_by = ${userId || null},
              anulled_reason = ${reason || null}
          WHERE id = ${cobroId} AND company_id = ${companyId}
        `);

        // Marcar cheques asociados como anulados tambien (si no fueron endosados)
        await db.execute(sql`
          UPDATE cheques SET status = 'anulado'
          WHERE cobro_id = ${cobroId} AND status = 'a_cobrar'
        `);

        await db.execute(sql`COMMIT`);
      } catch (txError) {
        try { await db.execute(sql`ROLLBACK`); } catch (e) { /* rollback best-effort */ }
        throw txError;
      }

      // Recalcular payment_status de facturas afectadas (ahora excluyendo cobros anulados)
      for (const invId of invoiceIds) {
        await this.recalculateInvoicePaymentStatus(invId);
        await this.recalculateOrderStatusFromInvoice(invId);
      }

      // Sol/Luna: unlock affected orders (cascade-aware).
      try {
        const affectedOrders = new Set<string>();
        if (invoiceIds.length > 0) {
          const ordRes = await db.execute(sql`
            SELECT DISTINCT order_id FROM (
              SELECT order_id FROM invoices WHERE id = ANY(${invoiceIds as any}) AND order_id IS NOT NULL
              UNION
              SELECT order_id FROM invoice_orders WHERE invoice_id = ANY(${invoiceIds as any})
            ) sub WHERE order_id IS NOT NULL
          `);
          for (const r of ((ordRes as any).rows || [])) {
            if (r.order_id) affectedOrders.add(r.order_id);
          }
        }
        if (cobroForAccounting?.order_id) affectedOrders.add(cobroForAccounting.order_id);
        for (const oid of affectedOrders) {
          try {
            await ordersService.unlockOrder(oid);
          } catch (e) {
            console.warn('[anularCobro] unlockOrder failed for', oid, (e as Error).message);
          }
        }
      } catch (e) {
        console.warn('[anularCobro] unlockOrder derivation failed:', (e as Error).message);
      }

      // Accounting reversal entry
      if (cobroForAccounting) {
        try {
          const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
          await accountingEntriesService.createReverseEntry(cobroForAccounting.company_id, 'cobro', cobroId);
        } catch (accErr) { console.warn('Accounting reversal skipped (cobro):', (accErr as Error).message); }
      }

      return { success: true, status: 'anulado' };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to anular cobro');
    }
  }

  private async recalculateInvoicePaymentStatus(invoiceId: string) {
    try {
      // Bug C fix: incluir retenciones sufridas en el calculo de "applied".
      // Antes: solo sumaba cobro_invoice_applications.amount_applied y dejaba
      // facturas como "parcial" para siempre (ej. $100k cash + $21k retencion en
      // factura $121k). Ahora suma cash + retenciones (no anuladas).
      //
      // Las retenciones se vinculan a la factura por dos caminos:
      //   1. Directo: retenciones.invoice_id = invoiceId
      //   2. Via cobro: retenciones.cobro_id -> cobro_invoice_applications.invoice_id
      // Hacemos UNION para cubrir ambos casos sin doble-contar.
      //
      // PR7-T5: cobros anulados (c.status='anulado') quedan excluidos.
      const result = await db.execute(sql`
        SELECT
          CAST(i.total_amount AS decimal) as total,
          COALESCE((
            SELECT SUM(CAST(cia.amount_applied AS decimal))
            FROM cobro_invoice_applications cia
            JOIN cobros c ON c.id = cia.cobro_id
            WHERE cia.invoice_id = i.id
              AND (c.status IS NULL OR c.status != 'anulado')
          ), 0) as applied_cash,
          COALESCE((
            SELECT SUM(CAST(r.amount AS decimal))
            FROM (
              SELECT DISTINCT r1.id, r1.amount
              FROM retenciones r1
              LEFT JOIN cobros c2 ON c2.id = r1.cobro_id
              WHERE r1.direction = 'sufrida'
                AND (c2.status IS NULL OR c2.status != 'anulado')
                AND (
                  r1.invoice_id = i.id
                  OR r1.cobro_id IN (
                    SELECT cia2.cobro_id FROM cobro_invoice_applications cia2
                    WHERE cia2.invoice_id = i.id
                  )
                )
            ) r
          ), 0) as retenciones_total
        FROM invoices i
        WHERE i.id = ${invoiceId}
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const total = parseFloat(row.total);
      const appliedCash = parseFloat(row.applied_cash || '0');
      const retencionesTotal = parseFloat(row.retenciones_total || '0');
      const applied = appliedCash + retencionesTotal;

      // Epsilon de 1 centavo para evitar bugs de float (0.01 tolerance).
      let status = 'pendiente';
      if (total > 0 && applied + 0.01 >= total) status = 'pagado';
      else if (applied > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE invoices SET payment_status = ${status} WHERE id = ${invoiceId}
      `);
    } catch (error) {
      console.warn('Recalculate invoice payment status error:', error);
    }
  }

  /**
   * Get order_id from an invoice and recalculate the order's payment_status
   * using the CORRECT system (cobro_invoice_applications, not cobros.order_id).
   */
  private async recalculateOrderStatusFromInvoice(invoiceId: string) {
    try {
      // Get all order_ids linked to this invoice (invoice_orders N:N + legacy invoices.order_id)
      const orderIdsResult = await db.execute(sql`
        SELECT order_id FROM invoice_orders WHERE invoice_id = ${invoiceId}
        UNION
        SELECT order_id FROM invoices WHERE id = ${invoiceId} AND order_id IS NOT NULL
      `);
      const orderIds = ((orderIdsResult as any).rows || []).map((r: any) => r.order_id).filter(Boolean);
      if (orderIds.length === 0) return;

      for (const orderId of orderIds) {
        const result = await db.execute(sql`
          SELECT
            CAST(o.total_amount AS decimal) as order_total,
            COALESCE(SUM(CAST(cia.amount_applied AS decimal)), 0) as total_paid
          FROM orders o
          LEFT JOIN invoices i ON (i.order_id = o.id OR i.id IN (SELECT io.invoice_id FROM invoice_orders io WHERE io.order_id = o.id)) AND i.status != 'cancelled'
          LEFT JOIN cobro_invoice_applications cia ON cia.invoice_id = i.id
          WHERE o.id = ${orderId}
          GROUP BY o.id, o.total_amount
        `);
        const row = ((result as any).rows || [])[0];
        if (!row) continue;

        const orderTotal = parseFloat(row.order_total);
        const totalPaid = parseFloat(row.total_paid);

        let status = 'pendiente';
        if (totalPaid >= orderTotal && orderTotal > 0) status = 'pagado';
        else if (totalPaid > 0) status = 'parcial';

        await db.execute(sql`UPDATE orders SET payment_status = ${status} WHERE id = ${orderId}`);
      }
    } catch (error) {
      console.warn('Recalculate order status from invoice error:', error);
    }
  }

  /** @deprecated Use recalculateOrderStatusFromInvoice instead. Legacy cobro_items path. */
  async recalculateOrderPaymentStatus(orderId: string) {
    try {
      const itemPaidResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(ci.amount_paid AS decimal)), 0) as total
        FROM cobro_items ci JOIN cobros c ON ci.cobro_id = c.id
        WHERE c.order_id = ${orderId}
      `);
      const totalItemPaid = parseFloat(((itemPaidResult as any).rows || itemPaidResult)?.[0]?.total || '0');

      const genericResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(c.amount AS decimal)), 0) as total
        FROM cobros c
        WHERE c.order_id = ${orderId}
          AND NOT EXISTS (SELECT 1 FROM cobro_items ci WHERE ci.cobro_id = c.id)
      `);
      const totalGeneric = parseFloat(((genericResult as any).rows || genericResult)?.[0]?.total || '0');

      const totalPaid = totalItemPaid + totalGeneric;

      const orderResult = await db.execute(sql`
        SELECT CAST(total_amount AS decimal) as total FROM orders WHERE id = ${orderId}
      `);
      const orderTotal = parseFloat(((orderResult as any).rows || orderResult)?.[0]?.total || '0');

      let status = 'pendiente';
      if (totalPaid >= orderTotal && orderTotal > 0) status = 'pagado';
      else if (totalPaid > 0) status = 'parcial';

      // Also propagate payment_method from most recent cobro
      const latestCobroResult = await db.execute(sql`
        SELECT payment_method FROM cobros
        WHERE order_id = ${orderId}
        ORDER BY payment_date DESC, created_at DESC LIMIT 1
      `);
      const latestMethod = ((latestCobroResult as any).rows || latestCobroResult)?.[0]?.payment_method || null;

      await db.execute(sql`
        UPDATE orders SET
          payment_status = ${status},
          payment_method = COALESCE(${latestMethod}, payment_method)
        WHERE id = ${orderId}
      `);
    } catch (error) {
      console.warn('Recalculate payment status error:', error);
    }
  }

  async getOrderPaymentDetails(companyId: string, orderId: string) {
    await this.ensureTables();
    try {
      const orderCheck = await db.execute(sql`
        SELECT id, CAST(total_amount AS decimal) as total_amount
        FROM orders WHERE id = ${orderId} AND company_id = ${companyId}
      `);
      const orderRows = (orderCheck as any).rows || orderCheck || [];
      if (orderRows.length === 0) throw new ApiError(404, 'Order not found');

      const items = await db.execute(sql`
        SELECT oi.id as order_item_id, oi.product_name, oi.description,
          CAST(oi.quantity AS decimal) as quantity,
          CAST(oi.unit_price AS decimal) as unit_price,
          CAST(oi.subtotal AS decimal) as subtotal,
          COALESCE((SELECT SUM(CAST(ci.amount_paid AS decimal)) FROM cobro_items ci WHERE ci.order_item_id = oi.id), 0) as total_paid
        FROM order_items oi WHERE oi.order_id = ${orderId} ORDER BY oi.created_at
      `);
      const itemRows = (items as any).rows || items || [];

      const cobros = await db.execute(sql`
        SELECT c.id, c.amount, c.payment_method, c.payment_date, c.reference, c.notes,
          (SELECT COUNT(*) FROM cobro_items ci WHERE ci.cobro_id = c.id) as item_count
        FROM cobros c WHERE c.order_id = ${orderId} ORDER BY c.payment_date DESC
      `);
      const cobroRows = (cobros as any).rows || cobros || [];

      const orderTotal = parseFloat(orderRows[0].total_amount || '0');
      const totalItemPaid = itemRows.reduce((s: number, it: any) => s + parseFloat(it.total_paid || '0'), 0);
      const totalGeneric = cobroRows.filter((c: any) => parseInt(c.item_count) === 0).reduce((s: number, c: any) => s + parseFloat(c.amount || '0'), 0);

      return {
        order_total: orderTotal,
        total_paid: totalItemPaid + totalGeneric,
        remaining: Math.max(0, orderTotal - totalItemPaid - totalGeneric),
        items: itemRows.map((it: any) => ({
          ...it,
          quantity: parseFloat(it.quantity),
          unit_price: parseFloat(it.unit_price),
          subtotal: parseFloat(it.subtotal),
          total_paid: parseFloat(it.total_paid),
          remaining: Math.max(0, parseFloat(it.subtotal) - parseFloat(it.total_paid)),
        })),
        cobros: cobroRows,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get order payment details');
    }
  }

  async getCobroReceipt(companyId: string, cobroId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT receipt_image FROM cobros WHERE id = ${cobroId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cobro not found');
      if (!rows[0].receipt_image) throw new ApiError(404, 'No receipt found');
      return { receipt_image: rows[0].receipt_image };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get receipt');
    }
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_cobrado, COUNT(*) as count
        FROM cobros WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_cobrado: parseFloat(rows[0]?.total_cobrado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get cobros summary');
    }
  }
}

export const cobrosService = new CobrosService();
