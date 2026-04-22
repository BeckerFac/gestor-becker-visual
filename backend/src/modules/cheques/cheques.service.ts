import { db, pool, tryMig } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { activityService } from '../activity/activity.service';

// SECURITY: 'endosado' MUST NOT transition directly to 'a_cobrar'.
// Reverting an endoso requires deleting the associated pago (see pagos.service.deletePago),
// which is the only legitimate path. Direct manual revert would allow double-spending
// the same cheque to two suppliers.
//
// State machine per direction:
//
//   RECIBIDO (third-party -> us):
//     a_cobrar ──┬─> depositado ──> cobrado
//                │                └─> rechazado ──> anulado
//                ├─> endosado  (terminal; reverted only via deletePago)
//                └─> anulado
//     (legacy: depositado->a_cobrar, rechazado->a_cobrar, cobrado->a_cobrar retained
//      for backwards compat with pre-direction corrections)
//
//   EMITIDO (us -> third-party):
//     emitido ──┬─> entregado ──> cobrado
//               │               └─> rechazado ──> anulado
//               └─> anulado
//
const VALID_TRANSITIONS_RECIBIDO: Record<string, string[]> = {
  a_cobrar: ['endosado', 'depositado', 'cobrado', 'rechazado', 'anulado'],
  endosado: ['cobrado', 'rechazado'],
  depositado: ['cobrado', 'rechazado', 'a_cobrar'],
  rechazado: ['a_cobrar', 'anulado'],
  cobrado: ['a_cobrar'],
  anulado: [],
};

const VALID_TRANSITIONS_EMITIDO: Record<string, string[]> = {
  emitido: ['entregado', 'anulado'],
  entregado: ['cobrado', 'rechazado'],
  cobrado: [],
  rechazado: ['anulado'],
  anulado: [],
};

function getValidTransitions(direction: string): Record<string, string[]> {
  return direction === 'emitido' ? VALID_TRANSITIONS_EMITIDO : VALID_TRANSITIONS_RECIBIDO;
}

const VALID_STATUSES = [
  // recibido
  'a_cobrar', 'endosado', 'depositado', 'cobrado', 'rechazado',
  // emitido
  'emitido', 'entregado',
  // shared terminal
  'anulado',
];

export class ChequesService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cheque_type VARCHAR(50) DEFAULT 'comun'`, 'cheques.cheque_type');
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS drawer_cuit VARCHAR(20)`, 'cheques.drawer_cuit');
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cobro_id UUID REFERENCES cobros(id)`, 'cheques.cobro_id');
      // Outgoing (emitido) lifecycle support
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'recibido'`, 'cheques.direction');
      await tryMig(`UPDATE cheques SET direction = 'recibido' WHERE direction IS NULL`, 'cheques.direction backfill');
      // issuer_type: 'propio' (we issued it, for emitido) | 'tercero' (customer issued, for recibido)
      await tryMig(`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS issuer_type VARCHAR(10)`, 'cheques.issuer_type');
      await tryMig(`UPDATE cheques SET issuer_type = CASE WHEN direction = 'emitido' THEN 'propio' ELSE 'tercero' END WHERE issuer_type IS NULL`, 'cheques.issuer_type backfill');
      // Unique (company_id, bank, number, direction) — excluding anulado so reissues are allowed
      await tryMig(`CREATE UNIQUE INDEX IF NOT EXISTS uq_cheques_bank_number_dir ON cheques(company_id, bank, number, direction) WHERE status != 'anulado'`, 'uq_cheques_bank_number_dir');
      this.migrationsRun = true;
    } catch (error) {
      console.error('Cheques migrations error:', error);
    }
  }

  async getCheques(companyId: string, filters: { status?: string; search?: string; due_from?: string; due_to?: string; business_unit_id?: string; direction?: 'recibido' | 'emitido'; canAccessLuna?: boolean } = {}) {
    await this.ensureMigrations();
    try {
      let whereClause = sql`c.company_id = ${companyId}`;
      if (filters.business_unit_id) {
        // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
        whereClause = sql`${whereClause} AND (c.business_unit_id = ${filters.business_unit_id} OR c.business_unit_id IS NULL)`;
      }
      if (filters.direction) {
        whereClause = sql`${whereClause} AND c.direction = ${filters.direction}`;
      }
      if (filters.status && filters.status !== 'todos') {
        whereClause = sql`${whereClause} AND c.status = ${filters.status}`;
      }
      if (filters.search) {
        const searchTerm = `%${filters.search}%`;
        whereClause = sql`${whereClause} AND (c.number ILIKE ${searchTerm} OR c.bank ILIKE ${searchTerm} OR c.drawer ILIKE ${searchTerm} OR cu.name ILIKE ${searchTerm})`;
      }
      if (filters.due_from) {
        whereClause = sql`${whereClause} AND c.due_date >= ${filters.due_from}`;
      }
      if (filters.due_to) {
        whereClause = sql`${whereClause} AND c.due_date <= ${filters.due_to}`;
      }
      // Sol/Luna: cheques has no fiscal_type column, so we route the filter
      // through the linked cobro (recibido cheques always stem from a cobro
      // when recorded via the normal flow). Emitido cheques / legacy orphan
      // recibidos without a cobro are treated as Sol. Non-Luna users therefore
      // never see a recibido cheque linked to a Luna cobro.
      if (!filters.canAccessLuna) {
        whereClause = sql`${whereClause} AND (c.direction = 'emitido' OR COALESCE(co.fiscal_type, 'fiscal') = 'fiscal')`;
      }

      const result = await db.execute(sql`
        SELECT c.*, c.customer_id, cu.name as customer_name, o.order_number,
          co.id as cobro_id, co.reference as cobro_reference
        FROM cheques c
        LEFT JOIN customers cu ON c.customer_id = cu.id
        LEFT JOIN orders o ON c.order_id = o.id
        LEFT JOIN cobros co ON c.cobro_id = co.id
        WHERE ${whereClause}
        ORDER BY c.due_date ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get cheques error:', error);
      throw new ApiError(500, 'Failed to get cheques');
    }
  }

  async createCheque(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();

    // H5: due_date must be >= issue_date (post-dated cheques)
    if (data.issue_date && data.due_date) {
      if (new Date(data.due_date) < new Date(data.issue_date)) {
        throw new ApiError(400, 'Fecha de vencimiento no puede ser anterior a fecha de emision');
      }
    }

    // Direction + initial status derivation.
    //  - recibido (default): status = 'a_cobrar', issuer_type = 'tercero'
    //  - emitido:            status = 'emitido',  issuer_type = 'propio'
    const direction: 'recibido' | 'emitido' = data.direction === 'emitido' ? 'emitido' : 'recibido';
    const initialStatus = direction === 'emitido' ? 'emitido' : 'a_cobrar';
    const issuerType = direction === 'emitido' ? 'propio' : 'tercero';

    // Auto-assign default business_unit_id if not provided
    if (!data.business_unit_id) {
      try {
        const buResult = await db.execute(sql`SELECT id FROM business_units WHERE company_id = ${companyId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`);
        const defaultBu = ((buResult as any).rows || [])[0];
        if (defaultBu) data.business_unit_id = defaultBu.id;
      } catch { /* no business units yet */ }
    }

    try {
      const chequeId = uuid();
      await db.execute(sql`
        INSERT INTO cheques (id, company_id, number, bank, drawer, drawer_cuit, cheque_type, amount, issue_date, due_date, status, direction, issuer_type, customer_id, order_id, notes, business_unit_id, created_by)
        VALUES (${chequeId}, ${companyId}, ${data.number}, ${data.bank}, ${data.drawer}, ${data.drawer_cuit || null}, ${data.cheque_type || 'comun'}, ${data.amount.toString()}, ${new Date(data.issue_date)}, ${new Date(data.due_date)}, ${initialStatus}, ${direction}, ${issuerType}, ${data.customer_id || null}, ${data.order_id || null}, ${data.notes || null}, ${data.business_unit_id || null}, ${userId})
      `);

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId,
          module: 'cheques',
          action: 'create',
          entityType: 'cheque',
          entityId: chequeId,
          circuit: null,
          metadata: { number: data.number, direction, amount: data.amount },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return { id: chequeId, status: initialStatus, direction };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create cheque error:', error);
      // Unique violation on (company_id, bank, number, direction)
      const msg = (error as any)?.message || '';
      if (msg.includes('uq_cheques_bank_number_dir') || msg.includes('duplicate key')) {
        throw new ApiError(409, 'Ya existe un cheque con ese numero, banco y direccion');
      }
      throw new ApiError(500, 'Failed to create cheque');
    }
  }

  async updateChequeStatus(companyId: string, chequeId: string, newStatus: string, userId?: string, notes?: string) {
    try {
      if (!VALID_STATUSES.includes(newStatus)) {
        throw new ApiError(400, 'Estado invalido');
      }

      const result = await db.execute(sql`
        SELECT id, status, amount, bank_id, direction FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');

      const cheque = rows[0];
      const currentStatus = cheque.status;
      const direction = cheque.direction || 'recibido';
      const transitions = getValidTransitions(direction);
      const allowedTransitions = transitions[currentStatus] || [];
      if (!allowedTransitions.includes(newStatus)) {
        throw new ApiError(400, `No se puede cambiar de "${currentStatus}" a "${newStatus}"`);
      }

      // Record history
      await db.execute(sql`
        INSERT INTO cheque_status_history (cheque_id, old_status, new_status, notes, changed_by)
        VALUES (${chequeId}, ${currentStatus}, ${newStatus}, ${notes || null}, ${userId || null})
      `);

      // Update collected_date based on status
      if (newStatus === 'cobrado') {
        await db.execute(sql`
          UPDATE cheques SET status = ${newStatus}, collected_date = NOW()
          WHERE id = ${chequeId}
        `);
      } else if (newStatus === 'a_cobrar') {
        await db.execute(sql`
          UPDATE cheques SET status = ${newStatus}, collected_date = NULL
          WHERE id = ${chequeId}
        `);
      } else {
        await db.execute(sql`
          UPDATE cheques SET status = ${newStatus}
          WHERE id = ${chequeId}
        `);
      }

      // Accounting entry for cheque transition (direction-aware; see FIX-J)
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        await accountingEntriesService.createEntryForChequeTransition({
          id: chequeId,
          company_id: companyId,
          amount: cheque.amount,
          old_status: currentStatus,
          new_status: newStatus,
          bank_id: cheque.bank_id || undefined,
          direction, // NEW: accounting service switches debit/credit sides by direction
          date: new Date().toISOString(),
        } as any);
      } catch (accErr) { console.warn('Accounting entry skipped (cheque):', (accErr as Error).message); }

      // Wave 2C audit — state transition.
      try {
        await activityService.log({
          companyId,
          userId: userId || 'system',
          module: 'cheques',
          action: 'transition',
          entityType: 'cheque',
          entityId: chequeId,
          circuit: null,
          changes: { status: { old: currentStatus, new: newStatus } },
          metadata: { notes },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return { id: chequeId, status: newStatus };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update cheque status');
    }
  }

  async updateCheque(companyId: string, chequeId: string, data: any) {
    try {
      // H5: due_date must be >= issue_date
      if (data.issue_date && data.due_date) {
        if (new Date(data.due_date) < new Date(data.issue_date)) {
          throw new ApiError(400, 'Fecha de vencimiento no puede ser anterior a fecha de emision');
        }
      }

      const result = await db.execute(sql`
        SELECT id, status, direction FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');
      const row = rows[0];
      const direction = row.direction || 'recibido';
      // Editable only in the initial "unused" state per direction:
      //   recibido -> a_cobrar
      //   emitido  -> emitido
      const editable =
        (direction === 'recibido' && row.status === 'a_cobrar') ||
        (direction === 'emitido' && row.status === 'emitido');
      if (!editable) {
        throw new ApiError(400, 'Solo se pueden editar cheques pendientes');
      }

      await db.execute(sql`
        UPDATE cheques SET
          number = ${data.number},
          bank = ${data.bank},
          drawer = ${data.drawer},
          drawer_cuit = ${data.drawer_cuit || null},
          cheque_type = ${data.cheque_type || 'comun'},
          amount = ${data.amount.toString()},
          issue_date = ${new Date(data.issue_date)},
          due_date = ${new Date(data.due_date)},
          customer_id = ${data.customer_id || null},
          notes = ${data.notes || null}
        WHERE id = ${chequeId} AND company_id = ${companyId}
      `);

      return { id: chequeId, updated: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Update cheque error:', error);
      throw new ApiError(500, 'Failed to update cheque');
    }
  }

  async deleteCheque(companyId: string, chequeId: string) {
    try {
      const result = await db.execute(sql`
        SELECT id, status, direction, pago_id, cobro_id FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Cheque not found');
      const row = rows[0];
      const direction = row.direction || 'recibido';

      // Allow delete only while not yet "locked" in a financial transition:
      //   recibido -> only 'a_cobrar' (unused incoming)
      //   emitido  -> only 'emitido'  (undelivered outgoing)
      const deletable =
        (direction === 'recibido' && row.status === 'a_cobrar') ||
        (direction === 'emitido' && row.status === 'emitido');

      if (!deletable) {
        throw new ApiError(409, `No se puede eliminar cheque en estado ${row.status}. Use anular en su lugar.`);
      }

      // If already linked to a pago/cobro, require unlinking by deleting parent first.
      if (row.pago_id || row.cobro_id) {
        throw new ApiError(409, 'Cheque esta vinculado a pago/cobro. Elimine el pago/cobro primero.');
      }

      await db.execute(sql`
        DELETE FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);

      return { id: chequeId, deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete cheque error:', error);
      throw new ApiError(500, 'Failed to delete cheque');
    }
  }

  async getStatusHistory(companyId: string, chequeId: string) {
    try {
      // Verify cheque belongs to company
      const chequeResult = await db.execute(sql`
        SELECT id FROM cheques WHERE id = ${chequeId} AND company_id = ${companyId}
      `);
      const chequeRows = (chequeResult as any).rows || chequeResult || [];
      if (chequeRows.length === 0) throw new ApiError(404, 'Cheque not found');

      const result = await db.execute(sql`
        SELECT h.*, u.name as changed_by_name
        FROM cheque_status_history h
        LEFT JOIN users u ON h.changed_by = u.id
        WHERE h.cheque_id = ${chequeId}
        ORDER BY h.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get status history error:', error);
      throw new ApiError(500, 'Failed to get cheque status history');
    }
  }

  async getChequeByCobro(companyId: string, cobroId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT c.*, cu.name as customer_name
        FROM cheques c
        LEFT JOIN customers cu ON c.customer_id = cu.id
        WHERE c.company_id = ${companyId} AND c.cobro_id = ${cobroId}
        LIMIT 1
      `);
      const rows = (result as any).rows || result || [];
      return rows[0] || null;
    } catch (error) {
      console.error('Get cheque by cobro error:', error);
      return null;
    }
  }

  async getSummary(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          -- RECIBIDOS
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'a_cobrar'   THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_total_a_cobrar,
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'cobrado'    THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_total_cobrado,
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'endosado'   THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_total_endosado,
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'depositado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_total_depositado,
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'rechazado'  THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_total_rechazado,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'a_cobrar')   as r_count_a_cobrar,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'cobrado')    as r_count_cobrado,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'endosado')   as r_count_endosado,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'depositado') as r_count_depositado,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'rechazado')  as r_count_rechazado,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'a_cobrar' AND due_date::date < NOW()::date) as r_vencidos_count,
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'a_cobrar' AND due_date::date < NOW()::date THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_vencidos_amount,
          COUNT(*) FILTER (WHERE direction = 'recibido' AND status = 'a_cobrar' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7)) as r_vencen_semana_count,
          COALESCE(SUM(CASE WHEN direction = 'recibido' AND status = 'a_cobrar' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7) THEN CAST(amount AS decimal) ELSE 0 END), 0) as r_vencen_semana_amount,
          -- EMITIDOS
          COALESCE(SUM(CASE WHEN direction = 'emitido' AND status = 'emitido'   THEN CAST(amount AS decimal) ELSE 0 END), 0) as e_total_emitido,
          COALESCE(SUM(CASE WHEN direction = 'emitido' AND status = 'entregado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as e_total_entregado,
          COALESCE(SUM(CASE WHEN direction = 'emitido' AND status = 'cobrado'   THEN CAST(amount AS decimal) ELSE 0 END), 0) as e_total_cobrado,
          COALESCE(SUM(CASE WHEN direction = 'emitido' AND status = 'rechazado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as e_total_rechazado,
          COUNT(*) FILTER (WHERE direction = 'emitido' AND status = 'emitido')   as e_count_emitido,
          COUNT(*) FILTER (WHERE direction = 'emitido' AND status = 'entregado') as e_count_entregado,
          COUNT(*) FILTER (WHERE direction = 'emitido' AND status = 'cobrado')   as e_count_cobrado,
          COUNT(*) FILTER (WHERE direction = 'emitido' AND status = 'rechazado') as e_count_rechazado,
          COUNT(*) FILTER (WHERE direction = 'emitido' AND status = 'entregado' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7)) as e_vencen_semana_count,
          COALESCE(SUM(CASE WHEN direction = 'emitido' AND status = 'entregado' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7) THEN CAST(amount AS decimal) ELSE 0 END), 0) as e_vencen_semana_amount,
          -- LEGACY flat keys (direction-agnostic; kept for backwards compat)
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_a_cobrar,
          COALESCE(SUM(CASE WHEN status = 'cobrado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_cobrado,
          COALESCE(SUM(CASE WHEN status = 'endosado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_endosado,
          COALESCE(SUM(CASE WHEN status = 'depositado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_depositado,
          COALESCE(SUM(CASE WHEN status = 'rechazado' THEN CAST(amount AS decimal) ELSE 0 END), 0) as total_rechazado,
          COUNT(*) FILTER (WHERE status = 'a_cobrar') as count_a_cobrar,
          COUNT(*) FILTER (WHERE status = 'cobrado') as count_cobrado,
          COUNT(*) FILTER (WHERE status = 'endosado') as count_endosado,
          COUNT(*) FILTER (WHERE status = 'depositado') as count_depositado,
          COUNT(*) FILTER (WHERE status = 'rechazado') as count_rechazado,
          COUNT(*) FILTER (WHERE status = 'a_cobrar' AND due_date::date < NOW()::date) as vencidos_count,
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' AND due_date::date < NOW()::date THEN CAST(amount AS decimal) ELSE 0 END), 0) as vencidos_amount,
          COUNT(*) FILTER (WHERE status = 'a_cobrar' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7)) as vencen_semana_count,
          COALESCE(SUM(CASE WHEN status = 'a_cobrar' AND due_date::date BETWEEN NOW()::date AND (NOW()::date + 7) THEN CAST(amount AS decimal) ELSE 0 END), 0) as vencen_semana_amount
        FROM cheques
        WHERE company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      const row = rows[0] || {};
      return {
        recibidos: {
          total_a_cobrar: parseFloat(row.r_total_a_cobrar || '0'),
          total_cobrado: parseFloat(row.r_total_cobrado || '0'),
          total_endosado: parseFloat(row.r_total_endosado || '0'),
          total_depositado: parseFloat(row.r_total_depositado || '0'),
          total_rechazado: parseFloat(row.r_total_rechazado || '0'),
          count_a_cobrar: parseInt(row.r_count_a_cobrar || '0'),
          count_cobrado: parseInt(row.r_count_cobrado || '0'),
          count_endosado: parseInt(row.r_count_endosado || '0'),
          count_depositado: parseInt(row.r_count_depositado || '0'),
          count_rechazado: parseInt(row.r_count_rechazado || '0'),
          vencidos_count: parseInt(row.r_vencidos_count || '0'),
          vencidos_amount: parseFloat(row.r_vencidos_amount || '0'),
          vencen_semana_count: parseInt(row.r_vencen_semana_count || '0'),
          vencen_semana_amount: parseFloat(row.r_vencen_semana_amount || '0'),
        },
        emitidos: {
          total_emitido: parseFloat(row.e_total_emitido || '0'),
          total_entregado: parseFloat(row.e_total_entregado || '0'),
          total_cobrado: parseFloat(row.e_total_cobrado || '0'),
          total_rechazado: parseFloat(row.e_total_rechazado || '0'),
          count_emitido: parseInt(row.e_count_emitido || '0'),
          count_entregado: parseInt(row.e_count_entregado || '0'),
          count_cobrado: parseInt(row.e_count_cobrado || '0'),
          count_rechazado: parseInt(row.e_count_rechazado || '0'),
          vencen_semana_count: parseInt(row.e_vencen_semana_count || '0'),
          vencen_semana_amount: parseFloat(row.e_vencen_semana_amount || '0'),
        },
        // Legacy flat keys (backwards compat)
        total_a_cobrar: parseFloat(row.total_a_cobrar || '0'),
        total_cobrado: parseFloat(row.total_cobrado || '0'),
        total_endosado: parseFloat(row.total_endosado || '0'),
        total_depositado: parseFloat(row.total_depositado || '0'),
        total_rechazado: parseFloat(row.total_rechazado || '0'),
        count_a_cobrar: parseInt(row.count_a_cobrar || '0'),
        count_cobrado: parseInt(row.count_cobrado || '0'),
        count_endosado: parseInt(row.count_endosado || '0'),
        count_depositado: parseInt(row.count_depositado || '0'),
        count_rechazado: parseInt(row.count_rechazado || '0'),
        vencidos_count: parseInt(row.vencidos_count || '0'),
        vencidos_amount: parseFloat(row.vencidos_amount || '0'),
        vencen_semana_count: parseInt(row.vencen_semana_count || '0'),
        vencen_semana_amount: parseFloat(row.vencen_semana_amount || '0'),
      };
    } catch (error) {
      throw new ApiError(500, 'Failed to get cheques summary');
    }
  }
  /**
   * Endorse a cheque to pay a provider.
   * Creates a pago, updates cheque status, and creates CC adjustment for excess.
   */
  async endorseCheque(companyId: string, userId: string, chequeId: string, data: {
    enterprise_id: string;      // Provider to pay
    amount: number;             // Amount to pay (must be <= cheque.amount)
    purchase_invoice_id?: string; // Optional: link pago to purchase invoice
    notes?: string;
  }) {
    await this.ensureMigrations();

    // SECURITY (FLOW 35 / double-spending fix):
    // Wrap the entire endoso in a single transaction with SELECT ... FOR UPDATE
    // on the cheque row. Without the row lock, two concurrent requests can both
    // observe status='a_cobrar', both insert pagos, and both try to mark the
    // cheque endosado — the same cheque ends up paying two different suppliers.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the cheque row for the duration of the transaction.
      const lockResult = await client.query(
        `SELECT id, company_id, status, amount, number, business_unit_id, endorsed_pago_id, direction
         FROM cheques
         WHERE id = $1 AND company_id = $2
         FOR UPDATE`,
        [chequeId, companyId]
      );
      const cheque = (lockResult.rows || [])[0];
      if (!cheque) throw new ApiError(404, 'Cheque no encontrado');

      // H2: Only recibido cheques can be endorsed (can't re-spend your own issue).
      if ((cheque.direction || 'recibido') !== 'recibido') {
        throw new ApiError(400, 'Solo se pueden endosar cheques recibidos de terceros');
      }

      // V1: Must be 'a_cobrar' (re-checked INSIDE the lock)
      if (cheque.status !== 'a_cobrar') {
        throw new ApiError(409, `Cheque no disponible para endosar (estado actual: ${cheque.status})`);
      }
      // Defense in depth: if endorsed_pago_id is already set, reject regardless of status.
      if (cheque.endorsed_pago_id != null) {
        throw new ApiError(409, 'Cheque ya endosado a otro pago');
      }

      // V2: Amount must be <= cheque amount
      const chequeAmount = parseFloat(cheque.amount);
      if (data.amount > chequeAmount) {
        throw new ApiError(400, `Cheque ($${chequeAmount.toFixed(2)}) insuficiente para pago ($${data.amount.toFixed(2)})`);
      }

      if (data.amount <= 0) {
        throw new ApiError(400, 'El monto a pagar debe ser mayor a 0');
      }

      // V3: Verify enterprise (still scoped to company)
      const entCheck = await client.query(
        `SELECT id FROM enterprises WHERE id = $1 AND company_id = $2`,
        [data.enterprise_id, companyId]
      );
      if ((entCheck.rows || []).length === 0) {
        throw new ApiError(400, 'Proveedor no valido');
      }

      // CREATE pago (inside transaction)
      const pagoId = uuid();
      const pendingStatus = data.purchase_invoice_id ? null : 'pending_invoice';
      const pagoNotes = data.notes || `Endoso cheque #${cheque.number}`;
      await client.query(
        `INSERT INTO pagos (id, company_id, enterprise_id, amount, payment_method, payment_date, notes, business_unit_id, pending_status, cheque_id, created_by)
         VALUES ($1, $2, $3, $4, 'cheque_endosado', NOW(), $5, $6, $7, $8, $9)`,
        [pagoId, companyId, data.enterprise_id, data.amount.toString(), pagoNotes, cheque.business_unit_id || null, pendingStatus, chequeId, userId]
      );

      // UPDATE cheque status to 'endosado' — guarded by status='a_cobrar'
      // so even if the lock were somehow bypassed, the WHERE clause prevents
      // double assignment.
      const updateResult = await client.query(
        `UPDATE cheques SET
           status = 'endosado',
           endorsed_to_enterprise_id = $1,
           endorsed_pago_id = $2,
           endorsed_at = NOW()
         WHERE id = $3 AND status = 'a_cobrar' AND endorsed_pago_id IS NULL`,
        [data.enterprise_id, pagoId, chequeId]
      );
      if (updateResult.rowCount === 0) {
        throw new ApiError(409, 'Cheque ya fue endosado por otra operacion');
      }

      // Record history
      await client.query(
        `INSERT INTO cheque_status_history (cheque_id, old_status, new_status, notes, changed_by)
         VALUES ($1, 'a_cobrar', 'endosado', $2, $3)`,
        [chequeId, `Endosado a proveedor por $${data.amount.toFixed(2)}`, userId]
      );

      // Handle excess: cheque amount > pago amount
      const excess = chequeAmount - data.amount;
      if (excess > 0.01) {
        await client.query(
          `INSERT INTO account_adjustments (company_id, enterprise_id, amount, reason, adjustment_type, created_by)
           VALUES ($1, $2, $3, $4, 'credit', $5)`,
          [
            companyId,
            data.enterprise_id,
            (-excess).toString(),
            `Exceso por endoso de cheque #${cheque.number} ($${chequeAmount.toFixed(2)} cheque - $${data.amount.toFixed(2)} pago)`,
            userId,
          ]
        );
      }

      await client.query('COMMIT');

      // Side effects AFTER commit (best-effort, do not affect double-spending guarantee).
      // Link pago to purchase invoice if provided
      if (data.purchase_invoice_id) {
        try {
          const { pagoApplicationsService } = await import('../pago-applications/pago-applications.service');
          await pagoApplicationsService.linkPagoToPurchaseInvoice(
            companyId, userId, pagoId, data.purchase_invoice_id, data.amount
          );
        } catch (err) {
          console.warn('Error linking pago to purchase invoice during endorsement:', err);
        }
      }

      // Accounting entry for endorsement.
      // TODO: createEntryForChequeTransition uses the global db handle, so it
      // commits in its own connection. Acceptable here because the cheque/pago
      // rows are already committed atomically above; if accounting fails the
      // cheque is still correctly endosado and we only lose the journal entry.
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        await accountingEntriesService.createEntryForChequeTransition({
          id: chequeId,
          company_id: companyId,
          amount: data.amount || chequeAmount,
          old_status: 'a_cobrar',
          new_status: 'endosado',
          direction: 'recibido',
        } as any);
      } catch (accErr) { console.warn('Accounting entry skipped (endorse):', (accErr as Error).message); }

      // Wave 2C audit — endoso.
      try {
        await activityService.log({
          companyId,
          userId,
          module: 'cheques',
          action: 'endorse',
          entityType: 'cheque',
          entityId: chequeId,
          circuit: null,
          metadata: {
            endorsed_to_enterprise_id: data.enterprise_id,
            pago_id: pagoId,
            amount_paid: data.amount,
            cheque_amount: chequeAmount,
            excess,
          },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return {
        pago_id: pagoId,
        cheque_id: chequeId,
        endorsed_to: data.enterprise_id,
        amount_paid: data.amount,
        excess,
        cheque_status: 'endosado',
      };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Get cheques available for endorsement (direction='recibido', status='a_cobrar').
   * Filters out emitido cheques to prevent re-spending our own issue (H2).
   */
  async getChequesForEndorsement(companyId: string, businessUnitId?: string) {
    await this.ensureMigrations();
    let whereClause = sql`c.company_id = ${companyId} AND c.status = 'a_cobrar' AND c.direction = 'recibido'`;
    if (businessUnitId) {
      // Nor-fix (item 1): include orphan rows (business_unit_id IS NULL).
      whereClause = sql`${whereClause} AND (c.business_unit_id = ${businessUnitId} OR c.business_unit_id IS NULL)`;
    }

    const result = await db.execute(sql`
      SELECT c.id, c.number, c.bank, c.drawer, c.amount, c.issue_date, c.due_date,
        cu.name as customer_name
      FROM cheques c
      LEFT JOIN customers cu ON c.customer_id = cu.id
      WHERE ${whereClause}
      ORDER BY c.due_date ASC
    `);
    return (result as any).rows || [];
  }
}

export const chequesService = new ChequesService();
