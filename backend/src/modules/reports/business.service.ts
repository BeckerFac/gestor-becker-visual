import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Safely round a number to 2 decimal places.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

/**
 * Compute the previous period of equal length ending the day before dateFrom.
 */
function getPreviousPeriod(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = new Date(dateFrom + 'T00:00:00');
  const to = new Date(dateTo + 'T00:00:00');
  const diffMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 86400000); // day before dateFrom
  const prevFrom = new Date(prevTo.getTime() - diffMs);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { dateFrom: fmt(prevFrom), dateTo: fmt(prevTo) };
}

/**
 * Calculate delta percentage safely (handles zero division).
 */
function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

function extractRows(result: any): any[] {
  return (result as any).rows || result || [];
}

export class BusinessService {
  /**
   * Check if a table exists in the current database.
   * Used to make reports defensive when migrations may not have run.
   */
  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${tableName}
        ) as exists
      `);
      const row = extractRows(result)[0];
      return row?.exists === true || row?.exists === 't' || row?.exists === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Ventas Report: revenue, orders count, AOV, sales by month, top products, sales by day of week
   */
  async getVentasReport(companyId: string, dateFrom?: string, dateTo?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);
      const prev = getPreviousPeriod(dates.dateFrom, dates.dateTo);

      // Current period totals
      const currentResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_facturado,
          COUNT(*) as cantidad_pedidos,
          COALESCE(AVG(CAST(total_amount AS decimal)), 0) as ticket_promedio
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
      `);
      const curr = extractRows(currentResult)[0] || {};

      // Previous period totals
      const prevResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_facturado,
          COUNT(*) as cantidad_pedidos,
          COALESCE(AVG(CAST(total_amount AS decimal)), 0) as ticket_promedio
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${prev.dateFrom}::date
          AND created_at::date <= ${prev.dateTo}::date
      `);
      const prevData = extractRows(prevResult)[0] || {};

      const totalFacturado = parseFloat(curr.total_facturado) || 0;
      const cantidadPedidos = parseInt(curr.cantidad_pedidos) || 0;
      const ticketPromedio = parseFloat(curr.ticket_promedio) || 0;
      const prevTotalFacturado = parseFloat(prevData.total_facturado) || 0;
      const prevCantidadPedidos = parseInt(prevData.cantidad_pedidos) || 0;
      const prevTicketPromedio = parseFloat(prevData.ticket_promedio) || 0;

      // Sales by month (bar chart data)
      const monthlyResult = await db.execute(sql`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total,
          COUNT(*) as cantidad
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY periodo ASC
      `);

      // Previous period monthly for comparison
      const prevMonthlyResult = await db.execute(sql`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM') as periodo,
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${prev.dateFrom}::date
          AND created_at::date <= ${prev.dateTo}::date
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY periodo ASC
      `);

      const ventasPorMes = extractRows(monthlyResult).map((r: any) => ({
        periodo: r.periodo,
        total: parseFloat(r.total) || 0,
        cantidad: parseInt(r.cantidad) || 0,
      }));

      const ventasPrevMes = extractRows(prevMonthlyResult).map((r: any) => ({
        periodo: r.periodo,
        total: parseFloat(r.total) || 0,
      }));

      // Top 5 products by revenue
      const topProductsResult = await db.execute(sql`
        SELECT
          COALESCE(oi.product_name, 'Sin nombre') as nombre,
          SUM(CAST(oi.quantity AS decimal)) as unidades,
          SUM(CAST(oi.subtotal AS decimal)) as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.company_id = ${companyId}
          AND o.status NOT IN ('cancelado', 'cancelled')
          AND o.created_at::date >= ${dates.dateFrom}::date
          AND o.created_at::date <= ${dates.dateTo}::date
        GROUP BY oi.product_name
        ORDER BY revenue DESC
        LIMIT 5
      `);

      const topProductos = extractRows(topProductsResult).map((r: any) => ({
        nombre: r.nombre,
        unidades: parseFloat(r.unidades) || 0,
        revenue: parseFloat(r.revenue) || 0,
      }));

      // Sales by day of week
      const dayOfWeekResult = await db.execute(sql`
        SELECT
          EXTRACT(DOW FROM created_at) as dow,
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total,
          COUNT(*) as cantidad
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
        GROUP BY EXTRACT(DOW FROM created_at)
        ORDER BY dow ASC
      `);

      const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
      const ventasPorDia = extractRows(dayOfWeekResult).map((r: any) => ({
        dia: diasSemana[parseInt(r.dow)] || 'Desconocido',
        total: parseFloat(r.total) || 0,
        cantidad: parseInt(r.cantidad) || 0,
      }));

      return {
        summary: {
          total_facturado: round2(totalFacturado),
          total_facturado_delta: deltaPercent(totalFacturado, prevTotalFacturado),
          cantidad_pedidos: cantidadPedidos,
          cantidad_pedidos_delta: deltaPercent(cantidadPedidos, prevCantidadPedidos),
          ticket_promedio: round2(ticketPromedio),
          ticket_promedio_delta: deltaPercent(ticketPromedio, prevTicketPromedio),
        },
        ventas_por_mes: ventasPorMes,
        ventas_prev_mes: ventasPrevMes,
        top_productos: topProductos,
        ventas_por_dia: ventasPorDia,
      };
    } catch (error) {
      console.error('Ventas report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate ventas report');
    }
  }

  /**
   * Rentabilidad Report: margin per product, top by margin, negative margin alert, weighted avg margin
   */
  async getRentabilidadReport(companyId: string, dateFrom?: string, dateTo?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);
      const prev = getPreviousPeriod(dates.dateFrom, dates.dateTo);

      // Margin by product: join order_items with product_pricing to get cost
      const marginResult = await db.execute(sql`
        SELECT
          COALESCE(oi.product_name, 'Sin nombre') as nombre,
          oi.product_id,
          SUM(CAST(oi.quantity AS decimal)) as unidades,
          SUM(CAST(oi.subtotal AS decimal)) as revenue,
          SUM(CAST(oi.quantity AS decimal) * COALESCE(CAST(oi.cost AS decimal), 0)) as costo_total,
          CASE
            WHEN SUM(CAST(oi.subtotal AS decimal)) > 0
            THEN ROUND(100 * (1 - SUM(CAST(oi.quantity AS decimal) * COALESCE(CAST(oi.cost AS decimal), 0)) / NULLIF(SUM(CAST(oi.subtotal AS decimal)), 1)), 1)
            ELSE 0
          END as margen_pct,
          BOOL_OR(COALESCE(CAST(oi.cost AS decimal), 0) = 0) as sin_costo
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.company_id = ${companyId}
          AND o.status NOT IN ('cancelado', 'cancelled')
          AND o.created_at::date >= ${dates.dateFrom}::date
          AND o.created_at::date <= ${dates.dateTo}::date
        GROUP BY oi.product_name, oi.product_id
        ORDER BY (SUM(CAST(oi.subtotal AS decimal)) - SUM(CAST(oi.quantity AS decimal) * COALESCE(CAST(oi.cost AS decimal), 0))) DESC
        LIMIT 50
      `);

      const productos = extractRows(marginResult).map((r: any) => {
        const revenue = parseFloat(r.revenue) || 0;
        const costoTotal = parseFloat(r.costo_total) || 0;
        const margen = round2(revenue - costoTotal);
        const margenPct = revenue > 0 ? round2((1 - costoTotal / revenue) * 100) : 0;
        return {
          nombre: r.nombre,
          product_id: r.product_id,
          unidades: parseFloat(r.unidades) || 0,
          revenue: round2(revenue),
          costo_total: round2(costoTotal),
          margen,
          margen_pct: margenPct,
          sin_costo: r.sin_costo === true || r.sin_costo === 't',
        };
      });

      // Summary calculations
      const totalRevenue = productos.reduce((s, p) => s + p.revenue, 0);
      const totalCosto = productos.reduce((s, p) => s + p.costo_total, 0);
      const margenTotal = round2(totalRevenue - totalCosto);
      const margenPromedioPct = totalRevenue > 0 ? round2((1 - totalCosto / totalRevenue) * 100) : 0;
      const productosMargenBajo = productos.filter(p => p.margen_pct < 15 && !p.sin_costo).length;
      const productosMargenNegativo = productos.filter(p => p.margen < 0 && !p.sin_costo).length;

      // Previous period for delta
      const prevMarginResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(CAST(oi.subtotal AS decimal)), 0) as revenue,
          COALESCE(SUM(CAST(oi.quantity AS decimal) * COALESCE(CAST(oi.cost AS decimal), 0)), 0) as costo
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.company_id = ${companyId}
          AND o.status NOT IN ('cancelado', 'cancelled')
          AND o.created_at::date >= ${prev.dateFrom}::date
          AND o.created_at::date <= ${prev.dateTo}::date
      `);
      const prevMargin = extractRows(prevMarginResult)[0] || {};
      const prevRevenue = parseFloat(prevMargin.revenue) || 0;
      const prevCosto = parseFloat(prevMargin.costo) || 0;
      const prevMargenTotal = round2(prevRevenue - prevCosto);
      const prevMargenPct = prevRevenue > 0 ? round2((1 - prevCosto / prevRevenue) * 100) : 0;

      // Top by absolute margin
      const topPorMargen = [...productos]
        .filter(p => !p.sin_costo)
        .sort((a, b) => b.margen - a.margen)
        .slice(0, 10);

      return {
        summary: {
          margen_total: margenTotal,
          margen_total_delta: deltaPercent(margenTotal, prevMargenTotal),
          margen_promedio_pct: margenPromedioPct,
          margen_promedio_pct_delta: deltaPercent(margenPromedioPct, prevMargenPct),
          productos_margen_bajo: productosMargenBajo,
          productos_margen_negativo: productosMargenNegativo,
        },
        top_por_margen: topPorMargen,
        productos,
      };
    } catch (error) {
      console.error('Rentabilidad report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate rentabilidad report');
    }
  }

  /**
   * Clientes Report: top clients, new vs returning, DSO per client, inactive clients
   */
  async getClientesReport(companyId: string, dateFrom?: string, dateTo?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);
      const prev = getPreviousPeriod(dates.dateFrom, dates.dateTo);

      // Top 10 clients by revenue in period
      const topClientsResult = await db.execute(sql`
        SELECT
          COALESCE(e.name, c.name, 'Sin cliente') as nombre,
          o.enterprise_id,
          o.customer_id,
          COUNT(*) as cantidad_compras,
          SUM(CAST(o.total_amount AS decimal)) as revenue,
          AVG(CAST(o.total_amount AS decimal)) as ticket_promedio,
          MAX(o.created_at) as ultima_compra
        FROM orders o
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = ${companyId}
          AND o.status NOT IN ('cancelado', 'cancelled')
          AND o.created_at::date >= ${dates.dateFrom}::date
          AND o.created_at::date <= ${dates.dateTo}::date
          AND (o.enterprise_id IS NOT NULL OR o.customer_id IS NOT NULL)
        GROUP BY COALESCE(e.name, c.name, 'Sin cliente'), o.enterprise_id, o.customer_id
        ORDER BY revenue DESC
        LIMIT 10
      `);

      const topClientes = extractRows(topClientsResult).map((r: any) => ({
        nombre: r.nombre,
        enterprise_id: r.enterprise_id,
        customer_id: r.customer_id,
        cantidad_compras: parseInt(r.cantidad_compras) || 0,
        revenue: round2(parseFloat(r.revenue) || 0),
        ticket_promedio: round2(parseFloat(r.ticket_promedio) || 0),
        ultima_compra: r.ultima_compra,
      }));

      // Total revenue in period for concentration calculation
      const totalRevenueResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
      `);
      const totalRevenue = parseFloat(extractRows(totalRevenueResult)[0]?.total) || 0;
      const top5Revenue = topClientes.slice(0, 5).reduce((s, c) => s + c.revenue, 0);
      const concentracionTop5 = totalRevenue > 0 ? round2((top5Revenue / totalRevenue) * 100) : 0;

      // Active clients (with orders in period)
      const activeResult = await db.execute(sql`
        SELECT COUNT(DISTINCT COALESCE(enterprise_id::text, customer_id::text)) as activos
        FROM orders
        WHERE company_id = ${companyId}
          AND status NOT IN ('cancelado', 'cancelled')
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
          AND (enterprise_id IS NOT NULL OR customer_id IS NOT NULL)
      `);
      const clientesActivos = parseInt(extractRows(activeResult)[0]?.activos) || 0;

      // New clients: first order in this period
      const newClientsResult = await db.execute(sql`
        WITH first_orders AS (
          SELECT
            COALESCE(enterprise_id::text, customer_id::text) as client_key,
            MIN(created_at) as primera_compra
          FROM orders
          WHERE company_id = ${companyId}
            AND status NOT IN ('cancelado', 'cancelled')
            AND (enterprise_id IS NOT NULL OR customer_id IS NOT NULL)
          GROUP BY COALESCE(enterprise_id::text, customer_id::text)
        )
        SELECT COUNT(*) as nuevos
        FROM first_orders
        WHERE primera_compra::date >= ${dates.dateFrom}::date
          AND primera_compra::date <= ${dates.dateTo}::date
      `);
      const clientesNuevos = parseInt(extractRows(newClientsResult)[0]?.nuevos) || 0;

      // Previous period new clients
      const prevNewClientsResult = await db.execute(sql`
        WITH first_orders AS (
          SELECT
            COALESCE(enterprise_id::text, customer_id::text) as client_key,
            MIN(created_at) as primera_compra
          FROM orders
          WHERE company_id = ${companyId}
            AND status NOT IN ('cancelado', 'cancelled')
            AND (enterprise_id IS NOT NULL OR customer_id IS NOT NULL)
          GROUP BY COALESCE(enterprise_id::text, customer_id::text)
        )
        SELECT COUNT(*) as nuevos
        FROM first_orders
        WHERE primera_compra::date >= ${prev.dateFrom}::date
          AND primera_compra::date <= ${prev.dateTo}::date
      `);
      const prevClientesNuevos = parseInt(extractRows(prevNewClientsResult)[0]?.nuevos) || 0;

      const clientesRecurrentes = Math.max(0, clientesActivos - clientesNuevos);

      // Inactive clients (had orders before period but not in period, last order 30+ days ago)
      const inactiveResult = await db.execute(sql`
        SELECT
          COALESCE(e.name, c.name, 'Sin nombre') as nombre,
          sub.client_key,
          sub.ultima_compra,
          sub.total_historico
        FROM (
          SELECT
            COALESCE(o.enterprise_id::text, o.customer_id::text) as client_key,
            o.enterprise_id,
            o.customer_id,
            MAX(o.created_at) as ultima_compra,
            SUM(CAST(o.total_amount AS decimal)) as total_historico
          FROM orders o
          WHERE o.company_id = ${companyId}
            AND o.status NOT IN ('cancelado', 'cancelled')
            AND (o.enterprise_id IS NOT NULL OR o.customer_id IS NOT NULL)
          GROUP BY COALESCE(o.enterprise_id::text, o.customer_id::text), o.enterprise_id, o.customer_id
          HAVING MAX(o.created_at)::date < (CURRENT_DATE - INTERVAL '30 days')
        ) sub
        LEFT JOIN enterprises e ON sub.enterprise_id = e.id
        LEFT JOIN customers c ON sub.customer_id = c.id
        ORDER BY sub.total_historico DESC
        LIMIT 10
      `);

      const clientesInactivos = extractRows(inactiveResult).map((r: any) => ({
        nombre: r.nombre,
        ultima_compra: r.ultima_compra,
        total_historico: round2(parseFloat(r.total_historico) || 0),
      }));

      return {
        summary: {
          clientes_activos: clientesActivos,
          clientes_nuevos: clientesNuevos,
          clientes_nuevos_delta: deltaPercent(clientesNuevos, prevClientesNuevos),
          clientes_recurrentes: clientesRecurrentes,
          concentracion_top5: concentracionTop5,
        },
        top_clientes: topClientes,
        clientes_inactivos: clientesInactivos,
      };
    } catch (error) {
      console.error('Clientes report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate clientes report');
    }
  }

  /**
   * Cobranzas Report: aging, DSO, total pending, top delinquent clients.
   *
   * Defensive: if the `cobros` table does not exist yet (migration may not
   * have run), the subqueries that reference it are wrapped so we fall back
   * to zero instead of crashing.
   */
  async getCobranzasReport(companyId: string, dateFrom?: string, dateTo?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);
      const prev = getPreviousPeriod(dates.dateFrom, dates.dateTo);

      // Check whether the cobros table exists to decide query strategy
      const cobrosExists = await this.tableExists('cobros');

      // --- Aging report based on orders with payment_status = 'pendiente' ---
      // When cobros table is missing, treat paid amount as 0.
      const cobrosSubquery = cobrosExists
        ? `COALESCE((SELECT SUM(CAST(cb.amount AS decimal)) FROM cobros cb WHERE cb.order_id = o.id), 0)`
        : `0`;

      const agingResult = await pool.query(`
        SELECT
          CASE
            WHEN CURRENT_DATE - o.created_at::date <= 0 THEN 'al_dia'
            WHEN CURRENT_DATE - o.created_at::date BETWEEN 1 AND 30 THEN '1_30'
            WHEN CURRENT_DATE - o.created_at::date BETWEEN 31 AND 60 THEN '31_60'
            WHEN CURRENT_DATE - o.created_at::date BETWEEN 61 AND 90 THEN '61_90'
            ELSE '90_plus'
          END as bucket,
          COUNT(*) as cantidad,
          COALESCE(SUM(
            CAST(o.total_amount AS decimal) - ${cobrosSubquery}
          ), 0) as monto
        FROM orders o
        WHERE o.company_id = $1
          AND o.payment_status = 'pendiente'
          AND o.status NOT IN ('cancelado', 'cancelled')
          AND CAST(o.total_amount AS decimal) > ${cobrosSubquery}
        GROUP BY bucket
        ORDER BY
          CASE bucket
            WHEN 'al_dia' THEN 0
            WHEN '1_30' THEN 1
            WHEN '31_60' THEN 2
            WHEN '61_90' THEN 3
            WHEN '90_plus' THEN 4
          END
      `, [companyId]);

      const bucketLabels: Record<string, string> = {
        'al_dia': 'Al dia',
        '1_30': '1-30 dias',
        '31_60': '31-60 dias',
        '61_90': '61-90 dias',
        '90_plus': '90+ dias',
      };
      const bucketColors: Record<string, string> = {
        'al_dia': 'green',
        '1_30': 'blue',
        '31_60': 'orange',
        '61_90': 'red',
        '90_plus': 'red',
      };

      const allBuckets = ['al_dia', '1_30', '31_60', '61_90', '90_plus'];
      const agingMap = new Map<string, { cantidad: number; monto: number }>();
      for (const r of extractRows(agingResult)) {
        agingMap.set(r.bucket, {
          cantidad: parseInt(r.cantidad) || 0,
          monto: parseFloat(r.monto) || 0,
        });
      }

      const aging = allBuckets.map(bucket => ({
        bucket,
        label: bucketLabels[bucket],
        color: bucketColors[bucket],
        cantidad: agingMap.get(bucket)?.cantidad || 0,
        monto: round2(agingMap.get(bucket)?.monto || 0),
      }));

      // Total pending
      const totalPendiente = aging.reduce((s, a) => s + a.monto, 0);
      const facturasVencidas = aging
        .filter(a => ['31_60', '61_90', '90_plus'].includes(a.bucket))
        .reduce((s, a) => s + a.cantidad, 0);
      const montoVencido = aging
        .filter(a => ['31_60', '61_90', '90_plus'].includes(a.bucket))
        .reduce((s, a) => s + a.monto, 0);

      // DSO & collections: only query if cobros table exists
      let dsoPromedio = 0;
      let prevDsoPromedio = 0;
      let cobranzasPeriodo = 0;
      let prevCobranzasPeriodo = 0;

      if (cobrosExists) {
        // DSO: average days between order creation and cobro payment_date
        const dsoResult = await db.execute(sql`
          SELECT AVG(
            EXTRACT(EPOCH FROM (cb.payment_date - o.created_at)) / 86400
          ) as dso_promedio
          FROM cobros cb
          JOIN orders o ON cb.order_id = o.id
          WHERE o.company_id = ${companyId}
            AND cb.payment_date::date >= ${dates.dateFrom}::date
            AND cb.payment_date::date <= ${dates.dateTo}::date
        `);
        dsoPromedio = round2(parseFloat(extractRows(dsoResult)[0]?.dso_promedio) || 0);

        // Previous DSO
        const prevDsoResult = await db.execute(sql`
          SELECT AVG(
            EXTRACT(EPOCH FROM (cb.payment_date - o.created_at)) / 86400
          ) as dso_promedio
          FROM cobros cb
          JOIN orders o ON cb.order_id = o.id
          WHERE o.company_id = ${companyId}
            AND cb.payment_date::date >= ${prev.dateFrom}::date
            AND cb.payment_date::date <= ${prev.dateTo}::date
        `);
        prevDsoPromedio = round2(parseFloat(extractRows(prevDsoResult)[0]?.dso_promedio) || 0);

        // Collections in period
        const cobrosResult = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total
          FROM cobros
          WHERE company_id = ${companyId}
            AND COALESCE(payment_date, created_at)::date >= ${dates.dateFrom}::date
            AND COALESCE(payment_date, created_at)::date <= ${dates.dateTo}::date
        `);
        cobranzasPeriodo = parseFloat(extractRows(cobrosResult)[0]?.total) || 0;

        const prevCobrosResult = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(amount AS decimal)), 0) as total
          FROM cobros
          WHERE company_id = ${companyId}
            AND COALESCE(payment_date, created_at)::date >= ${prev.dateFrom}::date
            AND COALESCE(payment_date, created_at)::date <= ${prev.dateTo}::date
        `);
        prevCobranzasPeriodo = parseFloat(extractRows(prevCobrosResult)[0]?.total) || 0;
      }

      // Top 5 delinquent clients
      const morososResult = await pool.query(`
        SELECT
          COALESCE(e.name, c.name, 'Sin cliente') as nombre,
          SUM(
            CAST(o.total_amount AS decimal) - ${cobrosSubquery}
          ) as monto_pendiente,
          COUNT(*) as pedidos_pendientes,
          MAX(CURRENT_DATE - o.created_at::date) as dias_max_atraso
        FROM orders o
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = $1
          AND o.payment_status = 'pendiente'
          AND o.status NOT IN ('cancelado', 'cancelled')
          AND CAST(o.total_amount AS decimal) > ${cobrosSubquery}
          AND (o.enterprise_id IS NOT NULL OR o.customer_id IS NOT NULL)
        GROUP BY COALESCE(e.name, c.name, 'Sin cliente')
        ORDER BY monto_pendiente DESC
        LIMIT 5
      `, [companyId]);

      const morosos = extractRows(morososResult).map((r: any) => ({
        nombre: r.nombre,
        monto_pendiente: round2(parseFloat(r.monto_pendiente) || 0),
        pedidos_pendientes: parseInt(r.pedidos_pendientes) || 0,
        dias_max_atraso: parseInt(r.dias_max_atraso) || 0,
      }));

      return {
        summary: {
          total_pendiente: round2(totalPendiente),
          dso_promedio: dsoPromedio,
          dso_promedio_delta: deltaPercent(dsoPromedio, prevDsoPromedio),
          facturas_vencidas: facturasVencidas,
          monto_vencido: round2(montoVencido),
          cobranzas_periodo: round2(cobranzasPeriodo),
          cobranzas_periodo_delta: deltaPercent(cobranzasPeriodo, prevCobranzasPeriodo),
        },
        aging,
        morosos,
      };
    } catch (error) {
      console.error('Cobranzas report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate cobranzas report');
    }
  }

  /**
   * Inventario Report: stock value, low stock, dead stock, rotation
   */
  async getInventarioReport(companyId: string) {
    try {
      // Stock value per product
      const stockResult = await db.execute(sql`
        SELECT
          p.name as nombre,
          p.sku,
          p.id as product_id,
          COALESCE(SUM(CAST(s.quantity AS decimal)), 0) as stock_actual,
          COALESCE(pp.cost, 0) as costo_unitario,
          COALESCE(SUM(CAST(s.quantity AS decimal)), 0) * COALESCE(CAST(pp.cost AS decimal), 0) as valor_stock,
          COALESCE(p.low_stock_threshold, 0) as stock_minimo,
          p.controls_stock
        FROM products p
        LEFT JOIN stock s ON p.id = s.product_id
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.company_id = ${companyId}
          AND p.active = true
        GROUP BY p.id, p.name, p.sku, pp.cost, p.low_stock_threshold, p.controls_stock
        ORDER BY valor_stock DESC
        LIMIT 100
      `);

      const stockItems = extractRows(stockResult).map((r: any) => ({
        nombre: r.nombre,
        sku: r.sku,
        product_id: r.product_id,
        stock_actual: parseFloat(r.stock_actual) || 0,
        costo_unitario: parseFloat(r.costo_unitario) || 0,
        valor_stock: round2(parseFloat(r.valor_stock) || 0),
        stock_minimo: parseFloat(r.stock_minimo) || 0,
        controls_stock: r.controls_stock === true || r.controls_stock === 't',
      }));

      // Summary
      const valorTotal = stockItems.reduce((s, p) => s + p.valor_stock, 0);
      const bajoMinimo = stockItems.filter(p =>
        p.controls_stock && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
      ).length;

      // Dead stock (products with stock but no sales in 60+ days)
      const deadStockResult = await db.execute(sql`
        SELECT
          p.name as nombre,
          p.sku,
          COALESCE(SUM(CAST(s.quantity AS decimal)), 0) as stock_actual,
          MAX(oi.created_at) as ultima_venta,
          CURRENT_DATE - COALESCE(MAX(oi.created_at)::date, p.created_at::date) as dias_sin_venta,
          COALESCE(SUM(CAST(s.quantity AS decimal)), 0) * COALESCE(CAST(pp.cost AS decimal), 0) as valor_inmovilizado
        FROM products p
        LEFT JOIN stock s ON p.id = s.product_id
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        LEFT JOIN order_items oi ON p.id = oi.product_id
          AND oi.order_id IN (
            SELECT id FROM orders WHERE company_id = ${companyId} AND status NOT IN ('cancelado', 'cancelled')
          )
        WHERE p.company_id = ${companyId}
          AND p.active = true
          AND COALESCE(CAST(s.quantity AS decimal), 0) > 0
        GROUP BY p.id, p.name, p.sku, pp.cost, p.created_at
        HAVING COALESCE(MAX(oi.created_at)::date, p.created_at::date) < (CURRENT_DATE - INTERVAL '60 days')
        ORDER BY valor_inmovilizado DESC
        LIMIT 20
      `);

      const deadStock = extractRows(deadStockResult).map((r: any) => ({
        nombre: r.nombre,
        sku: r.sku,
        stock_actual: parseFloat(r.stock_actual) || 0,
        ultima_venta: r.ultima_venta,
        dias_sin_venta: parseInt(r.dias_sin_venta) || 0,
        valor_inmovilizado: round2(parseFloat(r.valor_inmovilizado) || 0),
      }));

      // Products below minimum stock
      const lowStockItems = stockItems.filter(p =>
        p.controls_stock && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
      );

      return {
        summary: {
          valor_total: round2(valorTotal),
          productos_bajo_minimo: bajoMinimo,
          productos_sin_movimiento: deadStock.length,
        },
        stock_items: stockItems,
        dead_stock: deadStock,
        low_stock: lowStockItems,
      };
    } catch (error) {
      console.error('Inventario report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate inventario report');
    }
  }

  /**
   * Conversion Report: quotes issued vs converted to orders, rate, values, avg time
   */
  async getConversionReport(companyId: string, dateFrom?: string, dateTo?: string) {
    try {
      const dates = validateDateRange(dateFrom, dateTo);
      const prev = getPreviousPeriod(dates.dateFrom, dates.dateTo);

      // Quotes in period
      const quotesResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_cotizaciones,
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as valor_total_cotizado,
          COUNT(*) FILTER (WHERE status = 'aceptada' OR status = 'accepted') as convertidas,
          COALESCE(SUM(CAST(total_amount AS decimal)) FILTER (WHERE status = 'aceptada' OR status = 'accepted'), 0) as valor_convertido,
          COUNT(*) FILTER (WHERE status = 'rechazada' OR status = 'rejected') as rechazadas,
          COUNT(*) FILTER (WHERE status = 'borrador' OR status = 'draft' OR status = 'enviada' OR status = 'sent') as abiertas,
          COALESCE(SUM(CAST(total_amount AS decimal)) FILTER (WHERE status = 'borrador' OR status = 'draft' OR status = 'enviada' OR status = 'sent'), 0) as valor_pipeline
        FROM quotes
        WHERE company_id = ${companyId}
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
      `);
      const q = extractRows(quotesResult)[0] || {};

      const totalCotizaciones = parseInt(q.total_cotizaciones) || 0;
      const convertidas = parseInt(q.convertidas) || 0;
      const tasaConversion = totalCotizaciones > 0 ? round2((convertidas / totalCotizaciones) * 100) : 0;
      const valorTotalCotizado = parseFloat(q.valor_total_cotizado) || 0;
      const valorConvertido = parseFloat(q.valor_convertido) || 0;
      const valorPipeline = parseFloat(q.valor_pipeline) || 0;
      const rechazadas = parseInt(q.rechazadas) || 0;
      const abiertas = parseInt(q.abiertas) || 0;

      // Previous period
      const prevQuotesResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_cotizaciones,
          COUNT(*) FILTER (WHERE status = 'aceptada' OR status = 'accepted') as convertidas
        FROM quotes
        WHERE company_id = ${companyId}
          AND created_at::date >= ${prev.dateFrom}::date
          AND created_at::date <= ${prev.dateTo}::date
      `);
      const pq = extractRows(prevQuotesResult)[0] || {};
      const prevTotal = parseInt(pq.total_cotizaciones) || 0;
      const prevConvertidas = parseInt(pq.convertidas) || 0;
      const prevTasa = prevTotal > 0 ? round2((prevConvertidas / prevTotal) * 100) : 0;

      // Average time from quote to order (for converted quotes)
      const timeResult = await db.execute(sql`
        SELECT
          AVG(EXTRACT(EPOCH FROM (o.created_at - q.created_at)) / 86400) as dias_promedio
        FROM quotes q
        JOIN orders o ON o.quote_id = q.id
        WHERE q.company_id = ${companyId}
          AND q.created_at::date >= ${dates.dateFrom}::date
          AND q.created_at::date <= ${dates.dateTo}::date
          AND (q.status = 'aceptada' OR q.status = 'accepted')
      `);
      const tiempoPromedio = round2(parseFloat(extractRows(timeResult)[0]?.dias_promedio) || 0);

      // Valor promedio de cotizaciones perdidas
      const lostResult = await db.execute(sql`
        SELECT
          COALESCE(AVG(CAST(total_amount AS decimal)), 0) as valor_promedio_perdido
        FROM quotes
        WHERE company_id = ${companyId}
          AND (status = 'rechazada' OR status = 'rejected')
          AND created_at::date >= ${dates.dateFrom}::date
          AND created_at::date <= ${dates.dateTo}::date
      `);
      const valorPromedioPerdido = round2(parseFloat(extractRows(lostResult)[0]?.valor_promedio_perdido) || 0);

      // Funnel data
      const funnel = [
        { etapa: 'Emitidas', cantidad: totalCotizaciones, valor: round2(valorTotalCotizado) },
        { etapa: 'Aceptadas', cantidad: convertidas, valor: round2(valorConvertido) },
        { etapa: 'Rechazadas', cantidad: rechazadas, valor: 0 },
        { etapa: 'Abiertas', cantidad: abiertas, valor: round2(valorPipeline) },
      ];

      // Open quotes list
      const openQuotesResult = await db.execute(sql`
        SELECT
          q.id,
          COALESCE(e.name, c.name, 'Sin cliente') as cliente,
          q.title,
          q.created_at as fecha,
          CAST(q.total_amount AS decimal) as monto,
          CURRENT_DATE - q.created_at::date as dias_abierto,
          q.status
        FROM quotes q
        LEFT JOIN enterprises e ON q.enterprise_id = e.id
        LEFT JOIN customers c ON q.customer_id = c.id
        WHERE q.company_id = ${companyId}
          AND (q.status = 'borrador' OR q.status = 'draft' OR q.status = 'enviada' OR q.status = 'sent')
          AND q.created_at::date >= ${dates.dateFrom}::date
          AND q.created_at::date <= ${dates.dateTo}::date
        ORDER BY q.created_at DESC
        LIMIT 20
      `);

      const cotizacionesAbiertas = extractRows(openQuotesResult).map((r: any) => ({
        id: r.id,
        cliente: r.cliente,
        titulo: r.title || 'Sin titulo',
        fecha: r.fecha,
        monto: round2(parseFloat(r.monto) || 0),
        dias_abierto: parseInt(r.dias_abierto) || 0,
        status: r.status,
      }));

      return {
        summary: {
          tasa_conversion: tasaConversion,
          tasa_conversion_delta: deltaPercent(tasaConversion, prevTasa),
          valor_pipeline: round2(valorPipeline),
          valor_promedio_perdido: valorPromedioPerdido,
          tiempo_promedio_dias: tiempoPromedio,
          total_cotizaciones: totalCotizaciones,
        },
        funnel,
        cotizaciones_abiertas: cotizacionesAbiertas,
      };
    } catch (error) {
      console.error('Conversion report error:', error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to generate conversion report');
    }
  }
}

export const businessService = new BusinessService();
