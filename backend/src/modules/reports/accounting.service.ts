import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

// Spanish month names for periodo_label
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// AFIP CbteTipo codes (RG 4597 Libro IVA Digital)
const CBTE_TIPO_MAP: Record<string, number> = {
  'A': 1, 'B': 6, 'C': 11,
  'NDA': 2, 'NDB': 7, 'NDC': 12,
  'NCA': 3, 'NCB': 8, 'NCC': 13,
  'E': 19, 'NDE': 20, 'NCE': 21,
  'FCE_A': 201, 'FCE_B': 206, 'FCE_C': 211,
};

// AFIP document type codes (RG 4597)
function resolveDocTipo(cuit: string): number {
  if (!cuit || cuit === '0' || cuit === '00000000000') return 99; // Consumidor Final
  const clean = cuit.replace(/[-.\s]/g, '');
  if (clean.length === 11) return 80; // CUIT
  if (clean.length >= 7 && clean.length <= 8) return 96; // DNI
  return 99; // Consumidor Final
}

// Resolve AFIP CbteTipo: prefer afip_response, fallback to letter map
function resolveCbteTipo(invoiceType: string | null, afipResponse: any): number {
  const fromAfip = afipResponse?.FeCabResp?.CbteTipo
    ?? afipResponse?.FECAESolicitarResult?.FeCabResp?.CbteTipo;
  if (fromAfip) return parseInt(String(fromAfip), 10);
  return CBTE_TIPO_MAP[invoiceType || 'B'] || 6;
}

// Max rows for Libro IVA queries to prevent memory issues
const LIBRO_MAX_ROWS = 10000;
// Max months for monthly reports (Posicion IVA, Flujo de Caja)
const MAX_MONTHS = 36;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function formatPeriodoLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Validates and normalizes date parameters.
 * Returns { dateFrom, dateTo } with defaults to current month if missing/invalid.
 */
function validateDateRange(dateFrom?: string, dateTo?: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

  const defaultFrom = `${y}-${m}-01`;
  const defaultTo = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;

  const validFrom = dateFrom && DATE_REGEX.test(dateFrom) && !isNaN(Date.parse(dateFrom))
    ? dateFrom
    : defaultFrom;
  const validTo = dateTo && DATE_REGEX.test(dateTo) && !isNaN(Date.parse(dateTo))
    ? dateTo
    : defaultTo;

  return { dateFrom: validFrom, dateTo: validTo };
}

// Generate all YYYY-MM periods between two dates (inclusive), capped at MAX_MONTHS
function generateMonthRange(dateFrom: string, dateTo: string): string[] {
  const start = new Date(dateFrom + 'T00:00:00');
  const end = new Date(dateTo + 'T00:00:00');
  const periods: string[] = [];

  let year = start.getFullYear();
  let month = start.getMonth() + 1;
  const endYear = end.getFullYear();
  const endMonth = end.getMonth() + 1;

  while ((year < endYear || (year === endYear && month <= endMonth)) && periods.length < MAX_MONTHS) {
    periods.push(`${year}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return periods;
}

/**
 * Safely round a number to 2 decimal places.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class AccountingService {
  /**
   * Libro IVA Ventas: authorized invoices with IVA breakdown by rate
   */
  async getLibroIVAVentas(companyId: string, dateFrom: string, dateTo: string, businessUnitId?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);

      // Build optional business_unit filter
      // Libro IVA only includes fiscal invoices from fiscal business units
      const buFilter = businessUnitId
        ? sql`AND i.business_unit_id = ${businessUnitId}`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          TO_CHAR(i.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as invoice_date,
          i.invoice_type,
          i.invoice_number,
          COALESCE((i.afip_response->'FeCabResp'->>'PtoVta')::int, 3) as punto_venta,
          i.afip_response,
          COALESCE(c.name, 'Consumidor Final') as customer_name,
          COALESCE(c.cuit, '') as customer_cuit,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) > 0 THEN COALESCE(CAST(ii.subtotal AS decimal), 0) ELSE 0 END), 0) as neto_gravado,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) = 0 THEN COALESCE(CAST(ii.subtotal AS decimal), 0) ELSE 0 END), 0) as neto_no_gravado,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) = 27 THEN ROUND(COALESCE(CAST(ii.subtotal AS decimal), 0) * 0.27, 2) ELSE 0 END), 0) as iva_27,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) = 21 THEN ROUND(COALESCE(CAST(ii.subtotal AS decimal), 0) * 0.21, 2) ELSE 0 END), 0) as iva_21,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) = 10.5 THEN ROUND(COALESCE(CAST(ii.subtotal AS decimal), 0) * 0.105, 2) ELSE 0 END), 0) as iva_10_5,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) = 5 THEN ROUND(COALESCE(CAST(ii.subtotal AS decimal), 0) * 0.05, 2) ELSE 0 END), 0) as iva_5,
          COALESCE(SUM(CASE WHEN COALESCE(CAST(ii.vat_rate AS decimal), 21) = 2.5 THEN ROUND(COALESCE(CAST(ii.subtotal AS decimal), 0) * 0.025, 2) ELSE 0 END), 0) as iva_2_5,
          0 as iva_0,
          COALESCE(CAST(i.vat_amount AS decimal), 0) as total_iva,
          COALESCE(CAST(i.total_amount AS decimal), 0) as total
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        JOIN invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN business_units bu ON i.business_unit_id = bu.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)
          AND (bu.is_fiscal = true OR i.business_unit_id IS NULL)
          AND (i.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (i.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
          ${buFilter}
        GROUP BY i.id, i.invoice_date, i.invoice_type, i.invoice_number, i.vat_amount, i.total_amount, i.afip_response, c.name, c.cuit
        ORDER BY i.invoice_date ASC, i.invoice_number ASC
        LIMIT ${LIBRO_MAX_ROWS}
      `);

      const rows = ((result as any).rows || result || []).map((r: any) => {
        const puntoVenta = Number(r.punto_venta) || 3;
        const invoiceNumber = Number(r.invoice_number) || 0;
        const pvStr = String(puntoVenta).padStart(5, '0');
        const numStr = String(invoiceNumber).padStart(8, '0');
        const cbteTipo = resolveCbteTipo(r.invoice_type, r.afip_response);
        const codDocReceptor = resolveDocTipo(r.customer_cuit);
        return {
          invoice_date: r.invoice_date,
          tipo_cbte: cbteTipo,
          punto_venta: puntoVenta,
          numero_desde: invoiceNumber,
          numero_hasta: invoiceNumber,
          comprobante: `${r.invoice_type || 'B'} ${pvStr}-${numStr}`,
          cod_doc_receptor: codDocReceptor,
          nro_doc_receptor: (r.customer_cuit || '').replace(/[-.\s]/g, ''),
          customer_name: r.customer_name,
          customer_cuit: r.customer_cuit,
          neto_gravado: parseFloat(r.neto_gravado) || 0,
          neto_no_gravado: parseFloat(r.neto_no_gravado) || 0,
          op_exentas: 0,
          iva_27: parseFloat(r.iva_27) || 0,
          iva_21: parseFloat(r.iva_21) || 0,
          iva_10_5: parseFloat(r.iva_10_5) || 0,
          iva_5: parseFloat(r.iva_5) || 0,
          iva_2_5: parseFloat(r.iva_2_5) || 0,
          iva_0: 0,
          total_iva: parseFloat(r.total_iva) || 0,
          otros_tributos: 0,
          total: parseFloat(r.total) || 0,
        };
      });

      // Calculate totals row (immutable accumulation)
      const rawTotals = rows.reduce(
        (acc: any, row: any) => ({
          neto_gravado: acc.neto_gravado + row.neto_gravado,
          neto_no_gravado: acc.neto_no_gravado + row.neto_no_gravado,
          op_exentas: acc.op_exentas + row.op_exentas,
          iva_27: acc.iva_27 + row.iva_27,
          iva_21: acc.iva_21 + row.iva_21,
          iva_10_5: acc.iva_10_5 + row.iva_10_5,
          iva_5: acc.iva_5 + row.iva_5,
          iva_2_5: acc.iva_2_5 + row.iva_2_5,
          iva_0: 0,
          total_iva: acc.total_iva + row.total_iva,
          otros_tributos: acc.otros_tributos + row.otros_tributos,
          total: acc.total + row.total,
        }),
        {
          neto_gravado: 0, neto_no_gravado: 0, op_exentas: 0,
          iva_27: 0, iva_21: 0, iva_10_5: 0, iva_5: 0, iva_2_5: 0, iva_0: 0,
          total_iva: 0, otros_tributos: 0, total: 0,
        },
      );

      // Round totals (create new object to avoid mutation)
      const totals = Object.fromEntries(
        Object.entries(rawTotals).map(([key, value]) => [key, round2(value as number)]),
      );

      return { rows, totals };
    } catch (error) {
      console.error('Libro IVA Ventas error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate Libro IVA Ventas');
    }
  }

  /**
   * Libro IVA Compras: active purchases with supplier info
   */
  async getLibroIVACompras(companyId: string, dateFrom: string, dateTo: string, businessUnitId?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);

      const buFilter = businessUnitId
        ? sql`AND pi.business_unit_id = ${businessUnitId}`
        : sql``;

      // Use purchase_invoices table (facturas de compra) instead of purchases
      // Only include invoices from fiscal business units
      const result = await db.execute(sql`
        SELECT
          TO_CHAR(pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as date,
          pi.invoice_type,
          COALESCE(pi.punto_venta, '') as punto_venta,
          pi.invoice_number,
          COALESCE(e.name, 'Proveedor desconocido') as enterprise_name,
          COALESCE(e.cuit, '') as enterprise_cuit,
          COALESCE(CAST(pi.subtotal AS decimal), COALESCE(CAST(pi.total_amount AS decimal), 0) - COALESCE(CAST(pi.vat_amount AS decimal), 0)) as neto_gravado,
          0 as neto_no_gravado,
          0 as op_exentas,
          COALESCE(CAST(pi.vat_amount AS decimal), 0) as iva,
          COALESCE(CAST(pi.other_taxes AS decimal), 0) as otros_tributos,
          COALESCE(CAST(pi.total_amount AS decimal), 0) as total
        FROM purchase_invoices pi
        LEFT JOIN enterprises e ON pi.enterprise_id = e.id
        LEFT JOIN business_units bu ON pi.business_unit_id = bu.id
        WHERE pi.company_id = ${companyId}
          AND pi.status = 'active'
          AND (bu.is_fiscal = true OR pi.business_unit_id IS NULL)
          AND (pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
          ${buFilter}
        ORDER BY pi.invoice_date ASC, pi.invoice_number ASC
        LIMIT ${LIBRO_MAX_ROWS}
      `);

      const rows = ((result as any).rows || result || []).map((r: any) => {
        const invoiceType = r.invoice_type || '';
        const pv = r.punto_venta || '';
        const num = r.invoice_number || '';
        const pvStr = pv ? String(pv).padStart(5, '0') : '00000';
        const numStr = num ? String(num).padStart(8, '0') : '00000000';
        const comprobante = (invoiceType || pv || num)
          ? `${invoiceType} ${pvStr}-${numStr}`.trim()
          : 'S/C';
        const cbteTipo = CBTE_TIPO_MAP[invoiceType] || 0;
        const codDocEmisor = resolveDocTipo(r.enterprise_cuit);
        return {
          date: r.date,
          tipo_cbte: cbteTipo,
          punto_venta: pv ? parseInt(String(pv), 10) || 0 : 0,
          numero_desde: num ? parseInt(String(num), 10) || 0 : 0,
          numero_hasta: num ? parseInt(String(num), 10) || 0 : 0,
          comprobante,
          cod_doc_emisor: codDocEmisor,
          nro_doc_emisor: (r.enterprise_cuit || '').replace(/[-.\s]/g, ''),
          enterprise_name: r.enterprise_name,
          enterprise_cuit: r.enterprise_cuit,
          neto_gravado: parseFloat(r.neto_gravado) || 0,
          neto_no_gravado: parseFloat(r.neto_no_gravado) || 0,
          op_exentas: parseFloat(r.op_exentas) || 0,
          iva: parseFloat(r.iva) || 0,
          otros_tributos: parseFloat(r.otros_tributos) || 0,
          total: parseFloat(r.total) || 0,
        };
      });

      const rawTotals = rows.reduce(
        (acc: any, row: any) => ({
          neto_gravado: acc.neto_gravado + row.neto_gravado,
          neto_no_gravado: acc.neto_no_gravado + row.neto_no_gravado,
          op_exentas: acc.op_exentas + row.op_exentas,
          iva: acc.iva + row.iva,
          otros_tributos: acc.otros_tributos + row.otros_tributos,
          total: acc.total + row.total,
        }),
        { neto_gravado: 0, neto_no_gravado: 0, op_exentas: 0, iva: 0, otros_tributos: 0, total: 0 },
      );

      const totals = Object.fromEntries(
        Object.entries(rawTotals).map(([key, value]) => [key, round2(value as number)]),
      );

      return { rows, totals };
    } catch (error) {
      console.error('Libro IVA Compras error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate Libro IVA Compras');
    }
  }

  /**
   * Posicion IVA: monthly debito fiscal vs credito fiscal
   */
  async getPosicionIVA(companyId: string, dateFrom: string, dateTo: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);

      // Debito fiscal: IVA from authorized invoices by month
      const debitoResult = await db.execute(sql`
        SELECT
          TO_CHAR(invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(COALESCE(CAST(vat_amount AS decimal), 0)), 0) as debito_fiscal
        FROM invoices
        WHERE company_id = ${companyId}
          AND status = 'authorized'
          AND (invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
        GROUP BY TO_CHAR(invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Credito fiscal: IVA from purchase_invoices (facturas de compra) by month
      // Only from fiscal business units
      const creditoResult = await db.execute(sql`
        SELECT
          TO_CHAR(pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(COALESCE(CAST(pi.vat_amount AS decimal), 0)), 0) as credito_fiscal
        FROM purchase_invoices pi
        LEFT JOIN business_units bu ON pi.business_unit_id = bu.id
        WHERE pi.company_id = ${companyId}
          AND pi.status = 'active'
          AND (bu.is_fiscal = true OR pi.business_unit_id IS NULL)
          AND (pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
        GROUP BY TO_CHAR(pi.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Build lookup maps
      const debitoMap = new Map<string, number>();
      for (const r of ((debitoResult as any).rows || debitoResult || []) as any[]) {
        debitoMap.set(r.periodo, parseFloat(r.debito_fiscal) || 0);
      }

      const creditoMap = new Map<string, number>();
      for (const r of ((creditoResult as any).rows || creditoResult || []) as any[]) {
        creditoMap.set(r.periodo, parseFloat(r.credito_fiscal) || 0);
      }

      // Generate all months in range (capped at MAX_MONTHS)
      const periods = generateMonthRange(dates.dateFrom, dates.dateTo);
      const rows = periods.map((periodo) => {
        const [yearStr, monthStr] = periodo.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        const debito = debitoMap.get(periodo) || 0;
        const credito = creditoMap.get(periodo) || 0;
        const saldo = round2(debito - credito);
        return {
          periodo,
          periodo_label: formatPeriodoLabel(year, month),
          debito_fiscal: round2(debito),
          credito_fiscal: round2(credito),
          saldo,
        };
      });

      return { rows };
    } catch (error) {
      console.error('Posicion IVA error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate Posicion IVA');
    }
  }

  /**
   * Flujo de Caja: monthly cash flow (cobros + cheques cobrados vs pagos)
   */
  async getFlujoCaja(companyId: string, dateFrom: string, dateTo: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);

      // Cobros (ingresos) - fallback payment_date to created_at if NULL
      const cobrosResult = await db.execute(sql`
        SELECT
          TO_CHAR(COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(COALESCE(CAST(amount AS decimal), 0)), 0) as total
        FROM cobros
        WHERE company_id = ${companyId}
          AND (COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
        GROUP BY TO_CHAR(COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Cheques cobrados (ingresos)
      const chequesResult = await db.execute(sql`
        SELECT
          TO_CHAR(collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(COALESCE(CAST(amount AS decimal), 0)), 0) as total
        FROM cheques
        WHERE company_id = ${companyId}
          AND status = 'cobrado'
          AND collected_date IS NOT NULL
          AND (collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
        GROUP BY TO_CHAR(collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Pagos (egresos) - fallback payment_date to created_at if NULL
      const pagosResult = await db.execute(sql`
        SELECT
          TO_CHAR(COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(COALESCE(CAST(amount AS decimal), 0)), 0) as total
        FROM pagos
        WHERE company_id = ${companyId}
          AND (COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dates.dateFrom}::date
          AND (COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dates.dateTo}::date
        GROUP BY TO_CHAR(COALESCE(payment_date, created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Build lookup maps
      const cobrosMap = new Map<string, number>();
      for (const r of ((cobrosResult as any).rows || cobrosResult || []) as any[]) {
        cobrosMap.set(r.periodo, parseFloat(r.total) || 0);
      }

      const chequesMap = new Map<string, number>();
      for (const r of ((chequesResult as any).rows || chequesResult || []) as any[]) {
        chequesMap.set(r.periodo, parseFloat(r.total) || 0);
      }

      const pagosMap = new Map<string, number>();
      for (const r of ((pagosResult as any).rows || pagosResult || []) as any[]) {
        pagosMap.set(r.periodo, parseFloat(r.total) || 0);
      }

      // Generate all months and calculate running total (capped at MAX_MONTHS)
      const periods = generateMonthRange(dates.dateFrom, dates.dateTo);
      let acumulado = 0;

      const rows = periods.map((periodo) => {
        const [yearStr, monthStr] = periodo.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);

        const cobros = cobrosMap.get(periodo) || 0;
        const cheques = chequesMap.get(periodo) || 0;
        const ingresos = round2(cobros + cheques);
        const egresos = round2(pagosMap.get(periodo) || 0);
        const neto = round2(ingresos - egresos);
        acumulado = round2(acumulado + neto);

        return {
          periodo,
          periodo_label: formatPeriodoLabel(year, month),
          ingresos,
          egresos,
          neto,
          acumulado,
        };
      });

      return { rows };
    } catch (error) {
      console.error('Flujo de Caja error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate Flujo de Caja');
    }
  }
}

export const accountingService = new AccountingService();
