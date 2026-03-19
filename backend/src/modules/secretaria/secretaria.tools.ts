// SecretarIA — Pre-built query tools for WhatsApp assistant
// Each tool runs safe, parameterized SQL and returns WhatsApp-formatted results.
// SECURITY: Every query filters by company_id (server-side, never from user input).

import { pool } from '../../config/db';
import {
  getCompanySummary,
  getTopCustomers,
  getTopProducts,
  getCollectionsSummary,
} from '../ai/ai.queries';
import { SecretariaIntent, ToolResult } from './secretaria.types';
import { SECRETARIA_PROMPTS } from './secretaria.config';
import { secretariaMediaService } from './secretaria.media';
import logger from '../../config/logger';

// ── Formatting Helpers ──

function formatMoney(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1).replace('.', ',')}M`;
  }
  return `$${Math.round(amount).toLocaleString('es-AR')}`;
}

function formatDate(date: string | Date | null): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}

// ── Query Clients ──

export async function queryClients(
  companyId: string,
  entities: Record<string, string>,
): Promise<ToolResult> {
  try {
    if (entities.client_name) {
      // Fuzzy search by name
      const searchTerm = `%${entities.client_name}%`;
      const result = await pool.query(`
        SELECT
          COALESCE(e.name, c.name, 'Sin nombre') as nombre,
          e.cuit,
          COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as total_facturado,
          MAX(o.created_at) as ultimo_pedido,
          COALESCE(SUM(CASE WHEN o.payment_status = 'pendiente' THEN CAST(o.total_amount AS decimal) ELSE 0 END), 0) as saldo_pendiente,
          COUNT(o.id) as cantidad_pedidos
        FROM orders o
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = $1
          AND (e.name ILIKE $2 OR c.name ILIKE $2)
        GROUP BY COALESCE(e.name, c.name, 'Sin nombre'), e.cuit
        ORDER BY total_facturado DESC
        LIMIT 10
      `, [companyId, searchTerm]);

      const rows = result.rows as any[];
      if (rows.length === 0) {
        return {
          toolName: 'queryClients',
          data: [],
          formatted: `No encontre clientes con el nombre "${entities.client_name}".`,
        };
      }

      const lines = rows.map((r, i) => {
        const cuit = r.cuit ? ` - CUIT: ${r.cuit}` : '';
        const saldo = parseFloat(r.saldo_pendiente) > 0
          ? ` - *Saldo: ${formatMoney(parseFloat(r.saldo_pendiente))}*`
          : '';
        return `${i + 1}. *${r.nombre}*${cuit}\n   Facturado: ${formatMoney(parseFloat(r.total_facturado))} (${r.cantidad_pedidos} pedidos)${saldo}\n   Ultimo pedido: ${formatDate(r.ultimo_pedido)}`;
      });

      return {
        toolName: 'queryClients',
        data: rows,
        formatted: `*Clientes encontrados:*\n\n${lines.join('\n\n')}`,
      };
    }

    // Default: top 10 clients by revenue this month
    const result = await pool.query(`
      SELECT
        COALESCE(e.name, c.name, 'Sin nombre') as nombre,
        e.cuit,
        COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as total_facturado,
        MAX(o.created_at) as ultimo_pedido,
        COALESCE(SUM(CASE WHEN o.payment_status = 'pendiente' THEN CAST(o.total_amount AS decimal) ELSE 0 END), 0) as saldo_pendiente,
        COUNT(o.id) as cantidad_pedidos
      FROM orders o
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.company_id = $1
        AND o.created_at >= DATE_TRUNC('month', NOW())
      GROUP BY COALESCE(e.name, c.name, 'Sin nombre'), e.cuit
      ORDER BY total_facturado DESC
      LIMIT 10
    `, [companyId]);

    const rows = result.rows as any[];
    if (rows.length === 0) {
      return {
        toolName: 'queryClients',
        data: [],
        formatted: 'No hay clientes con pedidos este mes.',
      };
    }

    const lines = rows.map((r, i) => {
      const saldo = parseFloat(r.saldo_pendiente) > 0
        ? ` - Saldo: ${formatMoney(parseFloat(r.saldo_pendiente))}`
        : '';
      return `${i + 1}. ${r.nombre} - ${formatMoney(parseFloat(r.total_facturado))}${saldo}`;
    });

    return {
      toolName: 'queryClients',
      data: rows,
      formatted: `*Top clientes del mes:*\n${lines.join('\n')}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA queryClients failed');
    return { toolName: 'queryClients', data: null, formatted: 'Error al consultar clientes.' };
  }
}

// ── Query Products ──

export async function queryProducts(
  companyId: string,
  entities: Record<string, string>,
): Promise<ToolResult> {
  try {
    if (entities.product_name) {
      const searchTerm = `%${entities.product_name}%`;
      const result = await pool.query(`
        SELECT
          p.name as nombre,
          p.sku,
          COALESCE(CAST(pp.price AS decimal), 0) as precio,
          COALESCE(CAST(pp.cost AS decimal), 0) as costo,
          COALESCE(s.quantity, 0) as stock,
          p.controls_stock,
          CASE WHEN COALESCE(CAST(pp.price AS decimal), 0) > 0
            THEN ROUND((1 - COALESCE(CAST(pp.cost AS decimal), 0) / CAST(pp.price AS decimal)) * 100, 1)
            ELSE 0
          END as margen_pct
        FROM products p
        LEFT JOIN product_pricing pp ON pp.product_id = p.id
        LEFT JOIN stock s ON s.product_id = p.id
        WHERE p.company_id = $1
          AND (p.name ILIKE $2 OR p.sku ILIKE $2)
          AND p.active = true
        ORDER BY p.name ASC
        LIMIT 10
      `, [companyId, searchTerm]);

      const rows = result.rows as any[];
      if (rows.length === 0) {
        return {
          toolName: 'queryProducts',
          data: [],
          formatted: `No encontre productos con "${entities.product_name}".`,
        };
      }

      const lines = rows.map((r, i) => {
        const sku = r.sku ? ` (${r.sku})` : '';
        const stockInfo = r.controls_stock ? ` - Stock: ${parseFloat(r.stock)}` : '';
        const margen = parseFloat(r.costo) > 0 ? ` - Margen: ${formatPercent(parseFloat(r.margen_pct))}` : '';
        return `${i + 1}. *${r.nombre}*${sku}\n   Precio: ${formatMoney(parseFloat(r.precio))}${stockInfo}${margen}`;
      });

      return {
        toolName: 'queryProducts',
        data: rows,
        formatted: `*Productos encontrados:*\n\n${lines.join('\n\n')}`,
      };
    }

    // Default: top 10 products by sales
    const topProducts = await getTopProducts(companyId, 10);

    if (topProducts.length === 0) {
      return {
        toolName: 'queryProducts',
        data: [],
        formatted: 'No hay datos de productos vendidos.',
      };
    }

    const lines = topProducts.map((p, i) => {
      const margen = p.margin_pct > 0 ? ` - Margen: ${formatPercent(p.margin_pct)}` : '';
      return `${i + 1}. ${p.name} - ${formatMoney(p.revenue)} (${p.quantity} uds)${margen}`;
    });

    return {
      toolName: 'queryProducts',
      data: topProducts,
      formatted: `*Top productos por venta:*\n${lines.join('\n')}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA queryProducts failed');
    return { toolName: 'queryProducts', data: null, formatted: 'Error al consultar productos.' };
  }
}

// ── Query Invoices ──

export async function queryInvoices(
  companyId: string,
  entities: Record<string, string>,
): Promise<ToolResult> {
  try {
    const conditions: string[] = ['i.company_id = $1'];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (entities.client_name) {
      conditions.push(`(e.name ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
      params.push(`%${entities.client_name}%`);
      paramIdx++;
    }

    if (entities.status) {
      const statusMap: Record<string, string> = {
        pendiente: 'draft',
        borrador: 'draft',
        autorizada: 'authorized',
        aprobada: 'authorized',
      };
      const mapped = statusMap[entities.status.toLowerCase()] || entities.status;
      conditions.push(`i.status = $${paramIdx}`);
      params.push(mapped);
      paramIdx++;
    }

    if (entities.invoice_type) {
      conditions.push(`i.invoice_type = $${paramIdx}`);
      params.push(entities.invoice_type.toUpperCase());
      paramIdx++;
    }

    if (entities.date_from) {
      conditions.push(`i.invoice_date >= $${paramIdx}::date`);
      params.push(entities.date_from);
      paramIdx++;
    }

    if (entities.date_to) {
      conditions.push(`i.invoice_date <= $${paramIdx}::date`);
      params.push(entities.date_to);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(`
      SELECT
        i.invoice_type as tipo,
        LPAD(COALESCE(i.invoice_number::text, '0'), 5, '0') as numero,
        COALESCE(e.name, c.name, 'Sin cliente') as cliente,
        CAST(i.total_amount AS decimal) as monto,
        i.status,
        i.invoice_date as fecha
      FROM invoices i
      LEFT JOIN enterprises e ON i.enterprise_id = e.id
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY i.invoice_date DESC
      LIMIT 10
    `, params);

    const rows = result.rows as any[];
    if (rows.length === 0) {
      return {
        toolName: 'queryInvoices',
        data: [],
        formatted: 'No encontre facturas con esos criterios.',
      };
    }

    const statusLabels: Record<string, string> = {
      draft: 'Borrador',
      authorized: 'Autorizada',
      cancelled: 'Anulada',
      rejected: 'Rechazada',
    };

    const lines = rows.map(r => {
      const statusLabel = statusLabels[r.status] || r.status;
      const bold = r.status === 'draft' ? '*Pendiente*' : statusLabel;
      return `- ${r.tipo} ${r.numero} - ${r.cliente} - ${formatMoney(parseFloat(r.monto))} - ${bold} (${formatDate(r.fecha)})`;
    });

    const total = rows.reduce((s, r) => s + parseFloat(r.monto || '0'), 0);

    return {
      toolName: 'queryInvoices',
      data: rows,
      formatted: `*Facturas:*\n${lines.join('\n')}\n\n*Total:* ${formatMoney(total)}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA queryInvoices failed');
    return { toolName: 'queryInvoices', data: null, formatted: 'Error al consultar facturas.' };
  }
}

// ── Query Balances ──

export async function queryBalances(
  companyId: string,
  entities: Record<string, string>,
): Promise<ToolResult> {
  try {
    if (entities.client_name) {
      // Per-client balance breakdown
      const searchTerm = `%${entities.client_name}%`;
      const result = await pool.query(`
        SELECT
          COALESCE(e.name, c.name, 'Sin nombre') as nombre,
          COALESCE(SUM(CASE WHEN o.payment_status = 'pendiente' THEN CAST(o.total_amount AS decimal) ELSE 0 END), 0) as por_cobrar,
          COUNT(CASE WHEN o.payment_status = 'pendiente' THEN 1 END) as facturas_pendientes,
          MAX(o.created_at) as ultimo_pedido
        FROM orders o
        LEFT JOIN enterprises e ON o.enterprise_id = e.id
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.company_id = $1
          AND (e.name ILIKE $2 OR c.name ILIKE $2)
        GROUP BY COALESCE(e.name, c.name, 'Sin nombre')
        ORDER BY por_cobrar DESC
        LIMIT 5
      `, [companyId, searchTerm]);

      const rows = result.rows as any[];
      if (rows.length === 0) {
        return {
          toolName: 'queryBalances',
          data: [],
          formatted: `No encontre saldos para "${entities.client_name}".`,
        };
      }

      const lines = rows.map(r => {
        const pending = parseFloat(r.por_cobrar);
        return `*${r.nombre}*\n   Por cobrar: ${formatMoney(pending)} (${r.facturas_pendientes} facturas)\n   Ultimo pedido: ${formatDate(r.ultimo_pedido)}`;
      });

      return {
        toolName: 'queryBalances',
        data: rows,
        formatted: `*Saldos:*\n\n${lines.join('\n\n')}`,
      };
    }

    // General balance summary
    const collections = await getCollectionsSummary(companyId);

    const porCobrar = collections.pending_collection_amount;
    const cobrado = collections.collected_this_month;
    const pagado = collections.paid_this_month;
    const neto = porCobrar - pagado;

    return {
      toolName: 'queryBalances',
      data: collections,
      formatted: `*Saldos:*\n*Por cobrar:* ${formatMoney(porCobrar)} (${collections.pending_collection_count} pedidos)\n*Cobrado este mes:* ${formatMoney(cobrado)}\n*Pagado este mes:* ${formatMoney(pagado)}\n*Neto pendiente:* ${formatMoney(neto)}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA queryBalances failed');
    return { toolName: 'queryBalances', data: null, formatted: 'Error al consultar saldos.' };
  }
}

// ── Query Orders ──

export async function queryOrders(
  companyId: string,
  entities: Record<string, string>,
): Promise<ToolResult> {
  try {
    const conditions: string[] = ['o.company_id = $1'];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (entities.client_name) {
      conditions.push(`(e.name ILIKE $${paramIdx} OR c.name ILIKE $${paramIdx})`);
      params.push(`%${entities.client_name}%`);
      paramIdx++;
    }

    if (entities.status) {
      conditions.push(`o.status = $${paramIdx}`);
      params.push(entities.status);
      paramIdx++;
    } else {
      // Default: show pending + in_production orders
      conditions.push(`o.status IN ('pendiente', 'en_produccion', 'in_production', 'listo')`);
    }

    if (entities.date_from) {
      conditions.push(`o.created_at >= $${paramIdx}::date`);
      params.push(entities.date_from);
      paramIdx++;
    }

    if (entities.date_to) {
      conditions.push(`o.created_at <= $${paramIdx}::date`);
      params.push(entities.date_to);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(`
      SELECT
        LPAD(COALESCE(o.order_number::text, '0'), 4, '0') as numero,
        COALESCE(e.name, c.name, 'Sin cliente') as cliente,
        CAST(o.total_amount AS decimal) as monto,
        o.status,
        o.payment_status,
        o.created_at as fecha
      FROM orders o
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT 15
    `, params);

    const rows = result.rows as any[];
    if (rows.length === 0) {
      return {
        toolName: 'queryOrders',
        data: [],
        formatted: 'No hay pedidos con esos criterios.',
      };
    }

    const statusLabels: Record<string, string> = {
      pendiente: 'Pendiente',
      en_produccion: 'En produccion',
      in_production: 'En produccion',
      listo: 'Listo',
      entregado: 'Entregado',
      cancelado: 'Cancelado',
    };

    const lines = rows.map(r => {
      const statusLabel = statusLabels[r.status] || r.status;
      const pago = r.payment_status === 'pendiente' ? ' (impago)' : '';
      return `- #${r.numero} ${r.cliente} - ${formatMoney(parseFloat(r.monto))} - ${statusLabel}${pago}`;
    });

    const total = rows.reduce((s, r) => s + parseFloat(r.monto || '0'), 0);

    return {
      toolName: 'queryOrders',
      data: rows,
      formatted: `*Pedidos:*\n${lines.join('\n')}\n\n*Total:* ${formatMoney(total)} (${rows.length} pedidos)`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA queryOrders failed');
    return { toolName: 'queryOrders', data: null, formatted: 'Error al consultar pedidos.' };
  }
}

// ── Query General ──

export async function queryGeneral(
  companyId: string,
  _entities: Record<string, string>,
): Promise<ToolResult> {
  try {
    const [summary, topCustomers, topProducts] = await Promise.all([
      getCompanySummary(companyId),
      getTopCustomers(companyId, 3),
      getTopProducts(companyId, 3),
    ]);

    // Month-over-month comparison
    const momResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('month', NOW()) THEN CAST(total_amount AS decimal) ELSE 0 END), 0) as mes_actual,
        COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
          AND created_at < DATE_TRUNC('month', NOW()) THEN CAST(total_amount AS decimal) ELSE 0 END), 0) as mes_anterior
      FROM orders
      WHERE company_id = $1
        AND status NOT IN ('cancelado', 'cancelled')
    `, [companyId]);

    const mom = momResult.rows[0] as any;
    const mesActual = parseFloat(mom?.mes_actual || '0');
    const mesAnterior = parseFloat(mom?.mes_anterior || '0');
    const variacion = mesAnterior > 0
      ? ((mesActual - mesAnterior) / mesAnterior * 100)
      : 0;
    const variacionStr = variacion >= 0
      ? `+${formatPercent(variacion)}`
      : formatPercent(variacion);
    const arrow = variacion >= 0 ? '\u2191' : '\u2193';

    const topClienteStr = topCustomers.length > 0
      ? topCustomers[0].name
      : 'N/A';
    const topProductoStr = topProducts.length > 0
      ? topProducts[0].name
      : 'N/A';

    const formatted = `*Resumen del negocio:*
*Ventas del mes:* ${formatMoney(mesActual)} (${arrow}${variacionStr} vs mes anterior)
*Pedidos totales:* ${summary.total_orders} | *Pendientes:* ${summary.pending_orders}
*Top cliente:* ${topClienteStr}
*Top producto:* ${topProductoStr}
*Clientes:* ${summary.total_customers} | *Productos:* ${summary.total_products}`;

    return {
      toolName: 'queryGeneral',
      data: { summary, topCustomers, topProducts, mesActual, mesAnterior, variacion },
      formatted,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA queryGeneral failed');
    return { toolName: 'queryGeneral', data: null, formatted: 'Error al generar resumen.' };
  }
}

// ── Morning Brief ──

export async function morningBrief(companyId: string): Promise<ToolResult> {
  try {
    const today = new Date();
    const dateStr = formatDate(today);

    const [summary, collections, pendingOrders, lowStock, cheques] = await Promise.all([
      getCompanySummary(companyId),
      getCollectionsSummary(companyId),
      pool.query(`
        SELECT COUNT(*) as cantidad,
          COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total
        FROM orders
        WHERE company_id = $1
          AND status IN ('pendiente', 'en_produccion', 'in_production', 'listo')
      `, [companyId]),
      pool.query(`
        SELECT p.name, COALESCE(s.quantity, 0) as stock, p.low_stock_threshold
        FROM products p
        LEFT JOIN stock s ON s.product_id = p.id
        WHERE p.company_id = $1
          AND p.controls_stock = true
          AND COALESCE(s.quantity, 0) <= COALESCE(p.low_stock_threshold, 0)
          AND COALESCE(p.low_stock_threshold, 0) > 0
        ORDER BY COALESCE(s.quantity, 0) ASC
        LIMIT 5
      `, [companyId]),
      pool.query(`
        SELECT COUNT(*) as cantidad,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total
        FROM cheques
        WHERE company_id = $1
          AND status = 'cartera'
          AND due_date <= NOW() + INTERVAL '3 days'
          AND due_date >= NOW() - INTERVAL '1 day'
      `, [companyId]),
    ]);

    const pendingRows = pendingOrders.rows[0] as any;
    const pedidosPendientes = parseInt(pendingRows?.cantidad || '0');
    const totalPedidos = parseFloat(pendingRows?.total || '0');

    const lowStockItems = lowStock.rows as any[];
    const chequesRow = cheques.rows[0] as any;
    const chequesCount = parseInt(chequesRow?.cantidad || '0');
    const chequesTotal = parseFloat(chequesRow?.total || '0');

    // Month-over-month sales
    const momResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('month', NOW()) THEN CAST(total_amount AS decimal) ELSE 0 END), 0) as mes_actual
      FROM orders
      WHERE company_id = $1
        AND status NOT IN ('cancelado', 'cancelled')
    `, [companyId]);
    const ventasMes = parseFloat((momResult.rows[0] as any)?.mes_actual || '0');

    let formatted = `*Buenos dias!* Resumen de hoy (${dateStr})\n`;
    formatted += `\n*Ventas del mes:* ${formatMoney(ventasMes)}`;
    formatted += `\n*Pedidos pendientes:* ${pedidosPendientes} por ${formatMoney(totalPedidos)}`;
    formatted += `\n*Por cobrar:* ${formatMoney(collections.pending_collection_amount)} (${collections.pending_collection_count} pedidos)`;

    if (chequesCount > 0) {
      formatted += `\n*Cheques proximos:* ${chequesCount} por ${formatMoney(chequesTotal)}`;
    }

    if (lowStockItems.length > 0) {
      const stockLines = lowStockItems.slice(0, 3).map(
        (r: any) => `  - ${r.name}: ${parseFloat(r.stock)} uds (min: ${parseFloat(r.low_stock_threshold)})`
      );
      formatted += `\n\n*Stock bajo:*\n${stockLines.join('\n')}`;
    }

    const data = {
      ventasMes,
      pedidosPendientes,
      totalPedidos,
      porCobrar: collections.pending_collection_amount,
      chequesCount,
      chequesTotal,
      lowStockItems: lowStockItems.length,
      summary,
    };

    return { toolName: 'morningBrief', data, formatted };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA morningBrief failed');
    return { toolName: 'morningBrief', data: null, formatted: 'Error al generar el resumen matutino.' };
  }
}

// ── Send Document ──

export async function sendDocument(
  companyId: string,
  entities: Record<string, string>,
  phoneNumber?: string,
): Promise<ToolResult> {
  try {
    if (!phoneNumber) {
      return {
        toolName: 'sendDocument',
        data: null,
        formatted: 'No puedo enviar documentos sin un numero de telefono vinculado.',
      };
    }

    const documentType = entities.document_type?.toLowerCase() || '';
    const reportType = entities.report_type?.toLowerCase() || '';
    const sendFormat = entities.send_format?.toLowerCase() || 'pdf';
    const clientName = entities.client_name || '';
    const documentNumber = entities.document_number || '';

    // Handle Excel reports
    if (documentType === 'reporte' || reportType) {
      const effectiveReportType = reportType || 'ventas';
      const result = await secretariaMediaService.sendExcelReport(
        phoneNumber,
        effectiveReportType,
        companyId,
        entities.date_from,
        entities.date_to,
      );

      if (!result.success) {
        return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar el reporte.' };
      }

      return {
        toolName: 'sendDocument',
        data: { type: 'excel_report', reportType: effectiveReportType },
        formatted: `Te envie el reporte de ${effectiveReportType} en Excel.`,
      };
    }

    // Resolve document ID from number + client name
    if (documentType === 'factura' || (!documentType && !reportType)) {
      // Try to find invoice by number or client name
      const invoiceId = await resolveInvoiceId(companyId, documentNumber, clientName);

      if (!invoiceId) {
        return {
          toolName: 'sendDocument',
          data: null,
          formatted: documentNumber
            ? `No encontre la factura ${documentNumber}.`
            : clientName
              ? `No encontre facturas para "${clientName}".`
              : 'Necesito que me digas el numero de factura o el nombre del cliente. Ej: "mandame la factura 0002" o "mandame la factura de Garcia".',
        };
      }

      if (sendFormat === 'preview') {
        const result = await secretariaMediaService.sendPreviewImage(phoneNumber, 'factura', invoiceId, companyId);
        if (!result.success) {
          return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar la preview.' };
        }
        return { toolName: 'sendDocument', data: { type: 'preview', documentType: 'factura' }, formatted: 'Te envie la preview de la factura.' };
      }

      const result = await secretariaMediaService.sendInvoicePdf(phoneNumber, invoiceId, companyId);
      if (!result.success) {
        return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar la factura.' };
      }
      return { toolName: 'sendDocument', data: { type: 'invoice_pdf' }, formatted: 'Te envie el PDF de la factura.' };
    }

    if (documentType === 'cotizacion') {
      const quoteId = await resolveQuoteId(companyId, documentNumber, clientName);

      if (!quoteId) {
        return {
          toolName: 'sendDocument',
          data: null,
          formatted: documentNumber
            ? `No encontre la cotizacion ${documentNumber}.`
            : clientName
              ? `No encontre cotizaciones para "${clientName}".`
              : 'Necesito el numero de cotizacion o el nombre del cliente.',
        };
      }

      if (sendFormat === 'preview') {
        const result = await secretariaMediaService.sendPreviewImage(phoneNumber, 'cotizacion', quoteId, companyId);
        if (!result.success) {
          return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar la preview.' };
        }
        return { toolName: 'sendDocument', data: { type: 'preview', documentType: 'cotizacion' }, formatted: 'Te envie la preview de la cotizacion.' };
      }

      const result = await secretariaMediaService.sendQuotePdf(phoneNumber, quoteId, companyId);
      if (!result.success) {
        return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar la cotizacion.' };
      }
      return { toolName: 'sendDocument', data: { type: 'quote_pdf' }, formatted: 'Te envie el PDF de la cotizacion.' };
    }

    if (documentType === 'remito') {
      const remitoId = await resolveRemitoId(companyId, documentNumber, clientName);

      if (!remitoId) {
        return {
          toolName: 'sendDocument',
          data: null,
          formatted: documentNumber
            ? `No encontre el remito ${documentNumber}.`
            : clientName
              ? `No encontre remitos para "${clientName}".`
              : 'Necesito el numero de remito o el nombre del cliente.',
        };
      }

      if (sendFormat === 'preview') {
        const result = await secretariaMediaService.sendPreviewImage(phoneNumber, 'remito', remitoId, companyId);
        if (!result.success) {
          return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar la preview.' };
        }
        return { toolName: 'sendDocument', data: { type: 'preview', documentType: 'remito' }, formatted: 'Te envie la preview del remito.' };
      }

      const result = await secretariaMediaService.sendRemitoPdf(phoneNumber, remitoId, companyId);
      if (!result.success) {
        return { toolName: 'sendDocument', data: null, formatted: result.error || 'Error al enviar el remito.' };
      }
      return { toolName: 'sendDocument', data: { type: 'remito_pdf' }, formatted: 'Te envie el PDF del remito.' };
    }

    return {
      toolName: 'sendDocument',
      data: null,
      formatted: 'No entendi que documento necesitas. Podes pedirme una factura, cotizacion, remito o un reporte en Excel.',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'SecretarIA sendDocument failed');
    return { toolName: 'sendDocument', data: null, formatted: 'Error al procesar el envio del documento. Intenta desde GESTIA.' };
  }
}

// ── Document ID Resolvers (by number or client name) ──

async function resolveInvoiceId(
  companyId: string,
  documentNumber: string,
  clientName: string,
): Promise<string | null> {
  try {
    if (documentNumber) {
      // Strip leading zeros and try exact match
      const num = parseInt(documentNumber, 10);
      const result = await pool.query(
        `SELECT i.id FROM invoices i
         WHERE i.company_id = $1 AND i.invoice_number = $2
         ORDER BY i.invoice_date DESC LIMIT 1`,
        [companyId, num],
      );
      if (result.rows.length > 0) return (result.rows[0] as any).id;
    }

    if (clientName) {
      const searchTerm = `%${clientName}%`;
      const result = await pool.query(
        `SELECT i.id FROM invoices i
         LEFT JOIN enterprises e ON i.enterprise_id = e.id
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE i.company_id = $1
           AND (e.name ILIKE $2 OR c.name ILIKE $2)
         ORDER BY i.invoice_date DESC LIMIT 1`,
        [companyId, searchTerm],
      );
      if (result.rows.length > 0) return (result.rows[0] as any).id;
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveQuoteId(
  companyId: string,
  documentNumber: string,
  clientName: string,
): Promise<string | null> {
  try {
    if (documentNumber) {
      const num = parseInt(documentNumber, 10);
      const result = await pool.query(
        `SELECT q.id FROM quotes q
         WHERE q.company_id = $1 AND q.quote_number = $2
         ORDER BY q.created_at DESC LIMIT 1`,
        [companyId, num],
      );
      if (result.rows.length > 0) return (result.rows[0] as any).id;
    }

    if (clientName) {
      const searchTerm = `%${clientName}%`;
      const result = await pool.query(
        `SELECT q.id FROM quotes q
         LEFT JOIN customers c ON q.customer_id = c.id
         WHERE q.company_id = $1
           AND (c.name ILIKE $2 OR q.title ILIKE $2)
         ORDER BY q.created_at DESC LIMIT 1`,
        [companyId, searchTerm],
      );
      if (result.rows.length > 0) return (result.rows[0] as any).id;
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveRemitoId(
  companyId: string,
  documentNumber: string,
  clientName: string,
): Promise<string | null> {
  try {
    if (documentNumber) {
      const num = parseInt(documentNumber, 10);
      const result = await pool.query(
        `SELECT r.id FROM remitos r
         WHERE r.company_id = $1 AND r.remito_number = $2
         ORDER BY r.created_at DESC LIMIT 1`,
        [companyId, num],
      );
      if (result.rows.length > 0) return (result.rows[0] as any).id;
    }

    if (clientName) {
      const searchTerm = `%${clientName}%`;
      const result = await pool.query(
        `SELECT r.id FROM remitos r
         LEFT JOIN customers c ON r.customer_id = c.id
         WHERE r.company_id = $1
           AND (c.name ILIKE $2 OR r.receiver_name ILIKE $2)
         ORDER BY r.created_at DESC LIMIT 1`,
        [companyId, searchTerm],
      );
      if (result.rows.length > 0) return (result.rows[0] as any).id;
    }

    return null;
  } catch {
    return null;
  }
}

// ── Tool Dispatcher ──

export async function executeTool(
  intent: SecretariaIntent,
  entities: Record<string, string>,
  companyId: string,
  phoneNumber?: string,
): Promise<ToolResult> {
  switch (intent) {
    case 'query_clients':
      return queryClients(companyId, entities);
    case 'query_products':
      return queryProducts(companyId, entities);
    case 'query_invoices':
      return queryInvoices(companyId, entities);
    case 'query_balances':
      return queryBalances(companyId, entities);
    case 'query_orders':
      return queryOrders(companyId, entities);
    case 'query_general':
      return queryGeneral(companyId, entities);
    case 'morning_brief':
      return morningBrief(companyId);
    case 'send_document':
      return sendDocument(companyId, entities, phoneNumber);
    case 'greeting':
      return {
        toolName: 'greeting',
        data: null,
        formatted: SECRETARIA_PROMPTS.greeting.replace('{{displayName}}', 'usuario'),
      };
    case 'help':
      return {
        toolName: 'help',
        data: null,
        formatted: SECRETARIA_PROMPTS.help,
      };
    case 'unknown':
    default:
      return {
        toolName: 'unknown',
        data: null,
        formatted: 'No entendi tu consulta. Escribi "ayuda" para ver lo que puedo hacer.',
      };
  }
}
