import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

interface CreateEntryParams {
  companyId: string;
  date: string;
  description: string;
  referenceType?: string;
  referenceId?: string;
  isAuto?: boolean;
  createdBy?: string;
  lines: JournalLine[];
}

interface InvoiceData {
  id: string;
  company_id: string;
  date?: string;
  total: number | string;
  subtotal?: number | string;
  vat_amount?: number | string;
}

interface CobroData {
  id: string;
  company_id: string;
  date?: string;
  amount: number | string;
}

interface PagoData {
  id: string;
  company_id: string;
  date?: string;
  amount: number | string;
}

interface PurchaseInvoiceData {
  id: string;
  company_id: string;
  date?: string;
  total: number | string;
  subtotal?: number | string;
  vat_amount?: number | string;
}

// Account codes from the Argentine chart seed
const ACCOUNTS = {
  CAJA_BANCOS: '1.1',
  DEUDORES_VENTAS: '1.2',
  IVA_CREDITO: '1.5',
  PROVEEDORES: '2.1',
  IVA_DEBITO: '2.3',
  VENTAS: '4.1',
  COSTO_VENTAS: '5.1',
} as const;

export class AccountingEntriesService {
  /**
   * Resolve account code to account ID for a given company.
   */
  private async resolveAccountId(companyId: string, code: string): Promise<string> {
    const result = await db.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE company_id = ${companyId} AND code = ${code}
      LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(400, `Cuenta contable ${code} no encontrada. Ejecute el seed del plan de cuentas primero.`);
    }
    return rows[0].id;
  }

  /**
   * Create a journal entry with balanced lines.
   * Validates that total debits = total credits.
   */
  async createEntry(params: CreateEntryParams): Promise<any> {
    const { companyId, date, description, referenceType, referenceId, isAuto = true, createdBy, lines } = params;

    // Validate balance
    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new ApiError(400, `Asiento desbalanceado: Debe ${totalDebit.toFixed(2)} != Haber ${totalCredit.toFixed(2)}`);
    }

    if (lines.length === 0) {
      throw new ApiError(400, 'El asiento debe tener al menos una linea');
    }

    // Create journal entry
    const entryResult = await db.execute(sql`
      INSERT INTO journal_entries (company_id, date, description, reference_type, reference_id, is_auto, created_by)
      VALUES (${companyId}, ${date}::date, ${description}, ${referenceType || null}, ${referenceId || null}, ${isAuto}, ${createdBy || null})
      RETURNING *
    `);
    const entryRows = (entryResult as any).rows || entryResult || [];
    const entry = entryRows[0];

    // Insert lines
    const entryLines: any[] = [];
    for (const line of lines) {
      const accountId = await this.resolveAccountId(companyId, line.accountCode);
      const lineResult = await db.execute(sql`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
        VALUES (${entry.id}, ${accountId}, ${line.debit}, ${line.credit}, ${line.description || null})
        RETURNING *
      `);
      const lineRows = (lineResult as any).rows || lineResult || [];
      entryLines.push(lineRows[0]);
    }

    return { ...entry, lines: entryLines };
  }

  /**
   * Auto journal entry when a sales invoice is authorized.
   * D: Deudores por Ventas (total)
   * C: Ventas (neto gravado)
   * C: IVA Debito Fiscal (IVA)
   */
  async createEntryForInvoice(invoice: InvoiceData): Promise<any> {
    const total = Number(invoice.total);
    const vat = Number(invoice.vat_amount || 0);
    const neto = invoice.subtotal ? Number(invoice.subtotal) : total - vat;
    const date = invoice.date || new Date().toISOString().split('T')[0];

    const lines: JournalLine[] = [
      { accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: total, credit: 0, description: 'Deudores por Ventas' },
      { accountCode: ACCOUNTS.VENTAS, debit: 0, credit: neto, description: 'Ventas' },
    ];

    if (vat > 0) {
      lines.push({ accountCode: ACCOUNTS.IVA_DEBITO, debit: 0, credit: vat, description: 'IVA Debito Fiscal' });
    }

    return this.createEntry({
      companyId: invoice.company_id,
      date,
      description: `Factura de venta`,
      referenceType: 'invoice',
      referenceId: invoice.id,
      isAuto: true,
      lines,
    });
  }

  /**
   * Auto journal entry when a cobro (collection) is created.
   * D: Caja/Bancos (monto)
   * C: Deudores por Ventas (monto)
   */
  async createEntryForCobro(cobro: CobroData): Promise<any> {
    const amount = Number(cobro.amount);
    const date = cobro.date || new Date().toISOString().split('T')[0];

    return this.createEntry({
      companyId: cobro.company_id,
      date,
      description: `Cobro registrado`,
      referenceType: 'cobro',
      referenceId: cobro.id,
      isAuto: true,
      lines: [
        { accountCode: ACCOUNTS.CAJA_BANCOS, debit: amount, credit: 0, description: 'Caja y Bancos' },
        { accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: 0, credit: amount, description: 'Deudores por Ventas' },
      ],
    });
  }

  /**
   * Auto journal entry when a pago (payment) is created.
   * D: Proveedores (monto)
   * C: Caja/Bancos (monto)
   */
  async createEntryForPago(pago: PagoData): Promise<any> {
    const amount = Number(pago.amount);
    const date = pago.date || new Date().toISOString().split('T')[0];

    return this.createEntry({
      companyId: pago.company_id,
      date,
      description: `Pago registrado`,
      referenceType: 'pago',
      referenceId: pago.id,
      isAuto: true,
      lines: [
        { accountCode: ACCOUNTS.PROVEEDORES, debit: amount, credit: 0, description: 'Proveedores' },
        { accountCode: ACCOUNTS.CAJA_BANCOS, debit: 0, credit: amount, description: 'Caja y Bancos' },
      ],
    });
  }

  /**
   * Auto journal entry when a purchase invoice is created.
   * D: Compras/Gastos (neto)
   * D: IVA Credito Fiscal (IVA)
   * C: Proveedores (total)
   */
  async createEntryForPurchaseInvoice(pi: PurchaseInvoiceData): Promise<any> {
    const total = Number(pi.total);
    const vat = Number(pi.vat_amount || 0);
    const neto = pi.subtotal ? Number(pi.subtotal) : total - vat;
    const date = pi.date || new Date().toISOString().split('T')[0];

    const lines: JournalLine[] = [
      { accountCode: ACCOUNTS.COSTO_VENTAS, debit: neto, credit: 0, description: 'Compras / Gastos' },
    ];

    if (vat > 0) {
      lines.push({ accountCode: ACCOUNTS.IVA_CREDITO, debit: vat, credit: 0, description: 'IVA Credito Fiscal' });
    }

    lines.push({ accountCode: ACCOUNTS.PROVEEDORES, debit: 0, credit: total, description: 'Proveedores' });

    return this.createEntry({
      companyId: pi.company_id,
      date,
      description: `Factura de compra`,
      referenceType: 'purchase_invoice',
      referenceId: pi.id,
      isAuto: true,
      lines,
    });
  }

  /**
   * Get all journal entries with lines for a company.
   */
  async getEntries(companyId: string, filters: {
    date_from?: string;
    date_to?: string;
    reference_type?: string;
    is_auto?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ entries: any[]; total: number }> {
    const conditions = [sql`je.company_id = ${companyId}`];

    if (filters.date_from) {
      conditions.push(sql`je.date >= ${filters.date_from}::date`);
    }
    if (filters.date_to) {
      conditions.push(sql`je.date <= ${filters.date_to}::date`);
    }
    if (filters.reference_type) {
      conditions.push(sql`je.reference_type = ${filters.reference_type}`);
    }
    if (filters.is_auto !== undefined) {
      conditions.push(sql`je.is_auto = ${filters.is_auto === 'true'}`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    // Count total
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int as total FROM journal_entries je WHERE ${whereClause}
    `);
    const countRows = (countResult as any).rows || countResult || [];
    const total = countRows[0]?.total || 0;

    // Get entries
    const entriesResult = await db.execute(sql`
      SELECT je.*,
        COALESCE(json_agg(
          json_build_object(
            'id', jel.id,
            'account_id', jel.account_id,
            'account_code', coa.code,
            'account_name', coa.name,
            'debit', jel.debit,
            'credit', jel.credit,
            'description', jel.description
          ) ORDER BY jel.debit DESC
        ) FILTER (WHERE jel.id IS NOT NULL), '[]') as lines
      FROM journal_entries je
      LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
      LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE ${whereClause}
      GROUP BY je.id
      ORDER BY je.date DESC, je.entry_number DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const entries = (entriesResult as any).rows || entriesResult || [];

    return { entries, total };
  }

  /**
   * Get a single journal entry by ID.
   */
  async getEntryById(companyId: string, entryId: string): Promise<any> {
    const result = await db.execute(sql`
      SELECT je.*,
        COALESCE(json_agg(
          json_build_object(
            'id', jel.id,
            'account_id', jel.account_id,
            'account_code', coa.code,
            'account_name', coa.name,
            'debit', jel.debit,
            'credit', jel.credit,
            'description', jel.description
          ) ORDER BY jel.debit DESC
        ) FILTER (WHERE jel.id IS NOT NULL), '[]') as lines
      FROM journal_entries je
      LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
      LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.id = ${entryId} AND je.company_id = ${companyId}
      GROUP BY je.id
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Asiento no encontrado');
    }
    return rows[0];
  }

  /**
   * Delete a journal entry (only manual ones).
   */
  async deleteEntry(companyId: string, entryId: string): Promise<{ success: boolean }> {
    const entry = await this.getEntryById(companyId, entryId);
    if (entry.is_auto) {
      throw new ApiError(400, 'No se pueden eliminar asientos automaticos');
    }

    await db.execute(sql`
      DELETE FROM journal_entries WHERE id = ${entryId} AND company_id = ${companyId}
    `);

    return { success: true };
  }

  /**
   * Get chart of accounts for a company (tree-ordered by code).
   */
  async getChartOfAccounts(companyId: string): Promise<any[]> {
    const result = await db.execute(sql`
      SELECT * FROM chart_of_accounts
      WHERE company_id = ${companyId}
      ORDER BY code
    `);
    return (result as any).rows || result || [];
  }

  /**
   * Create a new account in the chart.
   */
  async createAccount(companyId: string, data: {
    code: string;
    name: string;
    type: string;
    parent_id?: string;
    level?: number;
    is_header?: boolean;
  }): Promise<any> {
    const result = await db.execute(sql`
      INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, level, is_header)
      VALUES (
        ${companyId},
        ${data.code},
        ${data.name},
        ${data.type},
        ${data.parent_id || null},
        ${data.level || 1},
        ${data.is_header || false}
      )
      RETURNING *
    `);
    const rows = (result as any).rows || result || [];
    return rows[0];
  }

  /**
   * Balance de sumas y saldos: for each account, show total debits, credits, and balance.
   */
  async getBalance(companyId: string, filters: {
    date_from?: string;
    date_to?: string;
  } = {}): Promise<any[]> {
    const dateConditions: any[] = [];
    if (filters.date_from) {
      dateConditions.push(sql`je.date >= ${filters.date_from}::date`);
    }
    if (filters.date_to) {
      dateConditions.push(sql`je.date <= ${filters.date_to}::date`);
    }

    const dateFilter = dateConditions.length > 0
      ? sql`AND ${sql.join(dateConditions, sql` AND `)}`
      : sql``;

    const result = await db.execute(sql`
      SELECT
        coa.id,
        coa.code,
        coa.name,
        coa.type,
        coa.level,
        coa.is_header,
        COALESCE(SUM(jel.debit), 0)::numeric as total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric as total_credit,
        (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0))::numeric as balance
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = ${companyId} ${dateFilter}
      WHERE coa.company_id = ${companyId}
      GROUP BY coa.id, coa.code, coa.name, coa.type, coa.level, coa.is_header
      ORDER BY coa.code
    `);

    return (result as any).rows || result || [];
  }
}

export const accountingEntriesService = new AccountingEntriesService();
