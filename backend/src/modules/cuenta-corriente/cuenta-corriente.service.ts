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
            SELECT SUM(CAST(o.total_amount AS decimal))
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.company_id = ${companyId}
              AND (o.enterprise_id = e.id OR c.enterprise_id = e.id)
              AND o.status != 'cancelado'
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
          ), 0) as total_pagos
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
        const aCobrar = ventas - cobros;
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

      // Ventas (pedidos) — nos deben
      const ordersResult = await db.execute(sql`
        SELECT o.id, 'venta' as tipo, o.created_at as fecha,
          'Pedido #' || LPAD(CAST(o.order_number AS TEXT), 4, '0') || ' — ' || COALESCE(o.title, '') as descripcion,
          CAST(o.total_amount AS decimal) as monto
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = ${companyId}
          AND (o.enterprise_id = ${enterpriseId} OR c.enterprise_id = ${enterpriseId})
          AND o.status != 'cancelado'
      `);

      // Cobros — nos pagaron
      const cobrosResult = await db.execute(sql`
        SELECT co.id, 'cobro' as tipo, co.payment_date as fecha,
          'Cobro — ' || co.payment_method || COALESCE(' — ' || co.reference, '') as descripcion,
          CAST(co.amount AS decimal) as monto
        FROM cobros co
        WHERE co.company_id = ${companyId} AND co.enterprise_id = ${enterpriseId}
      `);

      // Compras — les debemos
      const purchasesResult = await db.execute(sql`
        SELECT p.id, 'compra' as tipo, p.date as fecha,
          'Compra #' || LPAD(CAST(p.purchase_number AS TEXT), 4, '0') as descripcion,
          CAST(p.total_amount AS decimal) as monto
        FROM purchases p
        WHERE p.company_id = ${companyId} AND p.enterprise_id = ${enterpriseId}
          AND p.status != 'cancelada'
      `);

      // Pagos — les pagamos
      const pagosResult = await db.execute(sql`
        SELECT pa.id, 'pago' as tipo, pa.payment_date as fecha,
          'Pago — ' || pa.payment_method || COALESCE(' — ' || pa.reference, '') as descripcion,
          CAST(pa.amount AS decimal) as monto
        FROM pagos pa
        WHERE pa.company_id = ${companyId} AND pa.enterprise_id = ${enterpriseId}
      `);

      const orders = ((ordersResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const cobros = ((cobrosResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const purchases = ((purchasesResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));
      const pagos = ((pagosResult as any).rows || []).map((m: any) => ({ ...m, monto: parseFloat(m.monto || '0') }));

      // Cuentas a Cobrar: Ventas (+) y Cobros (-)
      const movsCobrar = [
        ...orders.map((o: any) => ({ ...o, debe: o.monto, haber: 0 })),
        ...cobros.map((c: any) => ({ ...c, debe: 0, haber: c.monto })),
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
}

export const cuentaCorrienteService = new CuentaCorrienteService();
