import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

// --- accounting_enabled cache & helper ---
export const accountingEnabledCache = new Map<string, { enabled: boolean; expires: number }>();

export async function isAccountingEnabled(companyId: string): Promise<boolean> {
  const cached = accountingEnabledCache.get(companyId);
  if (cached && Date.now() < cached.expires) return cached.enabled;

  const result = await db.execute(sql`
    SELECT accounting_enabled FROM companies WHERE id = ${companyId}
  `);
  const rows = (result as any).rows || [];
  const enabled = rows[0]?.accounting_enabled === true;
  accountingEnabledCache.set(companyId, { enabled, expires: Date.now() + 60000 }); // 60s cache
  return enabled;
}

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

interface InvoiceEntryData {
  id: string;
  company_id: string;
  date?: string;
  total: number | string;
  subtotal?: number | string;
  vat_amount?: number | string;
  invoice_type?: string;
  fiscal_type?: string;
  items?: Array<{ quantity: number; unit_price: number; vat_rate: number }>;
}

interface CobroData {
  id: string;
  company_id: string;
  date?: string;
  amount: number | string;
  payment_method?: string;
  bank_id?: string;
  pending_status?: string | null;
  currency?: string;
  exchange_rate?: number | string;
  original_exchange_rate?: number | string;
  amount_foreign?: number | string;
}

interface PagoData {
  id: string;
  company_id: string;
  date?: string;
  amount: number | string;
  payment_method?: string;
  bank_id?: string;
  pending_status?: string | null;
  retenciones?: Array<{ type: string; amount: number }>;
  skip_accounting?: boolean;
  currency?: string;
  exchange_rate?: number | string;
  original_exchange_rate?: number | string;
  amount_foreign?: number | string;
}

interface PurchaseInvoiceData {
  id: string;
  company_id: string;
  date?: string;
  total: number | string;
  subtotal?: number | string;
  vat_amount?: number | string;
  items?: Array<{ quantity: number; unit_price: number; vat_rate: number }>;
}

// Account codes from the Argentine chart seed
export const ACCOUNTS = {
  // Activo - Disponibilidades
  CAJA: '1.1.1',
  BANCOS: '1.1.2', // header - subcuentas dinamicas
  // Activo - Creditos
  DEUDORES_VENTAS: '1.2.1',
  DEUDORES_MOROSOS: '1.2.2',
  // Activo - Otros Creditos
  IVA_CF_21: '1.3.1',
  IVA_CF_105: '1.3.2',
  IVA_CF_27: '1.3.3',
  IVA_CF_5: '1.3.4',
  IVA_CF_25: '1.3.5',
  RET_IIBB_SUFRIDA: '1.3.6',
  RET_GANANCIAS_SUFRIDA: '1.3.7',
  RET_IVA_SUFRIDA: '1.3.8',
  PERCEPCION_IIBB_SUFRIDA: '1.3.9',
  ANTICIPOS_PROVEEDORES: '1.3.10',
  // Activo - Bienes de Cambio
  MERCADERIAS: '1.4.1',
  // Activo - Valores
  CHEQUES_CARTERA: '1.5.1',
  CHEQUES_DEPOSITADOS: '1.5.2',
  // Pasivo
  PROVEEDORES: '2.1.1',
  IVA_DF_21: '2.2.1',
  IVA_DF_105: '2.2.2',
  IVA_DF_27: '2.2.3',
  IVA_DF_5: '2.2.4',
  IVA_DF_25: '2.2.5',
  RET_IIBB_DEPOSITAR: '2.2.6',
  RET_GANANCIAS_DEPOSITAR: '2.2.7',
  RET_IVA_DEPOSITAR: '2.2.8',
  RET_SUSS_DEPOSITAR: '2.2.9',
  PERCEPCION_IIBB_DEPOSITAR: '2.2.10',
  ANTICIPOS_CLIENTES: '2.3.1',
  // Patrimonio
  CAPITAL: '3.1',
  RESULTADOS_ACUMULADOS: '3.2',
  // Ingresos
  VENTAS: '4.1',
  OTROS_INGRESOS: '4.2',
  DIF_CAMBIO_POS: '4.3',
  AJUSTES_CC_ING: '4.4',
  // Egresos
  CMV: '5.1',
  GASTOS_ADMIN: '5.2',
  GASTOS_BANCARIOS: '5.3.1',
  CHEQUES_RECHAZADOS: '5.4',
  DIF_CAMBIO_NEG: '5.5',
  AJUSTES_CC_EGR: '5.6',
  AJUSTE_INVENTARIO: '5.7',
} as const;

// VAT rate -> IVA Debito Fiscal account code mapping
const IVA_DF_MAP: Record<number, string> = {
  21: ACCOUNTS.IVA_DF_21,
  10.5: ACCOUNTS.IVA_DF_105,
  27: ACCOUNTS.IVA_DF_27,
  5: ACCOUNTS.IVA_DF_5,
  2.5: ACCOUNTS.IVA_DF_25,
};

// VAT rate -> IVA Credito Fiscal account code mapping
const IVA_CF_MAP: Record<number, string> = {
  21: ACCOUNTS.IVA_CF_21,
  10.5: ACCOUNTS.IVA_CF_105,
  27: ACCOUNTS.IVA_CF_27,
  5: ACCOUNTS.IVA_CF_5,
  2.5: ACCOUNTS.IVA_CF_25,
};

// Retencion type -> account code mapping for pagos
const RET_MAP: Record<string, string> = {
  'iibb': ACCOUNTS.RET_IIBB_DEPOSITAR,
  'ganancias': ACCOUNTS.RET_GANANCIAS_DEPOSITAR,
  'iva': ACCOUNTS.RET_IVA_DEPOSITAR,
  'suss': ACCOUNTS.RET_SUSS_DEPOSITAR,
};

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
   * Resolve account code to account ID, returning null if not found.
   */
  async getAccountId(companyId: string, code: string): Promise<string | null> {
    const result = await db.execute(sql`
      SELECT id FROM chart_of_accounts WHERE company_id = ${companyId} AND code = ${code}
    `);
    return ((result as any).rows || [])[0]?.id || null;
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
   * Auto journal entry when a sales invoice / NC / ND is authorized.
   *
   * FACTURA:  D: Deudores  C: Ventas + IVA DF (by rate)
   * NC:       D: Ventas + IVA DF  C: Deudores  (reverse)
   * ND:       D: Deudores  C: Otros Ingresos + IVA DF
   *
   * Supports multi-rate VAT breakdown when items with vat_rate are provided.
   */
  async createEntryForInvoice(invoice: InvoiceEntryData): Promise<any> {
    if (!await isAccountingEnabled(invoice.company_id)) return null;

    const total = Number(invoice.total);
    const date = invoice.date || new Date().toISOString().split('T')[0];
    const invoiceType = invoice.invoice_type || '';
    const isNC = invoiceType.startsWith('NC_');
    const isND = invoiceType.startsWith('ND_');

    // Build VAT breakdown grouped by rate
    const vatByRate = new Map<number, number>();
    let neto: number;

    if (invoice.items && invoice.items.length > 0) {
      neto = 0;
      for (const item of invoice.items) {
        const lineNeto = item.quantity * item.unit_price;
        neto += lineNeto;
        const rate = item.vat_rate;
        const lineVat = lineNeto * (rate / 100);
        vatByRate.set(rate, (vatByRate.get(rate) || 0) + lineVat);
      }
    } else {
      // Fallback: single global vat_amount at default 21%
      const vat = Number(invoice.vat_amount || 0);
      neto = invoice.subtotal ? Number(invoice.subtotal) : total - vat;
      if (vat > 0) {
        vatByRate.set(21, vat);
      }
    }

    // Round to 2 decimals
    const r = (n: number) => Math.round(n * 100) / 100;

    // Income account: Ventas for FC/NC, Otros Ingresos for ND
    const incomeAccount = isND ? ACCOUNTS.OTROS_INGRESOS : ACCOUNTS.VENTAS;
    const incomeLabel = isND ? 'Otros Ingresos' : 'Ventas';

    const lines: JournalLine[] = [];

    if (isNC) {
      // NC reverses the invoice entry
      lines.push({ accountCode: incomeAccount, debit: r(neto), credit: 0, description: incomeLabel });
      for (const [rate, vatAmount] of vatByRate) {
        const ivaAccount = IVA_DF_MAP[rate] || ACCOUNTS.IVA_DF_21;
        lines.push({ accountCode: ivaAccount, debit: r(vatAmount), credit: 0, description: `IVA DF ${rate}%` });
      }
      lines.push({ accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: 0, credit: r(total), description: 'Deudores por Ventas' });
    } else {
      // FC or ND: same direction
      lines.push({ accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: r(total), credit: 0, description: 'Deudores por Ventas' });
      lines.push({ accountCode: incomeAccount, debit: 0, credit: r(neto), description: incomeLabel });
      for (const [rate, vatAmount] of vatByRate) {
        const ivaAccount = IVA_DF_MAP[rate] || ACCOUNTS.IVA_DF_21;
        lines.push({ accountCode: ivaAccount, debit: 0, credit: r(vatAmount), description: `IVA DF ${rate}%` });
      }
    }

    const descriptionPrefix = isNC ? 'Nota de Credito' : isND ? 'Nota de Debito' : 'Factura de venta';

    return this.createEntry({
      companyId: invoice.company_id,
      date,
      description: descriptionPrefix,
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

    const mainEntry = await this.createEntry({
      companyId: cobro.company_id,
      date,
      description: `Cobro registrado`,
      referenceType: 'cobro',
      referenceId: cobro.id,
      isAuto: true,
      lines: [
        { accountCode: ACCOUNTS.CAJA, debit: amount, credit: 0, description: 'Caja y Bancos' },
        { accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: 0, credit: amount, description: 'Deudores por Ventas' },
      ],
    });

    // Exchange rate difference entry
    await this.createExchangeDiffEntry({
      companyId: cobro.company_id,
      date,
      referenceId: cobro.id,
      currency: cobro.currency,
      exchangeRate: cobro.exchange_rate,
      originalExchangeRate: cobro.original_exchange_rate,
      amountForeign: cobro.amount_foreign,
      bankAccountCode: ACCOUNTS.CAJA,
    });

    return mainEntry;
  }

  /**
   * Auto journal entry when a pago (payment) is created.
   * D: Proveedores (monto)
   * C: Caja/Bancos (monto)
   */
  async createEntryForPago(pago: PagoData): Promise<any> {
    // Skip accounting for cheque endorsements (handled by createEntryForChequeTransition)
    if (pago.payment_method === 'cheque_endosado' || pago.skip_accounting) return null;

    const amount = Number(pago.amount);
    const date = pago.date || new Date().toISOString().split('T')[0];

    const mainEntry = await this.createEntry({
      companyId: pago.company_id,
      date,
      description: `Pago registrado`,
      referenceType: 'pago',
      referenceId: pago.id,
      isAuto: true,
      lines: [
        { accountCode: ACCOUNTS.PROVEEDORES, debit: amount, credit: 0, description: 'Proveedores' },
        { accountCode: ACCOUNTS.CAJA, debit: 0, credit: amount, description: 'Caja y Bancos' },
      ],
    });

    // Exchange rate difference entry
    await this.createExchangeDiffEntry({
      companyId: pago.company_id,
      date,
      referenceId: pago.id,
      currency: pago.currency,
      exchangeRate: pago.exchange_rate,
      originalExchangeRate: pago.original_exchange_rate,
      amountForeign: pago.amount_foreign,
      bankAccountCode: ACCOUNTS.CAJA,
    });

    return mainEntry;
  }

  /**
   * Create an exchange rate difference entry when cobro/pago involves foreign currency.
   * Compares current exchange rate vs original invoice exchange rate.
   * Gain (positive diff): D: Bank / C: Dif Cambio Positiva
   * Loss (negative diff): D: Dif Cambio Negativa / C: Bank
   */
  private async createExchangeDiffEntry(params: {
    companyId: string;
    date: string;
    referenceId: string;
    currency?: string;
    exchangeRate?: number | string;
    originalExchangeRate?: number | string;
    amountForeign?: number | string;
    bankAccountCode: string;
  }): Promise<void> {
    const { companyId, date, referenceId, currency, exchangeRate, originalExchangeRate, amountForeign, bankAccountCode } = params;

    if (!currency || currency === 'ARS' || !exchangeRate || !originalExchangeRate) return;

    const foreignAmount = parseFloat(amountForeign?.toString() || '0');
    if (foreignAmount <= 0) return;

    const currentARS = foreignAmount * parseFloat(exchangeRate.toString());
    const originalARS = foreignAmount * parseFloat(originalExchangeRate.toString());
    const diff = Math.round((currentARS - originalARS) * 100) / 100;

    if (Math.abs(diff) <= 0.01) return;

    const diffAccountCode = diff > 0 ? ACCOUNTS.DIF_CAMBIO_POS : ACCOUNTS.DIF_CAMBIO_NEG;
    const diffAccountId = await this.getAccountId(companyId, diffAccountCode);
    const bankAccountId = await this.getAccountId(companyId, bankAccountCode);

    if (!diffAccountId || !bankAccountId) return;

    const diffEntryResult = await db.execute(sql`
      INSERT INTO journal_entries (company_id, date, description, reference_type, reference_id, is_auto)
      VALUES (${companyId}, ${date}::date, ${'Diferencia de cambio ' + currency}, 'exchange_diff', ${referenceId}, true)
      RETURNING id
    `);
    const diffEntryId = ((diffEntryResult as any).rows || [])[0]?.id;
    if (!diffEntryId) return;

    if (diff > 0) {
      // Gain: D: Bank (more ARS) / C: Dif Cambio Positiva
      await db.execute(sql`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES
        (${diffEntryId}, ${bankAccountId}, ${Math.abs(diff)}, 0, 'Diferencia TC favorable'),
        (${diffEntryId}, ${diffAccountId}, 0, ${Math.abs(diff)}, 'Ganancia por tipo de cambio')
      `);
    } else {
      // Loss: D: Dif Cambio Negativa / C: Bank (less ARS)
      await db.execute(sql`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description) VALUES
        (${diffEntryId}, ${diffAccountId}, ${Math.abs(diff)}, 0, 'Perdida por tipo de cambio'),
        (${diffEntryId}, ${bankAccountId}, 0, ${Math.abs(diff)}, 'Diferencia TC desfavorable')
      `);
    }
  }

  /**
   * Create an opening entry with initial balances.
   * Only one opening entry per company is allowed.
   */
  async createOpeningEntry(companyId: string, date: string, balances: Array<{
    account_code: string;
    debit: number;
    credit: number;
  }>): Promise<{ id: string }> {
    if (!await isAccountingEnabled(companyId)) {
      throw new ApiError(400, 'Contabilidad no esta activada');
    }

    // Validate balance
    const totalDebit = balances.reduce((s, b) => s + (b.debit || 0), 0);
    const totalCredit = balances.reduce((s, b) => s + (b.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new ApiError(400, `El asiento no balancea: Debe $${totalDebit.toFixed(2)} != Haber $${totalCredit.toFixed(2)}`);
    }

    // Check no existing opening entry
    const existing = await db.execute(sql`
      SELECT id FROM journal_entries
      WHERE company_id = ${companyId} AND reference_type = 'opening'
      LIMIT 1
    `);
    if (((existing as any).rows || []).length > 0) {
      throw new ApiError(400, 'Ya existe un asiento de apertura. Eliminelo primero si desea recrearlo.');
    }

    // Create entry
    const entryResult = await db.execute(sql`
      INSERT INTO journal_entries (company_id, date, description, reference_type, reference_id, is_auto)
      VALUES (${companyId}, ${date}::date, 'Asiento de apertura', 'opening', ${companyId}, false)
      RETURNING id
    `);
    const entryId = ((entryResult as any).rows || [])[0]?.id;
    if (!entryId) {
      throw new ApiError(500, 'Error creando asiento de apertura');
    }

    // Insert lines
    for (const balance of balances) {
      if (balance.debit === 0 && balance.credit === 0) continue;
      const accountId = await this.getAccountId(companyId, balance.account_code);
      if (!accountId) {
        throw new ApiError(400, `Cuenta ${balance.account_code} no encontrada`);
      }

      await db.execute(sql`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
        VALUES (${entryId}, ${accountId}, ${balance.debit || 0}, ${balance.credit || 0}, 'Saldo inicial')
      `);
    }

    return { id: entryId };
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
      { accountCode: ACCOUNTS.CMV, debit: neto, credit: 0, description: 'Compras / Gastos' },
    ];

    if (vat > 0) {
      lines.push({ accountCode: ACCOUNTS.IVA_CF_21, debit: vat, credit: 0, description: 'IVA Credito Fiscal' });
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

  /**
   * Ensure a dynamic bank sub-account exists under 1.1.2 for a given bank.
   * Returns the account code (e.g. '1.1.2.ab12cd34').
   */
  async ensureBankAccount(companyId: string, bankId: string): Promise<string> {
    const bankCode = `1.1.2.${bankId.substring(0, 8)}`;

    // Check if exists
    const existing = await db.execute(sql`
      SELECT code FROM chart_of_accounts
      WHERE company_id = ${companyId} AND code = ${bankCode}
    `);
    const rows = (existing as any).rows || [];
    if (rows.length > 0) return bankCode;

    // Get bank name
    const bankResult = await db.execute(sql`
      SELECT name FROM banks WHERE id = ${bankId} AND company_id = ${companyId}
    `);
    const bankRows = (bankResult as any).rows || [];
    const bankName = bankRows[0]?.name || 'Banco';

    // Find parent account 1.1.2
    const parentResult = await db.execute(sql`
      SELECT id FROM chart_of_accounts
      WHERE company_id = ${companyId} AND code = '1.1.2'
    `);
    const parentRows = (parentResult as any).rows || [];
    const parentId = parentRows[0]?.id;

    // Create dynamic bank account
    await db.execute(sql`
      INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, level, is_header)
      VALUES (${companyId}, ${bankCode}, ${'Banco ' + bankName}, 'activo', ${parentId}, 4, false)
      ON CONFLICT (company_id, code) DO NOTHING
    `);

    return bankCode;
  }

  /**
   * Auto journal entry for cheque status transitions.
   * Handles: depositado, cobrado, endosado, rechazado, a_cobrar (reverse).
   */
  async createEntryForChequeTransition(data: {
    id: string;
    company_id: string;
    amount: number | string;
    old_status: string;
    new_status: string;
    bank_id?: string;
    date?: string;
  }): Promise<void> {
    if (!await isAccountingEnabled(data.company_id)) return;
    const amount = parseFloat(data.amount?.toString() || '0');
    if (amount <= 0) return;

    let lines: Array<{accountCode: string; debit: number; credit: number; desc: string}> = [];

    switch (data.new_status) {
      case 'depositado':
        // D: Cheques Depositados / C: Cheques en Cartera
        lines = [
          { accountCode: ACCOUNTS.CHEQUES_DEPOSITADOS, debit: amount, credit: 0, desc: 'Cheque depositado' },
          { accountCode: ACCOUNTS.CHEQUES_CARTERA, debit: 0, credit: amount, desc: 'Cheque depositado' },
        ];
        break;

      case 'cobrado': {
        // D: Banco / C: Cheques Depositados (si venia de depositado) o Cheques Cartera (si directo)
        const bankCode = data.bank_id
          ? await this.ensureBankAccount(data.company_id, data.bank_id)
          : ACCOUNTS.CAJA;
        const creditCode = data.old_status === 'depositado'
          ? ACCOUNTS.CHEQUES_DEPOSITADOS
          : ACCOUNTS.CHEQUES_CARTERA;
        lines = [
          { accountCode: bankCode, debit: amount, credit: 0, desc: 'Cheque cobrado' },
          { accountCode: creditCode, debit: 0, credit: amount, desc: 'Cheque cobrado' },
        ];
        break;
      }

      case 'endosado':
        // D: Proveedores / C: Cheques en Cartera
        lines = [
          { accountCode: ACCOUNTS.PROVEEDORES, debit: amount, credit: 0, desc: 'Cheque endosado' },
          { accountCode: ACCOUNTS.CHEQUES_CARTERA, debit: 0, credit: amount, desc: 'Cheque endosado' },
        ];
        break;

      case 'rechazado': {
        // D: Deudores (recrea deuda) / C: Cheques (segun estado previo)
        const sourceCode = data.old_status === 'depositado'
          ? ACCOUNTS.CHEQUES_DEPOSITADOS
          : ACCOUNTS.CHEQUES_CARTERA;
        lines = [
          { accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: amount, credit: 0, desc: 'Cheque rechazado - recrea deuda' },
          { accountCode: sourceCode, debit: 0, credit: amount, desc: 'Cheque rechazado' },
        ];
        break;
      }

      case 'a_cobrar':
        // Vuelta a cartera = contra-asiento del estado anterior
        await this.createReverseEntry(data.company_id, 'cheque_' + data.old_status, data.id);
        return;

      default:
        return;
    }

    if (lines.length === 0) return;

    // Resolver account IDs
    const resolvedLines = [];
    for (const line of lines) {
      const accountId = await this.getAccountId(data.company_id, line.accountCode);
      if (!accountId) return;
      resolvedLines.push({ ...line, accountId });
    }

    // Crear asiento
    const entryResult = await db.execute(sql`
      INSERT INTO journal_entries (company_id, date, description, reference_type, reference_id, is_auto)
      VALUES (${data.company_id}, ${data.date || sql`NOW()`}, ${'Cheque ' + data.new_status}, ${'cheque_' + data.new_status}, ${data.id}, true)
      RETURNING id
    `);
    const entryId = ((entryResult as any).rows || [])[0]?.id;
    if (!entryId) return;

    for (const line of resolvedLines) {
      await db.execute(sql`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
        VALUES (${entryId}, ${line.accountId}, ${line.debit}, ${line.credit}, ${line.desc})
      `);
    }
  }

  /**
   * Auto journal entry for current account adjustments (debit/credit).
   * Debit adjustment: D: Deudores por Ventas / C: Ajustes CC Egresos
   * Credit adjustment: D: Ajustes CC Ingresos / C: Deudores por Ventas
   */
  async createEntryForAdjustment(data: {
    id: string;
    company_id: string;
    enterprise_id: string;
    adjustment_type: string; // 'debit' o 'credit'
    amount: number | string;
    reason?: string;
    date?: string;
  }): Promise<void> {
    if (!await isAccountingEnabled(data.company_id)) return;
    const amount = parseFloat(data.amount?.toString() || '0');
    if (amount <= 0) return;

    let debitCode: string;
    let creditCode: string;
    let desc: string;

    if (data.adjustment_type === 'debit') {
      // Aumenta deuda del cliente
      debitCode = ACCOUNTS.DEUDORES_VENTAS;  // 1.2.1
      creditCode = ACCOUNTS.AJUSTES_CC_EGR;  // 5.6
      desc = 'Ajuste CC debito: ' + (data.reason || '');
    } else {
      // Disminuye deuda del cliente
      debitCode = ACCOUNTS.AJUSTES_CC_ING;   // 4.4
      creditCode = ACCOUNTS.DEUDORES_VENTAS; // 1.2.1
      desc = 'Ajuste CC credito: ' + (data.reason || '');
    }

    const debitId = await this.getAccountId(data.company_id, debitCode);
    const creditId = await this.getAccountId(data.company_id, creditCode);
    if (!debitId || !creditId) return;

    const entryResult = await db.execute(sql`
      INSERT INTO journal_entries (company_id, date, description, reference_type, reference_id, is_auto)
      VALUES (${data.company_id}, ${data.date || sql`NOW()`}, ${desc}, 'adjustment', ${data.id}, true)
      RETURNING id
    `);
    const entryId = ((entryResult as any).rows || [])[0]?.id;
    if (!entryId) return;

    await db.execute(sql`
      INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
      VALUES
        (${entryId}, ${debitId}, ${amount}, 0, ${desc}),
        (${entryId}, ${creditId}, 0, ${amount}, ${desc})
    `);
  }

  /**
   * Create a reverse (contra) entry for a given reference, swapping debit/credit.
   */
  async createReverseEntry(companyId: string, referenceType: string, referenceId: string): Promise<void> {
    if (!await isAccountingEnabled(companyId)) return;

    // Find original entry
    const entryResult = await db.execute(sql`
      SELECT je.id, je.description, je.date
      FROM journal_entries je
      WHERE je.company_id = ${companyId}
        AND je.reference_type = ${referenceType}
        AND je.reference_id = ${referenceId}
      ORDER BY je.created_at DESC LIMIT 1
    `);
    const entries = (entryResult as any).rows || [];
    if (entries.length === 0) return; // No entry to reverse

    const original = entries[0];

    // Get original lines
    const linesResult = await db.execute(sql`
      SELECT account_id, debit, credit, description
      FROM journal_entry_lines WHERE entry_id = ${original.id}
    `);
    const lines = (linesResult as any).rows || [];
    if (lines.length === 0) return;

    // Create reverse entry
    const reverseResult = await db.execute(sql`
      INSERT INTO journal_entries (company_id, date, description, reference_type, reference_id, is_auto)
      VALUES (${companyId}, NOW(), ${'Anulacion: ' + (original.description || '')}, ${referenceType + '_reversal'}, ${referenceId}, true)
      RETURNING id
    `);
    const reverseId = ((reverseResult as any).rows || [])[0]?.id;
    if (!reverseId) return;

    // Insert reversed lines (swap debit/credit)
    for (const line of lines) {
      await db.execute(sql`
        INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
        VALUES (${reverseId}, ${line.account_id}, ${parseFloat(line.credit) || 0}, ${parseFloat(line.debit) || 0}, ${'Anulacion: ' + (line.description || '')})
      `);
    }
  }

  /**
   * Libro Mayor: detailed ledger for a specific account with running balance.
   */
  async getLedger(companyId: string, accountCode: string, filters?: { date_from?: string; date_to?: string }): Promise<any[]> {
    const dateConditions: any[] = [];
    if (filters?.date_from) {
      dateConditions.push(sql`je.date >= ${filters.date_from}::date`);
    }
    if (filters?.date_to) {
      dateConditions.push(sql`je.date <= ${filters.date_to}::date`);
    }

    const dateFilter = dateConditions.length > 0
      ? sql`AND ${sql.join(dateConditions, sql` AND `)}`
      : sql``;

    const result = await db.execute(sql`
      SELECT
        je.date,
        je.description as entry_description,
        je.reference_type,
        je.reference_id,
        je.entry_number,
        jel.debit::numeric as debit,
        jel.credit::numeric as credit,
        jel.description as line_description,
        je.created_at,
        coa.type as account_type
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      JOIN chart_of_accounts coa ON jel.account_id = coa.id
      WHERE je.company_id = ${companyId}
        AND coa.code = ${accountCode}
        ${dateFilter}
      ORDER BY je.date ASC, je.entry_number ASC, je.created_at ASC
    `);

    const rows = (result as any).rows || result || [];

    // Calculate running balance (saldo progresivo)
    // activo/egreso: saldo += debit - credit
    // pasivo/ingreso/patrimonio: saldo += credit - debit
    let runningBalance = 0;
    const accountType = rows[0]?.account_type;
    const isDebitNature = accountType === 'activo' || accountType === 'egreso';

    return rows.map((row: any) => {
      const debit = parseFloat(row.debit) || 0;
      const credit = parseFloat(row.credit) || 0;

      if (isDebitNature) {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }

      return {
        date: row.date,
        entry_description: row.entry_description,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        entry_number: row.entry_number,
        debit,
        credit,
        line_description: row.line_description,
        created_at: row.created_at,
        account_type: row.account_type,
        running_balance: Math.round(runningBalance * 100) / 100,
      };
    });
  }

  /**
   * Balance General: assets, liabilities, equity grouped by type.
   * activo = pasivo + patrimonio + resultado
   */
  async getBalanceSheet(companyId: string, date?: string): Promise<any> {
    const dateFilter = date
      ? sql`AND je.date <= ${date}::date`
      : sql``;

    const result = await db.execute(sql`
      SELECT
        coa.code,
        coa.name,
        coa.type,
        coa.level,
        coa.is_header,
        COALESCE(SUM(jel.debit), 0)::numeric as total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric as total_credit
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id
        AND je.company_id = ${companyId}
        ${dateFilter}
      WHERE coa.company_id = ${companyId}
        AND coa.type IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'egreso')
      GROUP BY coa.id, coa.code, coa.name, coa.type, coa.level, coa.is_header
      HAVING COALESCE(SUM(jel.debit), 0) != 0 OR COALESCE(SUM(jel.credit), 0) != 0
      ORDER BY coa.code
    `);

    const rows = (result as any).rows || result || [];

    const activo: any[] = [];
    const pasivo: any[] = [];
    const patrimonio: any[] = [];
    let totalActivo = 0;
    let totalPasivo = 0;
    let totalPatrimonio = 0;
    let totalIngresos = 0;
    let totalEgresos = 0;

    for (const row of rows) {
      const debit = parseFloat(row.total_debit) || 0;
      const credit = parseFloat(row.total_credit) || 0;
      let balance: number;

      if (row.type === 'activo' || row.type === 'egreso') {
        balance = debit - credit;
      } else {
        balance = credit - debit;
      }

      balance = Math.round(balance * 100) / 100;

      const account = { code: row.code, name: row.name, type: row.type, level: row.level, balance };

      switch (row.type) {
        case 'activo':
          activo.push(account);
          totalActivo += balance;
          break;
        case 'pasivo':
          pasivo.push(account);
          totalPasivo += balance;
          break;
        case 'patrimonio':
          patrimonio.push(account);
          totalPatrimonio += balance;
          break;
        case 'ingreso':
          totalIngresos += balance;
          break;
        case 'egreso':
          totalEgresos += balance;
          break;
      }
    }

    const resultado = Math.round((totalIngresos - totalEgresos) * 100) / 100;
    totalActivo = Math.round(totalActivo * 100) / 100;
    totalPasivo = Math.round(totalPasivo * 100) / 100;
    totalPatrimonio = Math.round(totalPatrimonio * 100) / 100;

    return {
      activo: { total: totalActivo, cuentas: activo },
      pasivo: { total: totalPasivo, cuentas: pasivo },
      patrimonio: { total: totalPatrimonio, cuentas: patrimonio },
      resultado,
      balanced: Math.abs(totalActivo - (totalPasivo + totalPatrimonio + resultado)) < 0.01,
    };
  }

  /**
   * Estado de Resultados: income vs expenses for a period.
   */
  async getIncomeStatement(companyId: string, filters?: { date_from?: string; date_to?: string }): Promise<any> {
    const dateConditions: any[] = [];
    if (filters?.date_from) {
      dateConditions.push(sql`je.date >= ${filters.date_from}::date`);
    }
    if (filters?.date_to) {
      dateConditions.push(sql`je.date <= ${filters.date_to}::date`);
    }

    const dateFilter = dateConditions.length > 0
      ? sql`AND ${sql.join(dateConditions, sql` AND `)}`
      : sql``;

    const result = await db.execute(sql`
      SELECT
        coa.code,
        coa.name,
        coa.type,
        coa.level,
        COALESCE(SUM(jel.debit), 0)::numeric as total_debit,
        COALESCE(SUM(jel.credit), 0)::numeric as total_credit
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je ON je.id = jel.entry_id
        AND je.company_id = ${companyId}
        ${dateFilter}
      WHERE coa.company_id = ${companyId}
        AND coa.type IN ('ingreso', 'egreso')
      GROUP BY coa.id, coa.code, coa.name, coa.type, coa.level
      HAVING COALESCE(SUM(jel.debit), 0) != 0 OR COALESCE(SUM(jel.credit), 0) != 0
      ORDER BY coa.code
    `);

    const rows = (result as any).rows || result || [];

    const ingresos: any[] = [];
    const egresos: any[] = [];
    let totalIngresos = 0;
    let totalEgresos = 0;

    for (const row of rows) {
      const debit = parseFloat(row.total_debit) || 0;
      const credit = parseFloat(row.total_credit) || 0;

      if (row.type === 'ingreso') {
        const balance = Math.round((credit - debit) * 100) / 100;
        ingresos.push({ code: row.code, name: row.name, level: row.level, balance });
        totalIngresos += balance;
      } else {
        const balance = Math.round((debit - credit) * 100) / 100;
        egresos.push({ code: row.code, name: row.name, level: row.level, balance });
        totalEgresos += balance;
      }
    }

    totalIngresos = Math.round(totalIngresos * 100) / 100;
    totalEgresos = Math.round(totalEgresos * 100) / 100;

    return {
      ingresos: { total: totalIngresos, detalle: ingresos },
      egresos: { total: totalEgresos, detalle: egresos },
      resultado: Math.round((totalIngresos - totalEgresos) * 100) / 100,
    };
  }
}

export const accountingEntriesService = new AccountingEntriesService();
