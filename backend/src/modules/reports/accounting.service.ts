import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

// Spanish month names for periodo_label
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatPeriodoLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Generate all YYYY-MM periods between two dates (inclusive)
function generateMonthRange(dateFrom: string, dateTo: string): string[] {
  const start = new Date(dateFrom + 'T00:00:00');
  const end = new Date(dateTo + 'T00:00:00');
  const periods: string[] = [];

  let year = start.getFullYear();
  let month = start.getMonth() + 1;
  const endYear = end.getFullYear();
  const endMonth = end.getMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    periods.push(`${year}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return periods;
}

export class AccountingService {
  /**
   * Libro IVA Ventas: authorized invoices with IVA breakdown by rate
   */
  async getLibroIVAVentas(companyId: string, dateFrom: string, dateTo: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          TO_CHAR(i.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as invoice_date,
          i.invoice_type,
          i.invoice_number,
          COALESCE((i.afip_response->'FeCabResp'->>'PtoVta')::int, 3) as punto_venta,
          COALESCE(c.name, 'Consumidor Final') as customer_name,
          COALESCE(c.cuit, '') as customer_cuit,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) > 0 THEN CAST(ii.subtotal AS decimal) ELSE 0 END), 0) as neto_gravado,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) = 0 THEN CAST(ii.subtotal AS decimal) ELSE 0 END), 0) as neto_no_gravado,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) = 27 THEN ROUND(CAST(ii.subtotal AS decimal) * 0.27, 2) ELSE 0 END), 0) as iva_27,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) = 21 THEN ROUND(CAST(ii.subtotal AS decimal) * 0.21, 2) ELSE 0 END), 0) as iva_21,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) = 10.5 THEN ROUND(CAST(ii.subtotal AS decimal) * 0.105, 2) ELSE 0 END), 0) as iva_10_5,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) = 5 THEN ROUND(CAST(ii.subtotal AS decimal) * 0.05, 2) ELSE 0 END), 0) as iva_5,
          COALESCE(SUM(CASE WHEN CAST(ii.vat_rate AS decimal) = 2.5 THEN ROUND(CAST(ii.subtotal AS decimal) * 0.025, 2) ELSE 0 END), 0) as iva_2_5,
          0 as iva_0,
          CAST(i.vat_amount AS decimal) as total_iva,
          CAST(i.total_amount AS decimal) as total
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        JOIN invoice_items ii ON ii.invoice_id = i.id
        WHERE i.company_id = ${companyId}
          AND i.status = 'authorized'
          AND (i.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (i.invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        GROUP BY i.id, i.invoice_date, i.invoice_type, i.invoice_number, i.vat_amount, i.total_amount, i.afip_response, c.name, c.cuit
        ORDER BY i.invoice_date ASC, i.invoice_number ASC
      `);

      const rows = ((result as any).rows || result || []).map((r: any) => {
        const pvStr = String(r.punto_venta || 3).padStart(5, '0');
        const numStr = String(r.invoice_number || 0).padStart(8, '0');
        return {
          invoice_date: r.invoice_date,
          comprobante: `${r.invoice_type || 'B'} ${pvStr}-${numStr}`,
          customer_name: r.customer_name,
          customer_cuit: r.customer_cuit,
          neto_gravado: parseFloat(r.neto_gravado) || 0,
          neto_no_gravado: parseFloat(r.neto_no_gravado) || 0,
          iva_27: parseFloat(r.iva_27) || 0,
          iva_21: parseFloat(r.iva_21) || 0,
          iva_10_5: parseFloat(r.iva_10_5) || 0,
          iva_5: parseFloat(r.iva_5) || 0,
          iva_2_5: parseFloat(r.iva_2_5) || 0,
          iva_0: 0,
          total_iva: parseFloat(r.total_iva) || 0,
          total: parseFloat(r.total) || 0,
        };
      });

      // Calculate totals row
      const totals = rows.reduce(
        (acc: any, row: any) => ({
          neto_gravado: acc.neto_gravado + row.neto_gravado,
          neto_no_gravado: acc.neto_no_gravado + row.neto_no_gravado,
          iva_27: acc.iva_27 + row.iva_27,
          iva_21: acc.iva_21 + row.iva_21,
          iva_10_5: acc.iva_10_5 + row.iva_10_5,
          iva_5: acc.iva_5 + row.iva_5,
          iva_2_5: acc.iva_2_5 + row.iva_2_5,
          iva_0: 0,
          total_iva: acc.total_iva + row.total_iva,
          total: acc.total + row.total,
        }),
        {
          neto_gravado: 0, neto_no_gravado: 0,
          iva_27: 0, iva_21: 0, iva_10_5: 0, iva_5: 0, iva_2_5: 0, iva_0: 0,
          total_iva: 0, total: 0,
        },
      );

      // Round totals
      for (const key of Object.keys(totals)) {
        totals[key] = Math.round(totals[key] * 100) / 100;
      }

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
  async getLibroIVACompras(companyId: string, dateFrom: string, dateTo: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          TO_CHAR(p.date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as date,
          p.invoice_type,
          p.invoice_number,
          COALESCE(e.name, 'Proveedor desconocido') as enterprise_name,
          COALESCE(e.cuit, '') as enterprise_cuit,
          COALESCE(CAST(p.subtotal AS decimal), 0) as neto_gravado,
          COALESCE(CAST(p.vat_amount AS decimal), 0) as iva,
          COALESCE(CAST(p.total_amount AS decimal), 0) as total
        FROM purchases p
        LEFT JOIN enterprises e ON p.enterprise_id = e.id
        WHERE p.company_id = ${companyId}
          AND p.status = 'activa'
          AND (p.date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (p.date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        ORDER BY p.date ASC, p.purchase_number ASC
      `);

      const rows = ((result as any).rows || result || []).map((r: any) => {
        const invoiceType = r.invoice_type || '';
        const invoiceNumber = r.invoice_number || '';
        const comprobante = (invoiceType || invoiceNumber)
          ? `${invoiceType} ${invoiceNumber}`.trim()
          : 'S/C';
        return {
          date: r.date,
          comprobante,
          enterprise_name: r.enterprise_name,
          enterprise_cuit: r.enterprise_cuit,
          neto_gravado: parseFloat(r.neto_gravado) || 0,
          iva: parseFloat(r.iva) || 0,
          total: parseFloat(r.total) || 0,
        };
      });

      const totals = rows.reduce(
        (acc: any, row: any) => ({
          neto_gravado: acc.neto_gravado + row.neto_gravado,
          iva: acc.iva + row.iva,
          total: acc.total + row.total,
        }),
        { neto_gravado: 0, iva: 0, total: 0 },
      );

      for (const key of Object.keys(totals)) {
        totals[key] = Math.round(totals[key] * 100) / 100;
      }

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
      // Debito fiscal: IVA from authorized invoices by month
      const debitoResult = await db.execute(sql`
        SELECT
          TO_CHAR(invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(vat_amount AS decimal)), 0) as debito_fiscal
        FROM invoices
        WHERE company_id = ${companyId}
          AND status = 'authorized'
          AND (invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        GROUP BY TO_CHAR(invoice_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Credito fiscal: IVA from active purchases by month
      const creditoResult = await db.execute(sql`
        SELECT
          TO_CHAR(date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(vat_amount AS decimal)), 0) as credito_fiscal
        FROM purchases
        WHERE company_id = ${companyId}
          AND status = 'activa'
          AND (date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        GROUP BY TO_CHAR(date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
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

      // Generate all months in range
      const periods = generateMonthRange(dateFrom, dateTo);
      const rows = periods.map((periodo) => {
        const [yearStr, monthStr] = periodo.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);
        const debito = debitoMap.get(periodo) || 0;
        const credito = creditoMap.get(periodo) || 0;
        const saldo = Math.round((debito - credito) * 100) / 100;
        return {
          periodo,
          periodo_label: formatPeriodoLabel(year, month),
          debito_fiscal: Math.round(debito * 100) / 100,
          credito_fiscal: Math.round(credito * 100) / 100,
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
      // Cobros (ingresos)
      const cobrosResult = await db.execute(sql`
        SELECT
          TO_CHAR(payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total
        FROM cobros
        WHERE company_id = ${companyId}
          AND (payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        GROUP BY TO_CHAR(payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Cheques cobrados (ingresos)
      const chequesResult = await db.execute(sql`
        SELECT
          TO_CHAR(collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total
        FROM cheques
        WHERE company_id = ${companyId}
          AND status = 'cobrado'
          AND collected_date IS NOT NULL
          AND (collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        GROUP BY TO_CHAR(collected_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
      `);

      // Pagos (egresos)
      const pagosResult = await db.execute(sql`
        SELECT
          TO_CHAR(payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total
        FROM pagos
        WHERE company_id = ${companyId}
          AND (payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= ${dateFrom}::date
          AND (payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= ${dateTo}::date
        GROUP BY TO_CHAR(payment_date AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
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

      // Generate all months and calculate running total
      const periods = generateMonthRange(dateFrom, dateTo);
      let acumulado = 0;

      const rows = periods.map((periodo) => {
        const [yearStr, monthStr] = periodo.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);

        const cobros = cobrosMap.get(periodo) || 0;
        const cheques = chequesMap.get(periodo) || 0;
        const ingresos = Math.round((cobros + cheques) * 100) / 100;
        const egresos = Math.round((pagosMap.get(periodo) || 0) * 100) / 100;
        const neto = Math.round((ingresos - egresos) * 100) / 100;
        acumulado = Math.round((acumulado + neto) * 100) / 100;

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
