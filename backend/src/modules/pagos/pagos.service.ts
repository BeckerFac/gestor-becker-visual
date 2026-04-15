import { db } from '../../config/db';
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
      // FLOW 46/Bug C support: add status for soft-delete style anulado handling.
      await db.execute(sql`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'activo'`).catch(() => {});

      // FLOW 46/Bug A: cheques outgoing support — add direction, pago_id, enterprise_id columns.
      await db.execute(sql`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS direction VARCHAR(20) DEFAULT 'recibido'`).catch(() => {});
      await db.execute(sql`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS pago_id UUID REFERENCES pagos(id) ON DELETE SET NULL`).catch(() => {});
      await db.execute(sql`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL`).catch(() => {});

      // FLOW 46/Bug A: pago_payment_methods (mirrors receipt_payment_methods for cobros)
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pago_payment_methods (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pago_id UUID NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
          method VARCHAR(50) NOT NULL,
          amount DECIMAL(12,2) NOT NULL,
          bank_id UUID REFERENCES banks(id),
          reference VARCHAR(255),
          cheque_data JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `).catch(() => {});

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
        whereClause = sql`${whereClause} AND p.business_unit_id = ${filters.business_unit_id}`;
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
          -- Linked purchase invoices
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
          COALESCE((SELECT json_agg(json_build_object('id',ret.id,'type',ret.type,'rate',ret.rate,'amount',ret.amount,'regime',ret.regime,'jurisdiction',ret.jurisdiction,'certificate_number',ret.certificate_number))
            FROM retenciones ret WHERE ret.pago_id = p.id),'[]'::json) as retenciones
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE ${whereClause}
        ORDER BY p.payment_date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get pagos');
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

    // PR7-T5: cheque NO requiere bank_id top-level — los cheques guardan el banco como
    // string en cheque_data.bank (igual que cobros). Solo transferencia top-level necesita bank_id UUID.
    // Si hay payment_methods array, cada metodo valida su propio bank_id/cheque_data.
    if (
      data.payment_method === 'transferencia' &&
      !data.bank_id &&
      !(Array.isArray(data.payment_methods) && data.payment_methods.length > 0)
    ) {
      throw new ApiError(400, 'Se requiere seleccionar un banco para transferencia');
    }

    // FLOW 46 / Bug A: Parse payment_methods array with backward compat to top-level fields.
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

    // FLOW 46 / Bug A: validate each payment method individually.
    for (const pm of paymentMethods) {
      if (!pm.method) {
        throw new ApiError(400, 'Cada metodo de pago requiere un campo "method"');
      }
      if (!Number.isFinite(pm.amount) || pm.amount <= 0) {
        throw new ApiError(400, `Monto invalido para metodo ${pm.method}`);
      }
      if (pm.method === 'transferencia' && !pm.bank_id) {
        throw new ApiError(400, 'Transferencia requiere bank_id');
      }
      if (pm.method === 'cheque') {
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
    // The pago amount is the SUM of payment methods (overrides legacy data.amount when array used).
    const pagoAmount = Array.isArray(data.payment_methods) && data.payment_methods.length > 0
      ? pmTotal
      : parseFloat(data.amount?.toString() || '0');

    const summaryMethod = paymentMethods.length === 1 ? paymentMethods[0].method : 'mixto';

    const pagoId = uuid();
    // Determine pending_status based on whether purchase_invoice_items are provided
    const hasInvoiceItems = data.purchase_invoice_items && Array.isArray(data.purchase_invoice_items) && data.purchase_invoice_items.length > 0;
    const pendingStatus = hasInvoiceItems ? null : 'pending_invoice';

    // Explicit retentions from user take priority over auto-calculation
    const hasExplicitRetenciones = data.retenciones && Array.isArray(data.retenciones) && data.retenciones.length > 0;
    const totalRetenciones = hasExplicitRetenciones
      ? data.retenciones.reduce((sum: number, r: any) => sum + parseFloat(r.amount || 0), 0)
      : 0;
    // total_amount = net amount (what leaves bank) + retentions (what gets withheld)
    // This represents the total amount that cancels against invoices
    const totalAmount = pagoAmount + totalRetenciones;

    // FLOW 46 / Bug B: IDOR + integrity validations BEFORE entering the transaction.
    // 1) enterprise_id (supplier) must belong to the user's company.
    if (data.enterprise_id) {
      const entCheck = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${data.enterprise_id} AND company_id = ${companyId}
      `);
      if (((entCheck as any).rows || []).length === 0) {
        throw new ApiError(400, 'Empresa proveedora invalida o no pertenece a tu compania');
      }
    }
    // 2) bank_id (top-level + each pm.bank_id) must belong to the user's company.
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

    // 3) For each purchase_invoice_item: validate ownership, status, enterprise, BU, and remaining balance.
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

      for (const [piId, entry] of piTotals.entries()) {
        const piCheck = await db.execute(sql`
          SELECT id, company_id, enterprise_id, business_unit_id, status, total_amount
          FROM purchase_invoices
          WHERE id = ${piId} AND company_id = ${companyId}
        `);
        const pi = ((piCheck as any).rows || [])[0];
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

        // Remaining balance — count only applications from non-anulado pagos.
        const balResult = await db.execute(sql`
          SELECT
            CAST(pi.total_amount AS decimal) as total,
            COALESCE((
              SELECT SUM(CAST(pia.amount_applied AS decimal))
              FROM pago_invoice_applications pia
              LEFT JOIN pagos p ON p.id = pia.pago_id
              WHERE pia.purchase_invoice_id = pi.id
                AND (p.status IS NULL OR p.status != 'anulado')
            ), 0) as applied,
            COALESCE((
              SELECT SUM(CAST(r.amount AS decimal))
              FROM retenciones r
              LEFT JOIN pagos p2 ON p2.id = r.pago_id
              WHERE r.purchase_invoice_id = pi.id
                AND r.direction = 'practicada'
                AND (p2.status IS NULL OR p2.status != 'anulado')
            ), 0) as retenciones_total
          FROM purchase_invoices pi WHERE pi.id = ${piId}
        `);
        const balRow = ((balResult as any).rows || [])[0];
        if (!balRow) throw new ApiError(404, 'Factura de compra no encontrada');
        const piTotal = parseFloat(balRow.total);
        const piApplied = parseFloat(balRow.applied) + parseFloat(balRow.retenciones_total);
        const remaining = piTotal - piApplied;
        if (entry.amount > remaining + 0.01) {
          throw new ApiError(
            400,
            `El monto $${entry.amount.toFixed(2)} excede el saldo pendiente $${remaining.toFixed(2)} de la factura de compra`
          );
        }
      }
    }

    try {
      // Transaction: all inserts succeed or all rollback
      await db.execute(sql`BEGIN`);
      try {
        const pagoCurrency = data.currency || 'ARS';
        const pagoExchangeRate = data.exchange_rate ? parseFloat(data.exchange_rate) : null;

        await db.execute(sql`
          INSERT INTO pagos (id, company_id, enterprise_id, purchase_id, amount, total_amount, payment_method, bank_id, reference, payment_date, notes, business_unit_id, pending_status, created_by, currency, exchange_rate)
          VALUES (${pagoId}, ${companyId}, ${data.enterprise_id || null}, ${data.purchase_id || null}, ${pagoAmount.toString()}, ${totalAmount.toString()}, ${summaryMethod}, ${data.bank_id || null}, ${data.reference || null}, ${data.payment_date || new Date().toISOString()}, ${data.notes || null}, ${data.business_unit_id || null}, ${pendingStatus}, ${userId}, ${pagoCurrency}, ${pagoExchangeRate})
        `);

        // FLOW 46 / Bug A: persist each payment method into pago_payment_methods.
        for (const pm of paymentMethods) {
          await db.execute(sql`
            INSERT INTO pago_payment_methods (id, pago_id, method, amount, bank_id, reference, cheque_data)
            VALUES (${uuid()}, ${pagoId}, ${pm.method}, ${pm.amount.toString()}, ${pm.bank_id || null}, ${pm.reference || null},
                    ${pm.cheque_data ? JSON.stringify(pm.cheque_data) : null}::jsonb)
          `);
        }

        // FLOW 46 / Bug A: create cheques rows with direction='emitido' for each cheque payment method.
        for (const pm of paymentMethods) {
          if (pm.method === 'cheque' && pm.cheque_data) {
            const chequeId = uuid();
            await db.execute(sql`
              INSERT INTO cheques (
                id, company_id, number, bank, drawer, drawer_cuit, cheque_type, amount,
                issue_date, due_date, status, direction, pago_id, enterprise_id,
                business_unit_id, created_by
              )
              VALUES (
                ${chequeId}, ${companyId}, ${pm.cheque_data.number}, ${pm.cheque_data.bank},
                ${pm.cheque_data.drawer}, ${pm.cheque_data.drawer_cuit || null},
                ${pm.cheque_data.cheque_type || 'propio'}, ${pm.amount.toString()},
                ${new Date(pm.cheque_data.issue_date)}, ${new Date(pm.cheque_data.due_date)},
                'emitido', 'emitido', ${pagoId}, ${data.enterprise_id || null},
                ${data.business_unit_id || null}, ${userId}
              )
            `);
          }
        }

        // Create explicit retentions inside the transaction
        if (hasExplicitRetenciones) {
          const pagoDate = data.payment_date || new Date().toISOString();
          const period = pagoDate.substring(0, 7);
          for (const ret of data.retenciones) {
            await db.execute(sql`
              INSERT INTO retenciones (id, company_id, type, regime, enterprise_id, pago_id, base_amount, rate, amount, certificate_number, date, period, created_by, direction)
              VALUES (${uuid()}, ${companyId}, ${ret.type}, ${ret.regime || null}, ${data.enterprise_id || null}, ${pagoId}, ${parseFloat(ret.base_amount).toString()}, ${parseFloat(ret.rate).toString()}, ${parseFloat(ret.amount).toString()}, ${ret.certificate_number || null}, ${pagoDate}, ${period}, ${userId}, 'practicada')
            `);
          }
        }

        // Link pago to purchase invoices if items provided (N:N)
        if (hasInvoiceItems) {
          // FLOW 46 / Bug B: dedupe ON CONFLICT silenced. Fail loudly on duplicates.
          for (const [piId, entry] of piTotals.entries()) {
            try {
              await db.execute(sql`
                INSERT INTO pago_invoice_applications (id, pago_id, purchase_invoice_id, amount_applied, created_by)
                VALUES (${uuid()}, ${pagoId}, ${piId}, ${entry.amount.toString()}, ${userId})
              `);
            } catch (err: any) {
              if (err && /duplicate|unique/i.test(err.message || '')) {
                throw new ApiError(409, 'Este pago ya esta vinculado a esta factura de compra');
              }
              throw err;
            }
            await this.recalculatePurchaseInvoiceStatus(piId);
            await this.recalculatePurchaseStatusFromInvoices(piId);
          }
        }

        await db.execute(sql`COMMIT`);
      } catch (txError) {
        await db.execute(sql`ROLLBACK`);
        throw txError;
      }

      // Auto-calculate retentions ONLY if user did NOT send explicit retentions
      if (!hasExplicitRetenciones && data.enterprise_id) {
        try {
          const retentions = await retencionesService.calculateRetentionsForPago(
            companyId, data.enterprise_id, pagoAmount
          );
          const pagoDate = data.payment_date || new Date().toISOString();
          const period = pagoDate.substring(0, 7);
          for (const ret of retentions) {
            await retencionesService.createRetention(companyId, userId, {
              type: ret.type,
              regime: ret.regime || undefined,
              enterprise_id: data.enterprise_id,
              pago_id: pagoId,
              base_amount: pagoAmount,
              rate: ret.rate,
              amount: ret.amount,
              date: pagoDate,
              period,
            });
          }
          // Recalculate total_amount after auto-retentions
          const autoRetResult = await db.execute(sql`
            SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_ret FROM retenciones WHERE pago_id = ${pagoId}
          `);
          const autoRetTotal = parseFloat(((autoRetResult as any).rows || [])[0]?.total_ret || '0');
          if (autoRetTotal > 0) {
            const newTotalAmount = pagoAmount + autoRetTotal;
            await db.execute(sql`
              UPDATE pagos SET total_amount = ${newTotalAmount.toString()} WHERE id = ${pagoId}
            `);
          }
        } catch (retError) {
          // Non-blocking: log but don't fail the pago
          console.warn('Auto-retention calculation warning:', retError);
        }
      }

      // Accounting entry (after retentions are created)
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        const retResult = await db.execute(sql`
          SELECT type, CAST(amount AS decimal) as amount FROM retenciones WHERE pago_id = ${pagoId}
        `);
        const retenciones = ((retResult as any).rows || []).map((r: any) => ({
          type: r.type,
          amount: parseFloat(r.amount || '0'),
        }));
        await accountingEntriesService.createEntryForPago({
          id: pagoId,
          company_id: companyId,
          date: data.payment_date || new Date().toISOString(),
          amount: pagoAmount.toString(),
          payment_method: summaryMethod,
          bank_id: data.bank_id,
          pending_status: pendingStatus,
          retenciones,
        });
      } catch (accErr) { console.warn('Accounting entry skipped (pago):', (accErr as Error).message); }

      // SELECT result outside transaction (read-only)
      const result = await db.execute(sql`
        SELECT p.*, e.name as enterprise_name, pu.purchase_number, b.bank_name,
          COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
            FROM entity_tags et JOIN tags t ON et.tag_id=t.id
            WHERE et.entity_id=e.id AND et.entity_type='enterprise'),'[]'::json) as enterprise_tags,
          COALESCE((SELECT json_agg(json_build_object('id',ret.id,'type',ret.type,'rate',ret.rate,'amount',ret.amount,'regime',ret.regime,'jurisdiction',ret.jurisdiction,'certificate_number',ret.certificate_number))
            FROM retenciones ret WHERE ret.pago_id = p.id),'[]'::json) as retenciones
        FROM pagos p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        LEFT JOIN purchases pu ON p.purchase_id = pu.id
        LEFT JOIN banks b ON p.bank_id = b.id
        WHERE p.id = ${pagoId}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      console.error('Create pago error:', error);
      throw new ApiError(500, 'Failed to create pago');
    }
  }

  async deletePago(companyId: string, pagoId: string) {
    await this.ensureTables();
    // Validations outside transaction
    const check = await db.execute(sql`SELECT id FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
    const rows = (check as any).rows || check || [];
    if (rows.length === 0) throw new ApiError(404, 'Pago not found');

    // Read pago data before delete (for accounting reversal + cheque revert)
    let pagoForAccounting: any = null;
    let pagoFull: any = null;
    try {
      const pagoResult = await db.execute(sql`SELECT id, company_id, payment_method, cheque_id FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);
      pagoFull = ((pagoResult as any).rows || [])[0];
      pagoForAccounting = pagoFull ? { id: pagoFull.id, company_id: pagoFull.company_id } : null;
    } catch {}

    try {
      // Get linked purchase invoices before deleting (for recalculation)
      const linkedPIs = await db.execute(sql`
        SELECT purchase_invoice_id FROM pago_invoice_applications WHERE pago_id = ${pagoId}
      `);
      const piIds = ((linkedPIs as any).rows || []).map((r: any) => r.purchase_invoice_id);

      // Transaction: delete + recalculate atomically
      await db.execute(sql`BEGIN`);
      try {
        // SECURITY (FLOW 35): if this pago is a cheque endoso, revert the
        // cheque back to 'a_cobrar' so it can be reused legitimately.
        // Without this, deleting an endoso pago would orphan the cheque in
        // 'endosado' status forever.
        if (pagoFull && pagoFull.payment_method === 'cheque_endosado' && pagoFull.cheque_id) {
          const revertResult: any = await db.execute(sql`
            UPDATE cheques
            SET status = 'a_cobrar',
                endorsed_pago_id = NULL,
                endorsed_to_enterprise_id = NULL,
                endorsed_at = NULL
            WHERE id = ${pagoFull.cheque_id}
              AND company_id = ${companyId}
              AND endorsed_pago_id = ${pagoId}
          `);
          const reverted = (revertResult?.rowCount ?? ((revertResult as any)?.rows?.length || 0)) > 0;
          if (reverted) {
            await db.execute(sql`
              INSERT INTO cheque_status_history (cheque_id, old_status, new_status, notes, changed_by)
              VALUES (${pagoFull.cheque_id}, 'endosado', 'a_cobrar', 'Revertido por eliminacion de pago endoso', NULL)
            `);
          }
        }

        // Delete pago (CASCADE will delete pago_invoice_applications)
        await db.execute(sql`DELETE FROM pagos WHERE id = ${pagoId} AND company_id = ${companyId}`);

        // Recalculate payment_status for affected purchase invoices + cascade to purchases
        for (const piId of piIds) {
          await this.recalculatePurchaseInvoiceStatus(piId);
          await this.recalculatePurchaseStatusFromInvoices(piId);
        }

        await db.execute(sql`COMMIT`);
      } catch (txError) {
        await db.execute(sql`ROLLBACK`);
        throw txError;
      }

      // After delete, create reverse accounting entry
      if (pagoForAccounting) {
        try {
          const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
          await accountingEntriesService.createReverseEntry(pagoForAccounting.company_id, 'pago', pagoId);
        } catch (accErr) { console.warn('Accounting reversal skipped (pago):', (accErr as Error).message); }
      }

      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete pago');
    }
  }

  private async recalculatePurchaseInvoiceStatus(purchaseInvoiceId: string) {
    try {
      // FLOW 46 / Bug C: include retenciones practicadas in applied total.
      // A purchase invoice $121k can be paid with $100k cash + $21k retencion practicada
      // and must be marked 'pagado'. Previously only summed pago_invoice_applications.
      const result = await db.execute(sql`
        SELECT
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
        FROM purchase_invoices pi
        WHERE pi.id = ${purchaseInvoiceId}
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const total = parseFloat(row.total);
      const applied = parseFloat(row.applied_cash) + parseFloat(row.retenciones_total);

      let status = 'pendiente';
      if (applied + 0.01 >= total && total > 0) status = 'pagado';
      else if (applied > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE purchase_invoices SET payment_status = ${status} WHERE id = ${purchaseInvoiceId}
      `);
    } catch (error) {
      console.warn('Recalculate purchase invoice status error:', error);
    }
  }

  /**
   * Recalculate purchase.payment_status from ALL its purchase_invoices' pago applications.
   * Chain: pagos → purchase_invoices → purchase (cascada completa)
   */
  private async recalculatePurchaseStatusFromInvoices(purchaseInvoiceId: string) {
    try {
      // Get the purchase_id from this invoice
      const piResult = await db.execute(sql`
        SELECT purchase_id FROM purchase_invoices WHERE id = ${purchaseInvoiceId}
      `);
      const purchaseId = ((piResult as any).rows || [])[0]?.purchase_id;
      if (!purchaseId) return; // standalone invoice, no purchase to update

      // Calculate total paid across ALL purchase_invoices of this purchase
      const result = await db.execute(sql`
        SELECT
          CAST(p.total_amount AS decimal) as purchase_total,
          COALESCE((
            SELECT SUM(CAST(pia.amount_applied AS decimal))
            FROM pago_invoice_applications pia
            JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
            WHERE pi.purchase_id = ${purchaseId} AND pi.status NOT IN ('cancelled', 'cancelado')
          ), 0) as total_paid
        FROM purchases p
        WHERE p.id = ${purchaseId}
      `);
      const row = ((result as any).rows || [])[0];
      if (!row) return;

      const purchaseTotal = parseFloat(row.purchase_total);
      const totalPaid = parseFloat(row.total_paid);

      let status = 'pendiente';
      if (totalPaid >= purchaseTotal && purchaseTotal > 0) status = 'pagada';
      else if (totalPaid > 0) status = 'parcial';

      await db.execute(sql`
        UPDATE purchases SET payment_status = ${status} WHERE id = ${purchaseId}
      `);
    } catch (error) {
      console.warn('Recalculate purchase status from invoices error:', error);
    }
  }

  async getSummary(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total_pagado, COUNT(*) as count
        FROM pagos WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      return {
        total_pagado: parseFloat(rows[0]?.total_pagado || '0'),
        count: parseInt(rows[0]?.count || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get pagos summary');
    }
  }
}

export const pagosService = new PagosService();
