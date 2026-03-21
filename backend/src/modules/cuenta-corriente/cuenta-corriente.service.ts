import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class CuentaCorrienteService {
  async getResumen(companyId: string) {
    try {
      const result = await db.execute(sql`
        SELECT
          e.id, e.name, e.cuit, e.status,
          COALESCE((
            SELECT SUM(CAST(i.total_amount AS decimal))
            FROM invoices i
            LEFT JOIN enterprises ie ON i.enterprise_id = ie.id
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status = 'authorized'
              AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)
          ), 0) as total_ventas,
          COALESCE((
            SELECT SUM(CAST(co.amount AS decimal))
            FROM cobros co
            WHERE co.company_id = ${companyId} AND co.enterprise_id = e.id
          ), 0) as total_cobros,
          COALESCE((
            SELECT SUM(CAST(p.total_amount AS decimal))
            FROM purchases p
            WHERE p.company_id = ${companyId} AND p.enterprise_id = e.id
              AND p.status != 'cancelada'
          ), 0) as total_compras,
          COALESCE((
            SELECT SUM(CAST(pa.amount AS decimal))
            FROM pagos pa
            WHERE pa.company_id = ${companyId} AND pa.enterprise_id = e.id
          ), 0) as total_pagos,
          COALESCE((
            SELECT SUM(CAST(aa.amount AS decimal))
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'debit'
          ), 0) as total_ajustes_debit,
          COALESCE((
            SELECT SUM(ABS(CAST(aa.amount AS decimal)))
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'credit'
          ), 0) as total_ajustes_credit
        FROM enterprises e
        WHERE e.company_id = ${companyId}
        ORDER BY e.name ASC
      `);
      const rows = (result as any).rows || result || [];

      return rows.map((r: any) => {
        const ventas = parseFloat(r.total_ventas || '0');
        const cobros = parseFloat(r.total_cobros || '0');
        const compras = parseFloat(r.total_compras || '0');
        const pagos = parseFloat(r.total_pagos || '0');
        const ajustesDebit = parseFloat(r.total_ajustes_debit || '0');
        const ajustesCredit = parseFloat(r.total_ajustes_credit || '0');
        // Debit adjustments increase "nos deben", credit adjustments decrease it (like cobros)
        const aCobrar = ventas + ajustesDebit - cobros - ajustesCredit;
        const aPagar = compras - pagos;
        const balance = aCobrar - aPagar;
        return {
          ...r,
          total_ventas: ventas,
          total_cobros: cobros,
          total_compras: compras,
          total_pagos: pagos,
          a_cobrar: aCobrar,
          a_pagar: aPagar,
          saldo: balance,
        };
      });
    } catch (error) {
      console.error('Get cuenta corriente resumen error:', error);
      throw new ApiError(500, 'Failed to get cuenta corriente resumen');
    }
  }

  async getDetalle(companyId: string, enterpriseId: string) {
    try {
      const entCheck = await db.execute(sql`
        SELECT id, name, cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');
      const enterprise = entRows[0];

      // Facturado AFIP (facturas autorizadas) -- nos deben
      let ordersResult: any = { rows: [] };
      try {
        ordersResult = await db.execute(sql`
          SELECT i.id, 'factura' as tipo, COALESCE(i.invoice_date, i.created_at) as fecha,
            'Factura ' || COALESCE(i.invoice_type, 'NF') || ' ' ||
              LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0') as descripcion,
            CAST(COALESCE(i.total_amount, 0) AS decimal) as monto
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId}
            AND (i.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
            AND i.status = 'authorized'
            AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)
        `);
      } catch (e) {
        console.error('Cuenta corriente: invoices query failed, falling back to empty', (e as any)?.message);
      }

      // Cobros -- nos pagaron
      let cobrosResult: any = { rows: [] };
      try {
        cobrosResult = await db.execute(sql`
          SELECT co.id, 'cobro' as tipo, co.payment_date as fecha,
            'Cobro — ' || co.payment_method || COALESCE(' — ' || co.reference, '') as descripcion,
            CAST(co.amount AS decimal) as monto
          FROM cobros co
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('Cuenta corriente: cobros query failed', (e as any)?.message); }

      // Ajustes manuales
      let adjustmentsResult: any = { rows: [] };
      try {
        adjustmentsResult = await db.execute(sql`
          SELECT aa.id, 'ajuste' as tipo, aa.created_at as fecha,
            'Ajuste — ' || aa.reason as descripcion,
            CAST(ABS(aa.amount) AS decimal) as monto,
            aa.adjustment_type
          FROM account_adjustments aa
          WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('Cuenta corriente: adjustments query failed', (e as any)?.message); }

      // Compras -- les debemos
      let purchasesResult: any = { rows: [] };
      try {
        purchasesResult = await db.execute(sql`
          SELECT p.id, 'compra' as tipo, p.date as fecha,
            'Compra #' || LPAD(CAST(p.purchase_number AS TEXT), 4, '0') as descripcion,
            CAST(p.total_amount AS decimal) as monto
          FROM purchases p
          WHERE p.company_id = ${companyId} AND p.enterprise_id = ${enterpriseId}
            AND p.status != 'cancelada'
        `);
      } catch (e) { console.error('Cuenta corriente: purchases query failed', (e as any)?.message); }

      // Pagos -- les pagamos
      let pagosResult: any = { rows: [] };
      try {
        pagosResult = await db.execute(sql`
          SELECT pa.id, 'pago' as tipo, pa.payment_date as fecha,
            'Pago — ' || pa.payment_method || COALESCE(' — ' || pa.reference, '') as descripcion,
            CAST(pa.amount AS decimal) as monto
          FROM pagos pa
          WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('Cuenta corriente: pagos query failed', (e as any)?.message); }

      const orders = ((ordersResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const cobros = ((cobrosResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const adjustments = ((adjustmentsResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const purchases = ((purchasesResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const pagos = ((pagosResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));

      // Cuentas a Cobrar: Ventas (+), Cobros (-), Ajustes debit (+) / credit (-)
      const movsCobrar = [
        ...orders.map((o: any) => ({ ...o, debe: o.monto, haber: 0 })),
        ...cobros.map((c: any) => ({ ...c, debe: 0, haber: c.monto })),
        ...adjustments.map((a: any) => ({
          ...a,
          debe: a.adjustment_type === 'debit' ? a.monto : 0,
          haber: a.adjustment_type === 'credit' ? a.monto : 0,
        })),
      ].sort((a: any, b: any) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      let saldoCobrar = 0;
      const movsCobrarConSaldo = movsCobrar.map((m: any) => {
        saldoCobrar += m.debe - m.haber;
        return { ...m, saldo: saldoCobrar };
      });

      // Cuentas a Pagar: Compras (+) y Pagos (-)
      const movsPagar = [
        ...purchases.map((p: any) => ({ ...p, debe: p.monto, haber: 0 })),
        ...pagos.map((pa: any) => ({ ...pa, debe: 0, haber: pa.monto })),
      ].sort((a: any, b: any) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      let saldoPagar = 0;
      const movsPagarConSaldo = movsPagar.map((m: any) => {
        saldoPagar += m.debe - m.haber;
        return { ...m, saldo: saldoPagar };
      });

      return {
        enterprise,
        cuentas_a_cobrar: {
          movimientos: movsCobrarConSaldo,
          total_ventas: orders.reduce((s: number, m: any) => s + m.monto, 0),
          total_cobros: cobros.reduce((s: number, m: any) => s + m.monto, 0),
          saldo: saldoCobrar,
        },
        cuentas_a_pagar: {
          movimientos: movsPagarConSaldo,
          total_compras: purchases.reduce((s: number, m: any) => s + m.monto, 0),
          total_pagos: pagos.reduce((s: number, m: any) => s + m.monto, 0),
          saldo: saldoPagar,
        },
        balance_neto: saldoCobrar - saldoPagar,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get cuenta corriente detalle error:', error);
      throw new ApiError(500, 'Failed to get cuenta corriente detalle');
    }
  }

  async getPdfData(companyId: string, enterpriseId: string, dateFrom: string, dateTo: string) {
    try {
      // Validate enterprise belongs to company
      const entCheck = await db.execute(sql`
        SELECT id, name, cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');
      const enterprise = entRows[0];

      // Get company info
      const compCheck = await db.execute(sql`
        SELECT name, cuit FROM companies WHERE id = ${companyId}
      `);
      const compRows = (compCheck as any).rows || compCheck || [];
      if (compRows.length === 0) throw new ApiError(404, 'Company not found');
      const company = compRows[0];

      // ALL transactions (for total balance) - each query wrapped defensively
      let allOrders: any = { rows: [] };
      try {
        allOrders = await db.execute(sql`
          SELECT i.id, 'factura' as tipo, COALESCE(i.invoice_date, i.created_at) as fecha,
            'Factura ' || COALESCE(i.invoice_type, 'NF') || ' ' || LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0') as descripcion,
            CAST(COALESCE(i.total_amount, 0) AS decimal) as monto
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId}
            AND (i.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
            AND i.status = 'authorized'
            AND (i.fiscal_type = 'fiscal' OR i.fiscal_type IS NULL)
        `);
      } catch (e) { console.error('PDF: invoices query failed', (e as any)?.message); }

      let allCobros: any = { rows: [] };
      try {
        allCobros = await db.execute(sql`
          SELECT co.id, 'cobro' as tipo, co.payment_date as fecha,
            'Cobro — ' || co.payment_method || COALESCE(' — ' || co.reference, '') as descripcion,
            CAST(co.amount AS decimal) as monto
          FROM cobros co
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('PDF: cobros query failed', (e as any)?.message); }

      let allAdjustments: any = { rows: [] };
      try {
        allAdjustments = await db.execute(sql`
          SELECT aa.id, 'ajuste' as tipo, aa.created_at as fecha,
            'Ajuste — ' || aa.reason as descripcion,
            CAST(ABS(aa.amount) AS decimal) as monto,
            aa.adjustment_type
          FROM account_adjustments aa
          WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('PDF: adjustments query failed', (e as any)?.message); }

      let allPurchases: any = { rows: [] };
      try {
        allPurchases = await db.execute(sql`
          SELECT p.id, 'compra' as tipo, p.date as fecha,
            'Compra #' || LPAD(CAST(p.purchase_number AS TEXT), 4, '0') as descripcion,
            CAST(p.total_amount AS decimal) as monto
          FROM purchases p
          WHERE p.company_id = ${companyId} AND p.enterprise_id = ${enterpriseId}
            AND p.status != 'cancelada'
        `);
      } catch (e) { console.error('PDF: purchases query failed', (e as any)?.message); }

      let allPagos: any = { rows: [] };
      try {
        allPagos = await db.execute(sql`
          SELECT pa.id, 'pago' as tipo, pa.payment_date as fecha,
            'Pago — ' || pa.payment_method || COALESCE(' — ' || pa.reference, '') as descripcion,
            CAST(pa.amount AS decimal) as monto
          FROM pagos pa
          WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('PDF: pagos query failed', (e as any)?.message); }

      const parseRows = (result: any) =>
        ((result as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));

      const orders = parseRows(allOrders);
      const cobros = parseRows(allCobros);
      const adjustments = parseRows(allAdjustments);
      const purchases = parseRows(allPurchases);
      const pagos = parseRows(allPagos);

      // Build ALL movimientos sorted by date (for running saldo)
      const allMovimientos = [
        ...orders.map((o: any) => ({ ...o, debe: o.monto, haber: 0 })),
        ...cobros.map((c: any) => ({ ...c, debe: 0, haber: c.monto })),
        ...adjustments.map((a: any) => ({
          ...a,
          debe: a.adjustment_type === 'debit' ? a.monto : 0,
          haber: a.adjustment_type === 'credit' ? a.monto : 0,
        })),
        ...purchases.map((p: any) => ({ ...p, debe: p.monto, haber: 0, isPagar: true })),
        ...pagos.map((pa: any) => ({ ...pa, debe: 0, haber: pa.monto, isPagar: true })),
      ].sort((a: any, b: any) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      // Calculate running saldo and total balance
      // Saldo = (ventas + debit_adjustments - cobros - credit_adjustments) - (compras - pagos)
      // Positive = nos deben, Negative = les debemos
      let runningBalance = 0;
      const allWithSaldo = allMovimientos.map((m: any) => {
        if (m.isPagar) {
          // Compras increase debt (negative), pagos decrease it
          runningBalance -= (m.debe - m.haber);
        } else {
          // Ventas/adjustments increase receivable (positive), cobros decrease it
          runningBalance += (m.debe - m.haber);
        }
        return { ...m, saldo: runningBalance };
      });

      const totalBalance = runningBalance;

      // Filter movimientos by date range for the table
      const fromDate = new Date(dateFrom + 'T00:00:00');
      const toDate = new Date(dateTo + 'T23:59:59');

      const filteredMovimientos = allWithSaldo.filter((m: any) => {
        const fecha = new Date(m.fecha);
        return fecha >= fromDate && fecha <= toDate;
      });

      // Limit to 500 most recent if too many
      const limitedMovimientos = filteredMovimientos.length > 500
        ? filteredMovimientos.slice(filteredMovimientos.length - 500)
        : filteredMovimientos;

      return {
        company,
        enterprise,
        dateFrom,
        dateTo,
        movimientos: limitedMovimientos,
        totalBalance,
        totalMovimientos: filteredMovimientos.length,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Get cuenta corriente PDF data error:', error);
      throw new ApiError(500, 'Failed to get cuenta corriente PDF data');
    }
  }

  async createAdjustment(companyId: string, enterpriseId: string, data: {
    amount: number;
    reason: string;
    adjustment_type: 'credit' | 'debit';
    created_by?: string;
  }) {
    try {
      // Validate enterprise belongs to company
      const entCheck = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');

      if (!data.amount || data.amount === 0) {
        throw new ApiError(400, 'Amount must be non-zero');
      }
      if (!data.reason || data.reason.trim().length === 0) {
        throw new ApiError(400, 'Reason is required');
      }
      if (!['credit', 'debit'].includes(data.adjustment_type)) {
        throw new ApiError(400, 'adjustment_type must be "credit" or "debit"');
      }

      // Store amount: positive for debit, negative for credit
      const storedAmount = data.adjustment_type === 'credit'
        ? -Math.abs(data.amount)
        : Math.abs(data.amount);

      const result = await db.execute(sql`
        INSERT INTO account_adjustments (company_id, enterprise_id, amount, reason, adjustment_type, created_by)
        VALUES (${companyId}, ${enterpriseId}, ${storedAmount}, ${data.reason.trim()}, ${data.adjustment_type}, ${data.created_by || null})
        RETURNING *
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create adjustment error:', error);
      throw new ApiError(500, 'Failed to create adjustment');
    }
  }

  async getAdjustments(companyId: string, enterpriseId: string) {
    try {
      const result = await db.execute(sql`
        SELECT aa.*, u.name as created_by_name
        FROM account_adjustments aa
        LEFT JOIN users u ON aa.created_by = u.id
        WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
        ORDER BY aa.created_at DESC
      `);
      const rows = (result as any).rows || result || [];
      return rows.map((r: any) => ({
        ...r,
        amount: parseFloat(r.amount || '0'),
      }));
    } catch (error) {
      console.error('Get adjustments error:', error);
      throw new ApiError(500, 'Failed to get adjustments');
    }
  }

  async deleteAdjustment(companyId: string, enterpriseId: string, adjustmentId: string) {
    try {
      const check = await db.execute(sql`
        SELECT id FROM account_adjustments
        WHERE id = ${adjustmentId} AND company_id = ${companyId} AND enterprise_id = ${enterpriseId}
      `);
      const checkRows = (check as any).rows || check || [];
      if (checkRows.length === 0) throw new ApiError(404, 'Adjustment not found');

      await db.execute(sql`
        DELETE FROM account_adjustments
        WHERE id = ${adjustmentId} AND company_id = ${companyId} AND enterprise_id = ${enterpriseId}
      `);
      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete adjustment error:', error);
      throw new ApiError(500, 'Failed to delete adjustment');
    }
  }
}

export const cuentaCorrienteService = new CuentaCorrienteService();
