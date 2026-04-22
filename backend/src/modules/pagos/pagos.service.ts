import { db, pool, tryMig } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { retencionesService } from '../retenciones/retenciones.service';

interface PaymentMethodInput {
  method: string;
  amount: number;
  bank_id?: string | null;
  reference?: string | null;
  cheque_data?: {
    number: string;
    bank: string;
    drawer: string;
    drawer_cuit?: string | null;
    issue_date: string;
    due_date: string;
    cheque_type?: string;
  };
}

interface RetencionInput {
  type: string;
  regime?: string | null;
  rate: number | string;
  base_amount: number | string;
  amount: number | string;
  certificate_number?: string | null;
  jurisdiction?: 'caba' | 'pba' | 'otra' | null;
  purchase_invoice_id?: string | null;
}

const VALID_RET_TYPES = ['iibb', 'ganancias', 'iva', 'suss'];

export class PagosService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pagos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          enterprise_id UUID REFERENCES enterprises(id),
          purchase_id UUID REFERENCES purchases(id),
          amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          notes TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // PR7-T20/Bug C1: parity with cobros soft-delete (anulado) audit trail.
      await tryMig(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'activo'`, 'pagos.status');
      await tryMig(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS anulled_at TIMESTAMPTZ`, 'pagos.anulled_at');
      await tryMig(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS anulled_by UUID REFERENCES users(id)`, 'pagos.anulled_by');
      await tryMig(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS anulled_reason TEXT`, 'pagos.anulled_reason');
      await tryMig(`CREATE INDEX IF NOT EXISTS idx_pagos_company_status ON pagos(company_id, status)`, 'idx_pagos_company_status');

      // FLOW 46/Bug A: cheques outgoing support.
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS direction VARCHAR(20) DEFAULT 'recibido'`, 'cheques.direction (pagos.ensureTables)');
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS pago_id UUID REFERENCES pagos(id) ON DELETE SET NULL`, 'cheques.pago_id');
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL`, 'cheques.enterprise_id');

      await tryMig(
        `CREATE TABLE IF NOT EXISTS pago_payment_methods (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pago_id UUID NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
          method VARCHAR(50) NOT NULL,
          amount DECIMAL(12,2) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          cheque_data JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )`,
        'pago_payment_methods table'
      );

      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure pagos tables error:', error);
    }
  }

  async getPagos(companyId: string, filters: { enterprise_id?: string; business_unit_id?: string } = {}) {
    await this.ensureTables();
    try {
      let whereClause = sql`p.company_id = ${companyId}`;
      if (filters.business_unit_id) {
        // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
        whereClause = sql`${whereClause} AND (p.business_unit_id = ${filters.business_unit_id} OR p.business_unit_id IS NULL)`;
      }
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
      }

      const result = await db.execute(sql`
        SELECT p.*,
          COALESCE(p.total_amount, CAST(p.amount AS decimal)) as total_amount,
          e.name as enterprise_name,
          e.cuit as enterprise_cuit,
          pu.purchase_number,
          b.bank_name,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', pia.id,
              'purchase_invoice_id', pia.purchase_invoice_id,
              'amount', pia.amount_applied,
              'invoice_number', pi.invoice_number,
              'invoice_type', pi.invoice_type,
              'invoice_total', pi.total_amount
            ))
            FROM pago_invoice_applications pia
            JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
            WHERE pia.pago_id = p.id
          ), '[]'::json) as linked_purchase_invoices,
          COALESCE((SELECT SUM(CAST(pia2.amount_applied AS decimal)) FROM pago_invoice_applications pia2 WHERE pia2.pago_id = p.id), 0) as total_assigned,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          COALESCE((SELECT json_agg(json_build_object('id',ret.id,'type',ret.type,'rate',ret.rate,'amount',ret.amount,'regime',ret.regime,'jurisdiction',ret.jurisdiction,'certificate_number',ret.certificate_number,'purchase_invoice_id',ret.purchase_invoice_id))
            FROM retenciones ret WHERE ret.pago_id = p.id),'[]'::json) as retenciones
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY p.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error: any) {
      console.error('[getPagos] SQL error:', error?.message, error?.stack);
      throw new ApiError(500, 'Failed to get pagos');
    }
  }

  /**
   * Validate a retencion payload structurally (no DB access).
   * Bug C5 fix: explicit retenciones sent via createPago must pass the same
   * bounds/jurisdiction/amount checks that retencionesService.createRetention
   * enforces. Previously the bulk INSERT path bypassed them entirely.
   */
  private validateRetentionStructure(ret: RetencionInput): void {
    if (!ret || !ret.type || !VALID_RET_TYPES.includes(ret.type)) {
      throw new ApiError(400, `Tipo de retencion invalido. Tipos validos: ${VALID_RET_TYPES.join(', ')}`);
    }
    const rate = Number(ret.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new ApiError(400, 'Alicuota de retencion invalida (debe estar entre 0 y 100)');
    }
    const base = Number(ret.base_amount);
    if (!Number.isFinite(base) || base <= 0) {
      throw new ApiError(400, 'Monto base de retencion invalido');
    }
    const amount = Number(ret.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new ApiError(400, 'Monto de retencion invalido');
    }
    const expected = base * rate / 100;
    const tolerance = Math.max(0.01, expected * 0.01);
    if (Math.abs(amount - expected) > tolerance) {
      throw new ApiError(
        400,
        `Monto de retencion inconsistente. Esperado ~${expected.toFixed(2)}, recibido ${amount.toFixed(2)}`
      );
    }
    if (ret.type === 'iibb' && !ret.jurisdiction) {
      throw new ApiError(400, 'Retenciones IIBB requieren jurisdiccion (caba, pba, otra)');
    }
    if (ret.jurisdiction && !['caba', 'pba', 'otra'].includes(ret.jurisdiction)) {
      throw new ApiError(400, `Jurisdiccion invalida: ${ret.jurisdiction}`);
    }
  }

  async createPago(companyId: string, userId: string, data: any) {
    await this.ensureTables();

    // Auto-assign default business_unit_id if not provided
    if (!data.business_unit_id) {
      try {
        const buResult = await db.execute(sql`SELECT id FROM business_units WHERE company_id = ${companyId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
        const defaultBu = ((buResult as any).rows || [])[0];
        if (defaultBu) data.business_unit_id = defaultBu.id;
      } catch { /* no business units yet */ }
    }

    if (
      data.payment_method === 'transferencia' &&
      !data.bank_id &&
      !(Array.isArray(data.payment_methods) && data.payment_methods.length > 0)
    ) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia');
    }

    // Parse payment methods (pure, no DB).
    const paymentMethods: PaymentMethodInput[] = Array.isArray(data.payment_methods) && data.payment_methods.length > 0
      ? data.payment_methods.map((pm: any) => ({
          method: pm.method,
          amount: parseFloat(pm.amount?.toString() || '0'),
          bank_id: pm.bank_id || null,
          reference: pm.reference || null,
          cheque_data: pm.cheque_data,
        }))
      : [{
          method: data.payment_method || 'efectivo',
          amount: parseFloat(data.amount?.toString() || '0'),
          bank_id: data.bank_id || null,
          reference: data.reference || null,
          cheque_data: data.cheque_data,
        }];

    // H18 fix: the frontend sends 'cheque_emitido' for outgoing own cheques while
    // older callers send plain 'cheque'. Treat both as the same emitido-cheque path
    // here so validation + cheque-row insertion below both fire correctly.
    const isChequeEmitidoMethod = (m: string) => m === 'cheque' || m === 'cheque_emitido';

    for (const pm of paymentMethods) {
      if (!pm.method) throw new ApiError(400, 'Cada metodo de pago requiere un campo "method"');
      if (!Number.isFinite(pm.amount) || pm.amount <= 0) {
        throw new ApiError(400, `Monto invalido para metodo ${pm.method}`);
      }
      if (pm.method === 'transferencia' && !pm.bank_id) {
        throw new ApiError(400, 'Transferencia requiere bank_id');
      }
      if (isChequeEmitidoMethod(pm.method)) {
        if (!pm.cheque_data) throw new ApiError(400, 'Cheque requiere cheque_data');
        const cd = pm.cheque_data;
        if (!cd.bank || !cd.number || !cd.drawer) {
          throw new ApiError(400, 'Cheque incompleto: bank/number/drawer requeridos');
        }
        if (!cd.issue_date || !cd.due_date) {
          throw new ApiError(400, 'Cheque incompleto: issue_date/due_date requeridos');
        }
      }
    }

    const pmTotal = paymentMethods.reduce((s, pm) => s + pm.amount, 0);
    const pagoAmount = Array.isArray(data.payment_methods) && data.payment_methods.length > 0
      ? pmTotal
      : parseFloat(data.amount?.toString() || '0');
    const summaryMethod = paymentMethods.length === 1 ? paymentMethods[0].method : 'mixto';

    // Collect purchase invoice items
    const hasInvoiceItems = data.purchase_invoice_items && Array.isArray(data.purchase_invoice_items) && data.purchase_invoice_items.length > 0;
    const pendingStatus = hasInvoiceItems ? null : 'pending_invoice';

    type PiTotalEntry = { amount: number };
    const piTotals = new Map<string, PiTotalEntry>();
    if (hasInvoiceItems) {
      for (const item of data.purchase_invoice_items) {
        if (!item.purchase_invoice_id) continue;
        const amt = parseFloat(item.amount || '0');
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const current = piTotals.get(item.purchase_invoice_id)?.amount || 0;
        piTotals.set(item.purchase_invoice_id, { amount: current + amt });
      }
    }

    // Bug C3/C5: validate explicit retenciones BEFORE any DB work and assign
    // purchase_invoice_id per retencion. If user did not specify a target
    // invoice, fall back to the unique invoice being paid; otherwise require
    // the caller to be explicit (avoids silent misallocation).
    const hasExplicitRetenciones = Array.isArray(data.retenciones) && data.retenciones.length > 0;
    const uniquePiId = piTotals.size === 1 ? Array.from(piTotals.keys())[0] : null;
    const resolvedRetenciones: Array<RetencionInput & { purchase_invoice_id: string | null }> = [];
    if (hasExplicitRetenciones) {
      for (const ret of data.retenciones as RetencionInput[]) {
        this.validateRetentionStructure(ret);
        const piId = ret.purchase_invoice_id || uniquePiId;
        // piId may legitimately be null if the pago is not linked to any invoice
        // yet (pending_invoice path). In that case the retencion will be linked
        // only to the pago and contribute to invoice status later when applied.
        resolvedRetenciones.push({ ...ret, purchase_invoice_id: piId || null });
      }
      if (hasInvoiceItems && piTotals.size > 1) {
        // Any retencion missing an explicit purchase_invoice_id when paying
        // multiple invoices is ambiguous.
        for (const ret of resolvedRetenciones) {
          if (!ret.purchase_invoice_id) {
            throw new ApiError(
              400,
              'Con multiples facturas de compra, cada retencion debe especificar purchase_invoice_id'
            );
          }
        }
      }
    }

    // Bug C4: compute auto-retenciones BEFORE opening the transaction, so the
    // whole persistence path is atomic. calculateRetentionsForPago is a pure
    // read (padron lookup), safe to run outside the tx.
    const autoRetenciones: Array<RetencionInput & { purchase_invoice_id: string | null }> = [];
    if (!hasExplicitRetenciones && data.enterprise_id) {
      try {
        const calculated = await retencionesService.calculateRetentionsForPago(
          companyId, data.enterprise_id, pagoAmount
        );
        for (const r of calculated) {
          autoRetenciones.push({
            type: r.type,
            regime: r.regime,
            base_amount: pagoAmount,
            rate: r.rate,
            amount: r.amount,
            purchase_invoice_id: uniquePiId,
            // Auto-calc does not populate jurisdiction; skip the IIBB
            // jurisdiction requirement for auto-retenciones (padron lookup
            // already scoped the applicability) by NOT running
            // validateRetentionStructure on them. Padron rate is trusted.
          });
        }
      } catch (retError) {
        console.warn('Auto-retention calculation warning:', retError);
      }
    }

    const effectiveRetenciones = hasExplicitRetenciones ? resolvedRetenciones : autoRetenciones;
    const totalRetenciones = effectiveRetenciones.reduce(
      (sum, r) => sum + (Number(r.amount) || 0), 0
    );
    const totalAmount = pagoAmount + totalRetenciones;

    // Sanity check IDOR on enterprise/bank BEFORE opening the transaction
    // (pure ownership check, cheap and non-racy).
    if (data.enterprise_id) {
      const entCheck = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${data.enterprise_id} AND company_id = ${companyId}
      `);
      if (((entCheck as any).rows || []).length === 0) {
        throw new ApiError(400, 'Empresa proveedora invalida o no pertenece a tu compania');
      }
    }
    const bankIdsToCheck = new Set<string>();
    if (data.bank_id) bankIdsToCheck.add(data.bank_id);
    for (const pm of paymentMethods) if (pm.bank_id) bankIdsToCheck.add(pm.bank_id);
    for (const bankId of bankIdsToCheck) {
      const bankCheck = await db.execute(sql`
        SELECT id FROM banks WHERE id = ${bankId} AND company_id = ${companyId}
      `);
      if (((bankCheck as any).rows || []).length === 0) {
        throw new ApiError(400, 'Banco invalido o no pertenece a tu compania');
      }
    }

    const pagoId = uuid();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Bug C2: LOCK each purchase invoice and re-read its state + already
      // applied totals INSIDE the transaction. This closes the TOCTOU window:
      // two concurrent pagos can't both see $2k remaining and each apply $2k.
      if (hasInvoiceItems) {
        for (const [piId, entry] of piTotals.entries()) {
          const lockRes = await client.query(
            `SELECT id, company_id, enterprise_id, business_unit_id, status,
                    CAST(total_amount AS decimal) AS total
             FROM purchase_invoices
             WHERE id = $1 AND company_id = $2
             FOR UPDATE`,
            [piId, companyId]
          );
          const pi = (lockRes.rows || [])[0];
          if (!pi) throw new ApiError(404, 'Factura de compra no encontrada o no pertenece a tu compania');
          if (pi.status === 'cancelled' || pi.status === 'cancelado') {
            throw new ApiError(400, 'No se puede pagar una factura de compra cancelada');
          }
          if (data.enterprise_id && pi.enterprise_id && data.enterprise_id !== pi.enterprise_id) {
            throw new ApiError(400, 'La factura de compra pertenece a otro proveedor');
          }
          if (data.business_unit_id && pi.business_unit_id && data.business_unit_id !== pi.business_unit_id) {
            throw new ApiError(400, 'La factura de compra pertenece a otra razon social');
          }

          // Re-read current applied + retenciones under the row lock. Note we
          // do NOT need FOR UPDATE on pago_invoice_applications/retenciones
          // because the purchase_invoices row lock serialises any other
          // createPago touching the same invoice (they all lock the same pi
          // row first), and deletions/anulados also go through anularPago
          // which UPDATEs the pago row (not this invoice row) — we accept
          // that anulado may race with a fresh pago, but anulado only
          // RELEASES balance, it cannot cause overpayment.
          const balRes = await client.query(
            `SELECT
               COALESCE((
                 SELECT SUM(CAST(pia.amount_applied AS decimal))
                 FROM pago_invoice_applications pia
                 LEFT JOIN pagos p ON p.id = pia.pago_id
                 WHERE pia.purchase_invoice_id = $1
                   AND (p.status IS NULL OR p.status != 'anulado')
               ), 0) as applied,
               COALESCE((
                 SELECT SUM(CAST(r.amount AS decimal))
                 FROM retenciones r
                 LEFT JOIN pagos p2 ON p2.id = r.pago_id
                 WHERE r.purchase_invoice_id = $1
                   AND r.direction = 'practicada'
                   AND (p2.status IS NULL OR p2.status != 'anulado')
               ), 0) as retenciones_total`,
            [piId]
          );
          const balRow = balRes.rows[0];
          const piTotal = parseFloat(pi.total);
          const piApplied = parseFloat(balRow.applied) + parseFloat(balRow.retenciones_total);
          const remaining = piTotal - piApplied;

          // The amount this pago contributes to this invoice = cash applied +
          // retenciones practicadas that target this same invoice.
          const retForThisPi = effectiveRetenciones
            .filter(r => r.purchase_invoice_id === piId)
            .reduce((s, r) => s + Number(r.amount || 0), 0);
          const contribution = entry.amount + retForThisPi;

          if (contribution > remaining + 0.01) {
            throw new ApiError(
              400,
              `El monto $${contribution.toFixed(2)} excede el saldo pendiente $${remaining.toFixed(2)} de la factura de compra`
            );
          }
        }
      }

      const pagoCurrency = data.currency || 'ARS';
      const pagoExchangeRate = data.exchange_rate ? parseFloat(data.exchange_rate) : null;

      await client.query(
        `INSERT INTO pagos (id, company_id, enterprise_id, purchase_id, amount, total_amount,
                             payment_method, bank_id, reference, payment_date, notes,
                             business_unit_id, pending_status, created_by, currency, exchange_rate, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'activo')`,
        [
          pagoId, companyId, data.enterprise_id || null, data.purchase_id || null,
          pagoAmount.toString(), totalAmount.toString(), summaryMethod,
          data.bank_id || null, data.reference || null,
          data.payment_date || new Date().toISOString(), data.notes || null,
          data.business_unit_id || null, pendingStatus, userId, pagoCurrency, pagoExchangeRate,
        ]
      );

      // Persist each payment method
      for (const pm of paymentMethods) {
        await client.query(
          `INSERT INTO pago_payment_methods (id, pago_id, method, amount, bank_id, reference, cheque_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            uuid(), pagoId, pm.method, pm.amount.toString(),
            pm.bank_id || null, pm.reference || null,
            pm.cheque_data ? JSON.stringify(pm.cheque_data) : null,
          ]
        );
        if (isChequeEmitidoMethod(pm.method) && pm.cheque_data) {
          await client.query(
            `INSERT INTO cheques (
               id, company_id, number, bank, drawer, drawer_cuit, cheque_type, amount,
               issue_date, due_date, status, direction, pago_id, enterprise_id,
               business_unit_id, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'emitido','emitido',$11,$12,$13,$14)`,
            [
              uuid(), companyId, pm.cheque_data.number, pm.cheque_data.bank,
              pm.cheque_data.drawer, pm.cheque_data.drawer_cuit || null,
              pm.cheque_data.cheque_type || 'propio', pm.amount.toString(),
              new Date(pm.cheque_data.issue_date), new Date(pm.cheque_data.due_date),
              pagoId, data.enterprise_id || null, data.business_unit_id || null, userId,
            ]
          );
        }
      }

      // Bug C3: write purchase_invoice_id on every retencion so that
      // recalculatePurchaseInvoiceStatus actually counts it.
      const pagoDate = data.payment_date || new Date().toISOString();
      const period = pagoDate.substring(0, 7);
      for (const ret of effectiveRetenciones) {
        await client.query(
          `INSERT INTO retenciones (
             id, company_id, type, regime, enterprise_id, pago_id, purchase_invoice_id,
             base_amount, rate, amount, certificate_number, date, period, created_by,
             direction, jurisdiction
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'practicada',$15)`,
          [
            uuid(), companyId, ret.type, ret.regime || null,
            data.enterprise_id || null, pagoId, ret.purchase_invoice_id || null,
            Number(ret.base_amount).toString(), Number(ret.rate).toString(), Number(ret.amount).toString(),
            ret.certificate_number || null, pagoDate, period, userId,
            ret.jurisdiction || null,
          ]
        );
      }

      // Link pago to purchase invoices (N:N).
      if (hasInvoiceItems) {
        for (const [piId, entry] of piTotals.entries()) {
          try {
            await client.query(
              `INSERT INTO pago_invoice_applications (id, pago_id, purchase_invoice_id, amount_applied, created_by)
               VALUES ($1,$2,$3,$4,$5)`,
              [uuid(), pagoId, piId, entry.amount.toString(), userId]
            );
          } catch (err: any) {
            if (err && /duplicate|unique/i.test(err.message || '')) {
              throw new ApiError(409, 'Este pago ya esta vinculado a esta factura de compra');
            }
            throw err;
          }
          await this.recalculatePurchaseInvoiceStatusInTx(client, piId);
          await this.recalculatePurchaseStatusFromInvoicesInTx(client, piId);
        }
      }

      await client.query('COMMIT');
    } catch (txError) {
      try { await client.query('ROLLBACK'); } catch { /* best effort */ }
      client.release();
      if (txError instanceof ApiError) throw txError;
      console.error('Create pago tx error:', txError);
      throw new ApiError(500, 'Failed to create pago');
    }
    client.release();

    // Accounting entry AFTER the money movement is persisted. A failure here
    // is logged but does not roll back the pago (matches cobros behavior).
    try {
      const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
      const retenciones = effectiveRetenciones.map(r => ({
        type: r.type,
        amount: Number(r.amount || 0),
        jurisdiction: (r as any).jurisdiction || null,
      }));
      await accountingEntriesService.createEntryForPago({
        id: pagoId,
        company_id: companyId,
        date: data.payment_date || new Date().toISOString(),
        amount: pagoAmount.toString(),
        total_amount: totalAmount.toString(),
        payment_method: summaryMethod,
        bank_id: data.bank_id,
        pending_status: pendingStatus,
        retenciones,
      });
    } catch (accErr) {
      console.warn('Accounting entry skipped (pago):', (accErr as Error).message);
    }

    // Read-back the created row.
    try {
      const result = await db.execute(sql`
        SELECT p.*, e.name as enterprise_name, pu.purchase_number, b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          COALESCE((SELECT json_agg(json_build_object('id',ret.id,'type',ret.type,'rate',ret.rate,'amount',ret.amount,'regime',ret.regime,'jurisdiction',ret.jurisdiction,'certificate_number',ret.certificate_number,'purchase_invoice_id',ret.purchase_invoice_id))
            FROM retenciones ret WHERE ret.pago_id = p.id),'[]'::json) as retenciones
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${pagoId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0] || { id: pagoId };
    } catch (error) {
      console.error('Read-back pago error:', error);
      return { id: pagoId };
    }
  }

  /**
   * Bug C1: soft-delete a pago with full audit trail (mirrors anularCobro).
   * - status='anulado', anulled_at/by/reason persisted
   * - emitido cheques marked as 'anulado' (cannot be cashed anymore)
   * - recibido endosados reverted to 'a_cobrar' so the cheque is reusable
   * - purchase_invoice.payment_status recalculated for each affected invoice
   * - retenciones stay in DB but are excluded by the (p.status != 'anulado')
   *   filter in recalc queries
   */
  async anularPago(companyId: string, pagoId: string, userId: string | null, reason: string) {
    await this.ensureTables();
    if (!reason || reason.trim().length < 5) {
      throw new ApiError(400, 'Motivo de la anulacion obligatorio (minimo 5 caracteres)');
    }

    const client = await pool.connect();
    let pagoForAccounting: any = null;
    let affectedPiIds: string[] = [];
    try {
      await client.query('BEGIN');

      const lockRes = await client.query(
        `SELECT id, company_id, status, payment_method
         FROM pagos WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [pagoId, companyId]
      );
      if (lockRes.rows.length === 0) throw new ApiError(404, 'Pago no encontrado');
      const pagoRow = lockRes.rows[0];
      if (pagoRow.status === 'anulado') {
        throw new ApiError(409, 'El pago ya esta anulado');
      }
      pagoForAccounting = { id: pagoRow.id, company_id: pagoRow.company_id };

      await client.query(
        `UPDATE pagos
         SET status='anulado', anulled_at=NOW(), anulled_by=$1, anulled_reason=$2
         WHERE id = $3`,
        [userId || null, reason, pagoId]
      );

      // Handle linked cheques.
      const chequesRes = await client.query(
        `SELECT id, direction, status FROM cheques WHERE pago_id = $1`,
        [pagoId]
      );
      for (const ch of chequesRes.rows) {
        if (ch.direction === 'emitido' && ch.status === 'emitido') {
          await client.query(`UPDATE cheques SET status='anulado' WHERE id = $1`, [ch.id]);
          await client.query(
            `INSERT INTO cheque_status_history (cheque_id, old_status, new_status, notes, changed_by)
             VALUES ($1,'emitido','anulado','Pago anulado',$2)`,
            [ch.id, userId || null]
          ).catch(() => { /* history table optional */ });
        }
      }

      // Endorsed cheques: revert to 'a_cobrar' so the physical cheque can be
      // reused legitimately. The anulled pago still shows the endorsement
      // audit trail via endorsed_pago_id=NULL + anulled_reason.
      const endorsedRes = await client.query(
        `SELECT id FROM cheques
         WHERE endorsed_pago_id = $1 AND status='endosado' AND direction='recibido'`,
        [pagoId]
      );
      for (const ch of endorsedRes.rows) {
        await client.query(
          `UPDATE cheques
           SET status='a_cobrar', endorsed_pago_id=NULL,
               endorsed_to_enterprise_id=NULL, endorsed_at=NULL
           WHERE id = $1 AND company_id = $2`,
          [ch.id, companyId]
        );
        await client.query(
          `INSERT INTO cheque_status_history (cheque_id, old_status, new_status, notes, changed_by)
           VALUES ($1,'endosado','a_cobrar','Revertido por anulacion de pago',$2)`,
          [ch.id, userId || null]
        ).catch(() => { /* history table optional */ });
      }

      // Legacy direct-link column cheque_id (pre payment_methods array).
      if (pagoRow.payment_method === 'cheque_endosado') {
        const legacyRes = await client.query(
          `SELECT cheque_id FROM pagos WHERE id = $1`, [pagoId]
        );
        const legacyChequeId = legacyRes.rows[0]?.cheque_id;
        if (legacyChequeId) {
          await client.query(
            `UPDATE cheques
             SET status='a_cobrar', endorsed_pago_id=NULL,
                 endorsed_to_enterprise_id=NULL, endorsed_at=NULL
             WHERE id = $1 AND company_id = $2 AND status='endosado'`,
            [legacyChequeId, companyId]
          );
        }
      }

      // Recalculate purchase_invoices linked to this pago.
      const linkedRes = await client.query(
        `SELECT DISTINCT purchase_invoice_id FROM pago_invoice_applications WHERE pago_id = $1`,
        [pagoId]
      );
      affectedPiIds = linkedRes.rows.map((r: any) => r.purchase_invoice_id).filter(Boolean);
      for (const piId of affectedPiIds) {
        await this.recalculatePurchaseInvoiceStatusInTx(client, piId);
        await this.recalculatePurchaseStatusFromInvoicesInTx(client, piId);
      }

      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* best effort */ }
      client.release();
      if (err instanceof ApiError) throw err;
      console.error('Anular pago error:', err);
      throw new ApiError(500, 'Failed to anular pago');
    }
    client.release();

    if (pagoForAccounting) {
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        await accountingEntriesService.createReverseEntry(pagoForAccounting.company_id, 'pago', pagoId);
      } catch (accErr) {
        console.warn('Accounting reversal skipped (pago):', (accErr as Error).message);
      }
    }

    return { id: pagoId, status: 'anulado', success: true };
  }

  /**
   * deletePago is kept as a thin alias for the API layer. It delegates to
   * anularPago so the HTTP DELETE verb still works for existing clients but
   * soft-deletes with the same audit guarantees.
   */
  async deletePago(companyId: string, pagoId: string, userId?: string, reason?: string) {
    return this.anularPago(companyId, pagoId, userId || null, reason || 'Eliminado via DELETE endpoint');
  }

  // In-transaction recalc: uses the locked client so writes are part of the
  // same atomic unit. Kept separate from the db.execute-based version to
  // avoid mixing connections.
  private async recalculatePurchaseInvoiceStatusInTx(client: any, purchaseInvoiceId: string) {
    const res = await client.query(
      `SELECT
         CAST(pi.total_amount AS decimal) as total,
         COALESCE((
           SELECT SUM(CAST(pia.amount_applied AS decimal))
           FROM pago_invoice_applications pia
           LEFT JOIN pagos p ON p.id = pia.pago_id
           WHERE pia.purchase_invoice_id = pi.id
             AND (p.status IS NULL OR p.status != 'anulado')
         ), 0) as applied_cash,
         COALESCE((
           SELECT SUM(CAST(r.amount AS decimal))
           FROM retenciones r
           LEFT JOIN pagos p2 ON p2.id = r.pago_id
           WHERE r.purchase_invoice_id = pi.id
             AND r.direction = 'practicada'
             AND (p2.status IS NULL OR p2.status != 'anulado')
         ), 0) as retenciones_total
       FROM purchase_invoices pi WHERE pi.id = $1`,
      [purchaseInvoiceId]
    );
    const row = res.rows[0];
    if (!row) return;
    const total = parseFloat(row.total);
    const applied = parseFloat(row.applied_cash) + parseFloat(row.retenciones_total);
    let status = 'pendiente';
    if (applied + 0.01 >= total && total > 0) status = 'pagado';
    else if (applied > 0) status = 'parcial';
    await client.query(
      `UPDATE purchase_invoices SET payment_status = $1 WHERE id = $2`,
      [status, purchaseInvoiceId]
    );
  }

  private async recalculatePurchaseStatusFromInvoicesInTx(client: any, purchaseInvoiceId: string) {
    const piRes = await client.query(
      `SELECT purchase_id FROM purchase_invoices WHERE id = $1`,
      [purchaseInvoiceId]
    );
    const purchaseId = piRes.rows[0]?.purchase_id;
    if (!purchaseId) return;

    const res = await client.query(
      `SELECT
         CAST(p.total_amount AS decimal) as purchase_total,
         COALESCE((
           SELECT SUM(CAST(pia.amount_applied AS decimal))
           FROM pago_invoice_applications pia
           JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
           LEFT JOIN pagos pg ON pg.id = pia.pago_id
           WHERE pi.purchase_id = $1
             AND pi.status NOT IN ('cancelled','cancelado')
             AND (pg.status IS NULL OR pg.status != 'anulado')
         ), 0) as total_paid
       FROM purchases p WHERE p.id = $1`,
      [purchaseId]
    );
    const row = res.rows[0];
    if (!row) return;
    const purchaseTotal = parseFloat(row.purchase_total);
    const totalPaid = parseFloat(row.total_paid);
    let status = 'pendiente';
    if (totalPaid >= purchaseTotal && purchaseTotal > 0) status = 'pagada';
    else if (totalPaid > 0) status = 'parcial';
    await client.query(
      `UPDATE purchases SET payment_status = $1 WHERE id = $2`,
      [status, purchaseId]
    );
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_pagado, COUNT(*) as count
        FROM pagos WHERE company_id = ${companyId} AND (status IS NULL OR status != 'anulado')
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_pagado: parseFloat(rows[0]?.total_pagado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error: any) {
      console.error('[getPagosSummary] SQL error:', error?.message, error?.stack);
      throw new ApiError(500, 'Failed to get pagos summary');
    }
  }
}

export const pagosService = new PagosService();
