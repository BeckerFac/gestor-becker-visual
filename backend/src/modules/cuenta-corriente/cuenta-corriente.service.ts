import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

export class CuentaCorrienteService {
  /**
   * Get CC summary per enterprise, optionally filtered by business_unit_id.
   *
   * NEW calculation using cobro_invoice_applications and pago_invoice_applications:
   * - total_ventas = SUM(invoices.total_amount) where status != cancelled
   * - total_cobros_aplicados = SUM(cobro_invoice_applications.amount_applied) via invoices
   * - adelantos_cobros = SUM(cobros.amount) where pending_status = 'pending_invoice'
   * - total_compras = SUM(purchase_invoices.total_amount) where status != cancelled
   * - total_pagos_aplicados = SUM(pago_invoice_applications.amount_applied) via purchase_invoices
   * - adelantos_pagos = SUM(pagos.amount) where pending_status = 'pending_invoice'
   * - ajustes debit/credit from account_adjustments
   */
  async getResumen(companyId: string, businessUnitId?: string) {
    try {
      const buFilter = businessUnitId
        ? sql` AND business_unit_id = ${businessUnitId}`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          e.id, e.name, e.cuit, e.status,

          -- Ventas: facturas no canceladas
          COALESCE((
            SELECT SUM(CAST(i.total_amount AS decimal))
            FROM invoices i
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              AND i.status != 'cancelled'
              ${buFilter}
          ), 0) as total_ventas,

          -- Cobros aplicados (via tabla intermedia)
          COALESCE((
            SELECT SUM(CAST(cia.amount_applied AS decimal))
            FROM cobro_invoice_applications cia
            JOIN invoices i ON cia.invoice_id = i.id
            LEFT JOIN customers ic ON i.customer_id = ic.id
            WHERE i.company_id = ${companyId}
              AND (i.enterprise_id = e.id OR ic.enterprise_id = e.id)
              ${buFilter}
          ), 0) as total_cobros_aplicados,

          -- Adelantos cobros (monto NO asignado de cobros pending)
          COALESCE((
            SELECT SUM(
              CAST(co.amount AS decimal) - COALESCE((
                SELECT SUM(CAST(cia_inner.amount_applied AS decimal))
                FROM cobro_invoice_applications cia_inner
                WHERE cia_inner.cobro_id = co.id
              ), 0)
            )
            FROM cobros co
            WHERE co.company_id = ${companyId}
              AND co.enterprise_id = e.id
              AND co.pending_status = 'pending_invoice'
              ${buFilter}
          ), 0) as total_adelantos_cobros,

          -- Compras: purchase_invoices no canceladas
          COALESCE((
            SELECT SUM(CAST(pi.total_amount AS decimal))
            FROM purchase_invoices pi
            WHERE pi.company_id = ${companyId}
              AND pi.enterprise_id = e.id
              AND pi.status != 'cancelled'
              ${buFilter}
          ), 0) as total_compras,

          -- Pagos aplicados (via tabla intermedia)
          COALESCE((
            SELECT SUM(CAST(pia.amount_applied AS decimal))
            FROM pago_invoice_applications pia
            JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
            WHERE pi.company_id = ${companyId}
              AND pi.enterprise_id = e.id
              ${buFilter}
          ), 0) as total_pagos_aplicados,

          -- Adelantos pagos (monto NO asignado de pagos pending)
          COALESCE((
            SELECT SUM(
              CAST(pa.amount AS decimal) - COALESCE((
                SELECT SUM(CAST(pia_inner.amount_applied AS decimal))
                FROM pago_invoice_applications pia_inner
                WHERE pia_inner.pago_id = pa.id
              ), 0)
            )
            FROM pagos pa
            WHERE pa.company_id = ${companyId}
              AND pa.enterprise_id = e.id
              AND pa.pending_status = 'pending_invoice'
              ${buFilter}
          ), 0) as total_adelantos_pagos,

          -- Ajustes debit
          COALESCE((
            SELECT SUM(CAST(aa.amount AS decimal))
            FROM account_adjustments aa
            WHERE aa.company_id = ${companyId} AND aa.enterprise_id = e.id
              AND aa.adjustment_type = 'debit'
          ), 0) as total_ajustes_debit,

          -- Ajustes credit
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
        const cobrosAplicados = parseFloat(r.total_cobros_aplicados || '0');
        const adelantosCobros = parseFloat(r.total_adelantos_cobros || '0');
        const compras = parseFloat(r.total_compras || '0');
        const pagosAplicados = parseFloat(r.total_pagos_aplicados || '0');
        const adelantosPagos = parseFloat(r.total_adelantos_pagos || '0');
        const ajustesDebit = parseFloat(r.total_ajustes_debit || '0');
        const ajustesCredit = parseFloat(r.total_ajustes_credit || '0');

        // LOGIC: Balance reflects CASH REALITY (all money in/out)
        // "Sin asociar" is informational only — the money already moved
        //
        const totalCobros = cobrosAplicados + adelantosCobros;
        const totalPagos = pagosAplicados + adelantosPagos;

        // Facturas pendientes (paper debt — only applied cobros reduce this)
        const pendienteCobro = Math.max(ventas + ajustesDebit - cobrosAplicados - ajustesCredit, 0);
        const pendientePago = Math.max(compras - pagosAplicados, 0);

        // Cobros/pagos sin factura asociada (info: "ir a vincular en Cobros/Pagos")
        const cobrosNoAsociados = adelantosCobros;
        const pagosNoAsociados = adelantosPagos;

        // Balance REAL = todo el dinero que entró - todo el dinero que salió
        // Incluye cobros y pagos sin asociar porque la plata ya se movió
        const balanceReal = (ventas + ajustesDebit - totalCobros - ajustesCredit) - (compras - totalPagos);

        // Legacy compat
        const aCobrar = pendienteCobro;
        const aPagar = pendientePago;

        // Relationship type
        const hasVentas = ventas > 0 || cobrosAplicados > 0 || adelantosCobros > 0;
        const hasCompras = compras > 0 || pagosAplicados > 0 || adelantosPagos > 0;
        const tipo = hasVentas && hasCompras ? 'mixto' : hasCompras ? 'proveedor' : 'cliente';

        return {
          ...r,
          total_ventas: ventas,
          total_cobros: totalCobros,
          total_cobros_aplicados: cobrosAplicados,
          cobros_no_asociados: cobrosNoAsociados,
          adelantos_cobros: cobrosNoAsociados,
          total_compras: compras,
          total_pagos: totalPagos,
          total_pagos_aplicados: pagosAplicados,
          pagos_no_asociados: pagosNoAsociados,
          adelantos_pagos: pagosNoAsociados,
          a_cobrar: aCobrar,
          a_pagar: aPagar,
          saldo: balanceReal,
          // Semantic fields
          deuda_cliente: pendienteCobro,
          credito_cliente: 0,
          deuda_proveedor: pendientePago,
          credito_proveedor: 0,
          adelantos_recibidos: cobrosNoAsociados,
          adelantos_entregados: pagosNoAsociados,
          saldo_neto: balanceReal,
          tipo,
        };
      });
    } catch (error) {
      console.error('Get cuenta corriente resumen error:', error);
      throw new ApiError(500, 'Failed to get cuenta corriente resumen');
    }
  }

  async getDetalle(companyId: string, enterpriseId: string, businessUnitId?: string) {
    try {
      const entCheck = await db.execute(sql`
        SELECT id, name, cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');
      const enterprise = entRows[0];

      const buFilter = businessUnitId ? sql` AND business_unit_id = ${businessUnitId}` : sql``;

      // Facturas de venta (nos deben)
      let invoicesResult: any = { rows: [] };
      try {
        invoicesResult = await db.execute(sql`
          SELECT i.id, 'factura' as tipo, COALESCE(i.invoice_date, i.created_at) as fecha,
            'Factura ' || COALESCE(i.invoice_type, 'NF') || ' ' ||
              LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0') as descripcion,
            CAST(COALESCE(i.total_amount, 0) AS decimal) as monto,
            i.payment_status
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId}
            AND (i.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
            AND i.status != 'cancelled'
            ${buFilter}
        `);
      } catch (e) { console.error('CC detalle: invoices query failed', (e as any)?.message); }

      // Cobros aplicados (nos pagaron - con detalle de factura)
      let cobrosResult: any = { rows: [] };
      try {
        cobrosResult = await db.execute(sql`
          SELECT cia.id, 'cobro' as tipo, COALESCE(co.payment_date, co.created_at) as fecha,
            'Cobro' || COALESCE(' — ' || co.payment_method, '') || COALESCE(' — ' || co.reference, '')
            || ' → Fact ' || COALESCE(i.invoice_type, 'NF') || ' ' || LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0') as descripcion,
            CAST(COALESCE(cia.amount_applied, 0) AS decimal) as monto
          FROM cobro_invoice_applications cia
          JOIN cobros co ON cia.cobro_id = co.id
          JOIN invoices i ON cia.invoice_id = i.id
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
            ${buFilter}
        `);
      } catch (e) { console.error('CC detalle: cobros query failed', (e as any)?.message); }

      // Adelantos cobros (cobros sin factura)
      let adelantosResult: any = { rows: [] };
      try {
        adelantosResult = await db.execute(sql`
          SELECT co.id, 'adelanto' as tipo, COALESCE(co.payment_date, co.created_at) as fecha,
            'Adelanto' || COALESCE(' — ' || co.payment_method, '') || COALESCE(' — ' || co.reference, '') as descripcion,
            CAST(COALESCE(co.amount, 0) AS decimal) - COALESCE((
              SELECT SUM(CAST(cia_d.amount_applied AS decimal)) FROM cobro_invoice_applications cia_d WHERE cia_d.cobro_id = co.id
            ), 0) as monto
          FROM cobros co
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
            AND co.pending_status = 'pending_invoice'
            ${buFilter}
        `);
      } catch (e) { console.error('CC detalle: adelantos query failed', (e as any)?.message); }

      // Ajustes manuales
      let adjustmentsResult: any = { rows: [] };
      try {
        adjustmentsResult = await db.execute(sql`
          SELECT aa.id, 'ajuste' as tipo, aa.created_at as fecha,
            'Ajuste' || COALESCE(' — ' || aa.reason, '') as descripcion,
            CAST(ABS(COALESCE(aa.amount, 0)) AS decimal) as monto,
            aa.adjustment_type
          FROM account_adjustments aa
          WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('CC detalle: adjustments query failed', (e as any)?.message); }

      // Facturas de compra (les debemos)
      let purchaseInvoicesResult: any = { rows: [] };
      try {
        purchaseInvoicesResult = await db.execute(sql`
          SELECT pi.id, 'factura_compra' as tipo, COALESCE(pi.invoice_date, pi.created_at) as fecha,
            'Fact. Compra ' || pi.invoice_type || ' ' || pi.invoice_number as descripcion,
            CAST(COALESCE(pi.total_amount, 0) AS decimal) as monto,
            pi.payment_status
          FROM purchase_invoices pi
          WHERE pi.company_id = ${companyId} AND pi.enterprise_id = ${enterpriseId}
            AND pi.status != 'cancelled'
            ${buFilter}
        `);
      } catch (e) { console.error('CC detalle: purchase_invoices query failed', (e as any)?.message); }

      // Pagos aplicados (les pagamos)
      let pagosResult: any = { rows: [] };
      try {
        pagosResult = await db.execute(sql`
          SELECT pia.id, 'pago' as tipo, COALESCE(pa.payment_date, pa.created_at) as fecha,
            'Pago' || COALESCE(' — ' || pa.payment_method, '') || COALESCE(' — ' || pa.reference, '')
            || ' → Fact. Compra ' || pi.invoice_type || ' ' || pi.invoice_number as descripcion,
            CAST(COALESCE(pia.amount_applied, 0) AS decimal) as monto
          FROM pago_invoice_applications pia
          JOIN pagos pa ON pia.pago_id = pa.id
          JOIN purchase_invoices pi ON pia.purchase_invoice_id = pi.id
          WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
            ${buFilter}
        `);
      } catch (e) { console.error('CC detalle: pagos query failed', (e as any)?.message); }

      // Adelantos pagos
      let adelantosPagosResult: any = { rows: [] };
      try {
        adelantosPagosResult = await db.execute(sql`
          SELECT pa.id, 'adelanto_pago' as tipo, COALESCE(pa.payment_date, pa.created_at) as fecha,
            'Adelanto pago' || COALESCE(' — ' || pa.payment_method, '') || COALESCE(' — ' || pa.reference, '') as descripcion,
            CAST(COALESCE(pa.amount, 0) AS decimal) - COALESCE((
              SELECT SUM(CAST(pia_d.amount_applied AS decimal)) FROM pago_invoice_applications pia_d WHERE pia_d.pago_id = pa.id
            ), 0) as monto
          FROM pagos pa
          WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
            AND pa.pending_status = 'pending_invoice'
            ${buFilter}
        `);
      } catch (e) { console.error('CC detalle: adelantos pagos query failed', (e as any)?.message); }

      const parseRows = (result: any) =>
        ((result as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));

      const facturas = parseRows(invoicesResult);
      const cobros = parseRows(cobrosResult);
      const adelantos = parseRows(adelantosResult);
      const adjustments = parseRows(adjustmentsResult);
      const purchaseInvoices = parseRows(purchaseInvoicesResult);
      const pagos = parseRows(pagosResult);
      const adelantosPagos = parseRows(adelantosPagosResult);

      // Cuentas a Cobrar
      const movsCobrar = [
        ...facturas.map((o: any) => ({ ...o, debe: o.monto, haber: 0 })),
        ...cobros.map((c: any) => ({ ...c, debe: 0, haber: c.monto })),
        ...adelantos.map((a: any) => ({ ...a, debe: 0, haber: a.monto })),
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

      // Cuentas a Pagar
      const movsPagar = [
        ...purchaseInvoices.map((p: any) => ({ ...p, debe: p.monto, haber: 0 })),
        ...pagos.map((pa: any) => ({ ...pa, debe: 0, haber: pa.monto })),
        ...adelantosPagos.map((a: any) => ({ ...a, debe: 0, haber: a.monto })),
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
          total_ventas: facturas.reduce((s: number, m: any) => s + m.monto, 0),
          total_cobros: cobros.reduce((s: number, m: any) => s + m.monto, 0),
          total_adelantos: adelantos.reduce((s: number, m: any) => s + m.monto, 0),
          saldo: saldoCobrar,
        },
        cuentas_a_pagar: {
          movimientos: movsPagarConSaldo,
          total_compras: purchaseInvoices.reduce((s: number, m: any) => s + m.monto, 0),
          total_pagos: pagos.reduce((s: number, m: any) => s + m.monto, 0),
          total_adelantos: adelantosPagos.reduce((s: number, m: any) => s + m.monto, 0),
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
      const entCheck = await db.execute(sql`
        SELECT id, name, cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');
      const enterprise = entRows[0];

      const compCheck = await db.execute(sql`
        SELECT name, cuit FROM companies WHERE id = ${companyId}
      `);
      const company = ((compCheck as any).rows || [])[0];
      if (!company) throw new ApiError(404, 'Company not found');

      // Facturas de venta
      let allInvoices: any = { rows: [] };
      try {
        allInvoices = await db.execute(sql`
          SELECT i.id, 'factura' as tipo, COALESCE(i.invoice_date, i.created_at) as fecha,
            'Factura ' || COALESCE(i.invoice_type, 'NF') || ' ' || LPAD(CAST(COALESCE(i.invoice_number, 0) AS TEXT), 8, '0') as descripcion,
            CAST(COALESCE(i.total_amount, 0) AS decimal) as monto
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          WHERE i.company_id = ${companyId}
            AND (i.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
            AND i.status != 'cancelled'
        `);
      } catch (e) { console.error('PDF: invoices query failed', (e as any)?.message); }

      // Cobros aplicados
      let allCobros: any = { rows: [] };
      try {
        allCobros = await db.execute(sql`
          SELECT cia.id, 'cobro' as tipo, COALESCE(co.payment_date, co.created_at) as fecha,
            'Cobro' || COALESCE(' — ' || co.payment_method, '') || COALESCE(' — ' || co.reference, '') as descripcion,
            CAST(COALESCE(cia.amount_applied, 0) AS decimal) as monto
          FROM cobro_invoice_applications cia
          JOIN cobros co ON cia.cobro_id = co.id
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('PDF: cobros query failed', (e as any)?.message); }

      // Adelantos
      let allAdelantos: any = { rows: [] };
      try {
        allAdelantos = await db.execute(sql`
          SELECT co.id, 'adelanto' as tipo, COALESCE(co.payment_date, co.created_at) as fecha,
            'Adelanto' || COALESCE(' — ' || co.payment_method, '') as descripcion,
            CAST(COALESCE(co.amount, 0) AS decimal) - COALESCE((
              SELECT SUM(CAST(cia_p.amount_applied AS decimal)) FROM cobro_invoice_applications cia_p WHERE cia_p.cobro_id = co.id
            ), 0) as monto
          FROM cobros co
          WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
            AND co.pending_status = 'pending_invoice'
        `);
      } catch (e) { console.error('PDF: adelantos query failed', (e as any)?.message); }

      // Ajustes
      let allAdjustments: any = { rows: [] };
      try {
        allAdjustments = await db.execute(sql`
          SELECT aa.id, 'ajuste' as tipo, aa.created_at as fecha,
            'Ajuste' || COALESCE(' — ' || aa.reason, '') as descripcion,
            CAST(ABS(COALESCE(aa.amount, 0)) AS decimal) as monto,
            aa.adjustment_type
          FROM account_adjustments aa
          WHERE aa.company_id = ${companyId} AND aa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('PDF: adjustments query failed', (e as any)?.message); }

      // Facturas de compra
      let allPurchaseInvoices: any = { rows: [] };
      try {
        allPurchaseInvoices = await db.execute(sql`
          SELECT pi.id, 'factura_compra' as tipo, COALESCE(pi.invoice_date, pi.created_at) as fecha,
            'Fact. Compra ' || pi.invoice_type || ' ' || pi.invoice_number as descripcion,
            CAST(COALESCE(pi.total_amount, 0) AS decimal) as monto
          FROM purchase_invoices pi
          WHERE pi.company_id = ${companyId} AND pi.enterprise_id = ${enterpriseId}
            AND pi.status != 'cancelled'
        `);
      } catch (e) { console.error('PDF: purchase_invoices query failed', (e as any)?.message); }

      // Pagos aplicados
      let allPagos: any = { rows: [] };
      try {
        allPagos = await db.execute(sql`
          SELECT pia.id, 'pago' as tipo, COALESCE(pa.payment_date, pa.created_at) as fecha,
            'Pago' || COALESCE(' — ' || pa.payment_method, '') || COALESCE(' — ' || pa.reference, '') as descripcion,
            CAST(COALESCE(pia.amount_applied, 0) AS decimal) as monto
          FROM pago_invoice_applications pia
          JOIN pagos pa ON pia.pago_id = pa.id
          WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
        `);
      } catch (e) { console.error('PDF: pagos query failed', (e as any)?.message); }

      const parseRows = (result: any) =>
        ((result as any).rows || []).map((m: any) => ({
          ...m,
          monto: parseFloat(m.monto || '0'),
          fecha: m.fecha || new Date().toISOString(),
          descripcion: m.descripcion || 'Sin descripcion',
        }));

      const invoices = parseRows(allInvoices);
      const cobros = parseRows(allCobros);
      const adelantos = parseRows(allAdelantos);
      const adjustments = parseRows(allAdjustments);
      const purchaseInvoices = parseRows(allPurchaseInvoices);
      const pagos = parseRows(allPagos);

      // Build ALL movements sorted by date
      const allMovimientos = [
        ...invoices.map((o: any) => ({ ...o, debe: o.monto, haber: 0 })),
        ...cobros.map((c: any) => ({ ...c, debe: 0, haber: c.monto })),
        ...adelantos.map((a: any) => ({ ...a, debe: 0, haber: a.monto })),
        ...adjustments.map((a: any) => ({
          ...a,
          debe: a.adjustment_type === 'debit' ? a.monto : 0,
          haber: a.adjustment_type === 'credit' ? a.monto : 0,
        })),
        ...purchaseInvoices.map((p: any) => ({ ...p, debe: p.monto, haber: 0, isPagar: true })),
        ...pagos.map((pa: any) => ({ ...pa, debe: 0, haber: pa.monto, isPagar: true })),
      ].sort((a: any, b: any) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      let runningBalance = 0;
      const allWithSaldo = allMovimientos.map((m: any) => {
        if (m.isPagar) {
          runningBalance -= (m.debe - m.haber);
        } else {
          runningBalance += (m.debe - m.haber);
        }
        return { ...m, saldo: runningBalance };
      });

      const totalBalance = runningBalance;

      // Filter by date range
      const fromDate = new Date(dateFrom + 'T00:00:00');
      const toDate = new Date(dateTo + 'T23:59:59');

      const filteredMovimientos = allWithSaldo.filter((m: any) => {
        const fecha = new Date(m.fecha);
        return fecha >= fromDate && fecha <= toDate;
      });

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
      const entCheck = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const entRows = (entCheck as any).rows || entCheck || [];
      if (entRows.length === 0) throw new ApiError(404, 'Enterprise not found');

      if (!data.amount || data.amount === 0) throw new ApiError(400, 'Amount must be non-zero');
      if (!data.reason || data.reason.trim().length === 0) throw new ApiError(400, 'Reason is required');
      if (!['credit', 'debit'].includes(data.adjustment_type)) throw new ApiError(400, 'adjustment_type must be "credit" or "debit"');

      const storedAmount = data.adjustment_type === 'credit'
        ? -Math.abs(data.amount)
        : Math.abs(data.amount);

      const result = await db.execute(sql`
        INSERT INTO account_adjustments (company_id, enterprise_id, amount, reason, adjustment_type, created_by)
        VALUES (${companyId}, ${enterpriseId}, ${storedAmount}, ${data.reason.trim()}, ${data.adjustment_type}, ${data.created_by || null})
        RETURNING *
      `);
      const adjustment = ((result as any).rows || [])[0];

      // Accounting entry for CC adjustment
      try {
        const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
        await accountingEntriesService.createEntryForAdjustment({
          id: adjustment.id,
          company_id: companyId,
          enterprise_id: enterpriseId,
          adjustment_type: data.adjustment_type,
          amount: Math.abs(data.amount),
          reason: data.reason,
        });
      } catch (accErr) { console.warn('Accounting entry skipped (adjustment):', (accErr as Error).message); }

      return adjustment;
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
      return ((result as any).rows || []).map((r: any) => ({
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
      if (((check as any).rows || []).length === 0) throw new ApiError(404, 'Adjustment not found');

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
