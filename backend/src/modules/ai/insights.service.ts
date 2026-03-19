// Smart Insights Service - Proactive business intelligence
// Analyzes company data and generates actionable insights

import Anthropic from '@anthropic-ai/sdk';
import { AI_CONFIG, isAiConfigured } from './ai.config';
import { getCachedResponse, setCachedResponse } from './ai.cache';
import { pool } from '../../config/db';
import logger from '../../config/logger';

export interface SmartInsight {
  readonly id: string;
  readonly type: 'margin' | 'inactive_client' | 'payment_pattern' | 'sales_trend' | 'stock' | 'opportunity';
  readonly severity: 'critical' | 'warning' | 'info' | 'success';
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
  readonly action_label?: string;
  readonly action_link?: string;
}

class InsightsService {
  async generateInsights(companyId: string): Promise<SmartInsight[]> {
    if (!isAiConfigured()) {
      return [];
    }

    // Check cache first (insights are cached for 1 hour)
    const cacheKey = `insights_${new Date().toISOString().slice(0, 13)}`; // cache per hour
    const cached = getCachedResponse(companyId, cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, regenerate
      }
    }

    // Gather analysis data
    const analysisData = await this.gatherAnalysisData(companyId);

    // If there's barely any data, return basic insights without LLM
    if (analysisData.totalOrders < 5) {
      return this.getStarterInsights(analysisData);
    }

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const response = await client.messages.create({
        model: AI_CONFIG.models.fast,
        max_tokens: AI_CONFIG.maxTokens.insights,
        system: `${AI_CONFIG.systemPrompts.insights}

Respondé SOLO con un JSON array valido. Cada objeto tiene:
{
  "type": "margin" | "inactive_client" | "payment_pattern" | "sales_trend" | "stock" | "opportunity",
  "severity": "critical" | "warning" | "info" | "success",
  "title": "Titulo corto (max 60 chars)",
  "description": "Descripcion en 1-2 oraciones con datos concretos",
  "metric": "Valor clave (ej: '$120.000' o '-15%')" (opcional),
  "action_label": "Texto del boton de accion (ej: 'Ver pedidos')" (opcional),
  "action_link": "Ruta de la app (ej: '/orders')" (opcional)
}

Generá entre 2 y 5 insights, priorizando los mas urgentes.
SOLO JSON, sin texto adicional, sin markdown.`,
        messages: [
          {
            role: 'user',
            content: `Analizá estos datos y generá insights accionables:

${JSON.stringify(analysisData, null, 2)}`,
          },
        ],
      });

      const rawText = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('');

      // Parse JSON from response (handle potential markdown wrapping)
      const jsonStr = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const insights: SmartInsight[] = JSON.parse(jsonStr).map((item: any, idx: number) => ({
        id: `insight_${Date.now()}_${idx}`,
        type: item.type || 'info',
        severity: item.severity || 'info',
        title: String(item.title || '').slice(0, 100),
        description: String(item.description || '').slice(0, 300),
        metric: item.metric ? String(item.metric).slice(0, 50) : undefined,
        action_label: item.action_label ? String(item.action_label).slice(0, 50) : undefined,
        action_link: item.action_link ? String(item.action_link).slice(0, 100) : undefined,
      }));

      // Cache the result
      setCachedResponse(companyId, cacheKey, JSON.stringify(insights));

      return insights;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AI insights generation error');
      // Return rule-based insights as fallback
      return this.getRuleBasedInsights(analysisData);
    }
  }

  // Gather all analysis data (aggregated, no PII sent to LLM)
  private async gatherAnalysisData(companyId: string): Promise<Record<string, any>> {
    const [
      orderStats,
      marginData,
      inactiveClients,
      paymentPatterns,
      salesTrend,
      lowStock,
    ] = await Promise.all([
      this.getOrderStats(companyId),
      this.getMarginData(companyId),
      this.getInactiveClients(companyId),
      this.getPaymentPatterns(companyId),
      this.getSalesTrend(companyId),
      this.getLowStockItems(companyId),
    ]);

    return {
      totalOrders: orderStats.totalOrders,
      ...orderStats,
      marginData,
      inactiveClients,
      paymentPatterns,
      salesTrend,
      lowStock,
    };
  }

  private async getOrderStats(companyId: string): Promise<Record<string, any>> {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CAST(total_amount AS decimal)), 0) as total_revenue,
        COALESCE(AVG(CAST(total_amount AS decimal)), 0) as avg_order_value,
        COUNT(CASE WHEN payment_status = 'pendiente' THEN 1 END) as unpaid_count,
        COALESCE(SUM(CASE WHEN payment_status = 'pendiente' THEN CAST(total_amount AS decimal) ELSE 0 END), 0) as unpaid_amount,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as orders_last_30d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days' THEN 1 END) as orders_prev_30d
      FROM orders WHERE company_id = $1
    `, [companyId]);

    const row = result.rows[0] || {};
    return {
      totalOrders: parseInt(row.total_orders || '0'),
      totalRevenue: parseFloat(row.total_revenue || '0'),
      avgOrderValue: parseFloat(row.avg_order_value || '0'),
      unpaidCount: parseInt(row.unpaid_count || '0'),
      unpaidAmount: parseFloat(row.unpaid_amount || '0'),
      ordersLast30d: parseInt(row.orders_last_30d || '0'),
      ordersPrev30d: parseInt(row.orders_prev_30d || '0'),
    };
  }

  private async getMarginData(companyId: string): Promise<Record<string, any>> {
    const result = await pool.query(`
      SELECT
        COALESCE(AVG(
          CASE WHEN CAST(oi.unit_price AS decimal) > 0 THEN
            (CAST(oi.unit_price AS decimal) - COALESCE(CAST(oi.cost AS decimal), 0)) / CAST(oi.unit_price AS decimal) * 100
          ELSE 0 END
        ), 0) as avg_margin_pct,
        MIN(
          CASE WHEN CAST(oi.unit_price AS decimal) > 0 AND CAST(oi.cost AS decimal) > 0 THEN
            (CAST(oi.unit_price AS decimal) - CAST(oi.cost AS decimal)) / CAST(oi.unit_price AS decimal) * 100
          ELSE NULL END
        ) as min_margin_pct,
        COUNT(CASE WHEN CAST(oi.unit_price AS decimal) > 0 AND CAST(oi.cost AS decimal) > 0 AND
          (CAST(oi.unit_price AS decimal) - CAST(oi.cost AS decimal)) / CAST(oi.unit_price AS decimal) * 100 < 15 THEN 1 END
        ) as low_margin_items
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.company_id = $1 AND o.created_at >= NOW() - INTERVAL '90 days'
    `, [companyId]);

    const row = result.rows[0] || {};
    return {
      avgMarginPct: parseFloat(row.avg_margin_pct || '0'),
      minMarginPct: row.min_margin_pct != null ? parseFloat(row.min_margin_pct) : null,
      lowMarginItems: parseInt(row.low_margin_items || '0'),
    };
  }

  private async getInactiveClients(companyId: string): Promise<any[]> {
    const result = await pool.query(`
      SELECT
        COALESCE(e.name, c.name, 'Sin nombre') as client_name,
        MAX(o.created_at) as last_order,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as total_revenue,
        EXTRACT(DAY FROM NOW() - MAX(o.created_at)) as days_inactive
      FROM orders o
      LEFT JOIN enterprises e ON o.enterprise_id = e.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.company_id = $1
      GROUP BY COALESCE(e.name, c.name, 'Sin nombre')
      HAVING MAX(o.created_at) < NOW() - INTERVAL '45 days'
        AND COUNT(o.id) >= 3
      ORDER BY total_revenue DESC
      LIMIT 5
    `, [companyId]);

    return result.rows.map((r: any) => ({
      name: r.client_name,
      daysInactive: parseInt(r.days_inactive || '0'),
      totalOrders: parseInt(r.total_orders || '0'),
      revenue: parseFloat(r.total_revenue || '0'),
    }));
  }

  private async getPaymentPatterns(companyId: string): Promise<Record<string, any>> {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_overdue,
        COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as overdue_amount,
        COALESCE(AVG(EXTRACT(DAY FROM NOW() - o.created_at)), 0) as avg_days_unpaid
      FROM orders o
      WHERE o.company_id = $1
        AND o.payment_status = 'pendiente'
        AND o.created_at < NOW() - INTERVAL '15 days'
    `, [companyId]);

    const row = result.rows[0] || {};
    return {
      overdueCount: parseInt(row.total_overdue || '0'),
      overdueAmount: parseFloat(row.overdue_amount || '0'),
      avgDaysUnpaid: parseFloat(row.avg_days_unpaid || '0'),
    };
  }

  private async getSalesTrend(companyId: string): Promise<Record<string, any>> {
    const result = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
        COUNT(*) as order_count,
        COALESCE(SUM(CAST(total_amount AS decimal)), 0) as revenue
      FROM orders
      WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
      LIMIT 6
    `, [companyId]);

    return {
      monthly: result.rows.map((r: any) => ({
        month: r.month,
        orders: parseInt(r.order_count || '0'),
        revenue: parseFloat(r.revenue || '0'),
      })),
    };
  }

  private async getLowStockItems(companyId: string): Promise<any[]> {
    const result = await pool.query(`
      SELECT
        p.name as product_name,
        COALESCE(s.quantity, 0) as current_stock,
        COALESCE(p.low_stock_threshold, 0) as threshold
      FROM products p
      LEFT JOIN stock s ON s.product_id = p.id
      WHERE p.company_id = $1
        AND p.controls_stock = true
        AND COALESCE(s.quantity, 0) <= COALESCE(p.low_stock_threshold, 0)
        AND COALESCE(p.low_stock_threshold, 0) > 0
      ORDER BY COALESCE(s.quantity, 0) ASC
      LIMIT 5
    `, [companyId]);

    return result.rows.map((r: any) => ({
      name: r.product_name,
      stock: parseFloat(r.current_stock || '0'),
      threshold: parseFloat(r.threshold || '0'),
    }));
  }

  // Simple rule-based insights (no LLM needed, fallback)
  private getRuleBasedInsights(data: Record<string, any>): SmartInsight[] {
    const insights: SmartInsight[] = [];
    let id = 0;

    // Unpaid orders alert
    if (data.unpaidAmount > 0) {
      insights.push({
        id: `rule_${id++}`,
        type: 'payment_pattern',
        severity: data.unpaidAmount > data.totalRevenue * 0.3 ? 'critical' : 'warning',
        title: `$${Math.round(data.unpaidAmount).toLocaleString('es-AR')} pendientes de cobro`,
        description: `Hay ${data.unpaidCount} pedidos sin pagar. Priorizá el seguimiento de cobranzas.`,
        metric: `$${Math.round(data.unpaidAmount).toLocaleString('es-AR')}`,
        action_label: 'Ver cobros',
        action_link: '/cobros',
      });
    }

    // Low margin items
    if (data.marginData?.lowMarginItems > 0) {
      insights.push({
        id: `rule_${id++}`,
        type: 'margin',
        severity: 'warning',
        title: `${data.marginData.lowMarginItems} items con margen bajo (<15%)`,
        description: `Tu margen promedio es ${data.marginData.avgMarginPct.toFixed(1)}%. Revisá los precios de venta.`,
        metric: `${data.marginData.avgMarginPct.toFixed(1)}%`,
        action_label: 'Ver productos',
        action_link: '/products',
      });
    }

    // Inactive clients
    if (data.inactiveClients?.length > 0) {
      const top = data.inactiveClients[0];
      insights.push({
        id: `rule_${id++}`,
        type: 'inactive_client',
        severity: 'info',
        title: `${data.inactiveClients.length} clientes inactivos`,
        description: `${top.name} no compra hace ${top.daysInactive} dias (facturaba $${Math.round(top.revenue).toLocaleString('es-AR')}). Vale la pena contactarlos.`,
        action_label: 'Ver clientes',
        action_link: '/empresas',
      });
    }

    // Sales trend
    if (data.ordersLast30d > 0 && data.ordersPrev30d > 0) {
      const change = ((data.ordersLast30d - data.ordersPrev30d) / data.ordersPrev30d) * 100;
      if (Math.abs(change) > 10) {
        insights.push({
          id: `rule_${id++}`,
          type: 'sales_trend',
          severity: change > 0 ? 'success' : 'warning',
          title: change > 0 ? 'Ventas en crecimiento' : 'Caida en ventas',
          description: `Tus pedidos ${change > 0 ? 'subieron' : 'bajaron'} ${Math.abs(change).toFixed(0)}% vs el mes anterior (${data.ordersLast30d} vs ${data.ordersPrev30d}).`,
          metric: `${change > 0 ? '+' : ''}${change.toFixed(0)}%`,
          action_label: 'Ver reportes',
          action_link: '/reportes',
        });
      }
    }

    // Low stock
    if (data.lowStock?.length > 0) {
      insights.push({
        id: `rule_${id++}`,
        type: 'stock',
        severity: 'warning',
        title: `${data.lowStock.length} productos con stock bajo`,
        description: `${data.lowStock[0].name} tiene ${data.lowStock[0].stock} unidades (minimo: ${data.lowStock[0].threshold}). Considerá reabastecer.`,
        action_label: 'Ver inventario',
        action_link: '/inventory',
      });
    }

    return insights;
  }

  // For companies with very few orders
  private getStarterInsights(data: Record<string, any>): SmartInsight[] {
    const insights: SmartInsight[] = [];

    if (data.totalOrders === 0) {
      insights.push({
        id: 'starter_0',
        type: 'opportunity',
        severity: 'info',
        title: 'Creá tu primer pedido',
        description: 'Empezá cargando tu primer pedido para activar los insights inteligentes de GESTIA.',
        action_label: 'Nuevo pedido',
        action_link: '/orders',
      });
    } else {
      insights.push({
        id: 'starter_1',
        type: 'sales_trend',
        severity: 'info',
        title: `${data.totalOrders} pedidos registrados`,
        description: `Revenue total: $${Math.round(data.totalRevenue).toLocaleString('es-AR')}. Cargá mas pedidos para desbloquear insights avanzados.`,
        metric: `$${Math.round(data.totalRevenue).toLocaleString('es-AR')}`,
      });
    }

    return insights;
  }
}

export const insightsService = new InsightsService();
