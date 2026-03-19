// Report Narratives Service
// Generates AI summaries for each report tab

import Anthropic from '@anthropic-ai/sdk';
import { AI_CONFIG, isAiConfigured } from './ai.config';
import { getCachedResponse, setCachedResponse } from './ai.cache';
import logger from '../../config/logger';

export type ReportType = 'ventas' | 'rentabilidad' | 'clientes' | 'cobranzas' | 'inventario' | 'conversion';

export interface NarrativeResponse {
  readonly narrative: string;
  readonly report_type: ReportType;
  readonly cached: boolean;
}

class NarrativesService {
  async generateNarrative(
    companyId: string,
    reportType: ReportType,
    reportData: Record<string, any>,
  ): Promise<NarrativeResponse> {
    if (!isAiConfigured()) {
      return {
        narrative: '',
        report_type: reportType,
        cached: false,
      };
    }

    // Cache key includes report type and date (changes daily)
    const cacheKey = `narrative_${reportType}_${new Date().toISOString().slice(0, 10)}_${JSON.stringify(reportData).length}`;
    const cached = getCachedResponse(companyId, cacheKey);
    if (cached) {
      return {
        narrative: cached,
        report_type: reportType,
        cached: true,
      };
    }

    // Build context based on report type
    const context = this.buildContext(reportType, reportData);

    if (!context) {
      return {
        narrative: '',
        report_type: reportType,
        cached: false,
      };
    }

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const response = await client.messages.create({
        model: AI_CONFIG.models.fast,
        max_tokens: AI_CONFIG.maxTokens.narrative,
        system: AI_CONFIG.systemPrompts.narrative,
        messages: [
          {
            role: 'user',
            content: `Tipo de reporte: ${this.getReportLabel(reportType)}

${context}

Generá un resumen ejecutivo de 2-3 oraciones.`,
          },
        ],
      });

      const narrative = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('');

      setCachedResponse(companyId, cacheKey, narrative);

      return {
        narrative,
        report_type: reportType,
        cached: false,
      };
    } catch (error: any) {
      logger.error({ error: error.message, reportType }, 'AI narrative generation error');
      return {
        narrative: '',
        report_type: reportType,
        cached: false,
      };
    }
  }

  private getReportLabel(type: ReportType): string {
    const labels: Record<ReportType, string> = {
      ventas: 'Reporte de Ventas',
      rentabilidad: 'Reporte de Rentabilidad',
      clientes: 'Reporte de Clientes',
      cobranzas: 'Reporte de Cobranzas',
      inventario: 'Reporte de Inventario',
      conversion: 'Reporte de Conversion',
    };
    return labels[type];
  }

  private buildContext(reportType: ReportType, data: Record<string, any>): string | null {
    // Sanitize: only send aggregated metrics, never PII
    try {
      switch (reportType) {
        case 'ventas':
          return this.buildVentasContext(data);
        case 'rentabilidad':
          return this.buildRentabilidadContext(data);
        case 'clientes':
          return this.buildClientesContext(data);
        case 'cobranzas':
          return this.buildCobranzasContext(data);
        case 'inventario':
          return this.buildInventarioContext(data);
        case 'conversion':
          return this.buildConversionContext(data);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private buildVentasContext(data: Record<string, any>): string {
    const s = data.summary || {};
    return `DATOS DE VENTAS:
- Total facturado: $${(s.total_facturado || 0).toLocaleString('es-AR')}
- Cantidad de pedidos: ${s.cantidad_pedidos || 0}
- Ticket promedio: $${(s.ticket_promedio || 0).toLocaleString('es-AR')}
- Delta vs periodo anterior: ${s.delta_facturado != null ? `${s.delta_facturado > 0 ? '+' : ''}${s.delta_facturado.toFixed(1)}%` : 'Sin datos previos'}
- Top producto: ${data.top_productos?.[0]?.nombre || 'N/A'} ($${(data.top_productos?.[0]?.total || 0).toLocaleString('es-AR')})`;
  }

  private buildRentabilidadContext(data: Record<string, any>): string {
    const s = data.summary || {};
    return `DATOS DE RENTABILIDAD:
- Revenue total: $${(s.total_revenue || 0).toLocaleString('es-AR')}
- Costo total: $${(s.total_cost || 0).toLocaleString('es-AR')}
- Ganancia bruta: $${(s.total_profit || 0).toLocaleString('es-AR')}
- Margen promedio: ${(s.avg_margin || 0).toFixed(1)}%
- Pedidos con margen bajo (<15%): ${s.low_margin_count || 0}`;
  }

  private buildClientesContext(data: Record<string, any>): string {
    const s = data.summary || {};
    return `DATOS DE CLIENTES:
- Total clientes activos: ${s.total_active || 0}
- Clientes nuevos (periodo): ${s.new_clients || 0}
- Revenue total de clientes: $${(s.total_revenue || 0).toLocaleString('es-AR')}
- Cliente top: ${data.top_clientes?.[0]?.nombre || 'N/A'} ($${(data.top_clientes?.[0]?.revenue || 0).toLocaleString('es-AR')})
- Clientes inactivos (>45 dias): ${s.inactive_count || 0}`;
  }

  private buildCobranzasContext(data: Record<string, any>): string {
    const s = data.summary || {};
    return `DATOS DE COBRANZAS:
- Total cobrado: $${(s.total_cobrado || 0).toLocaleString('es-AR')}
- Pendiente de cobro: $${(s.pendiente_cobro || 0).toLocaleString('es-AR')}
- DSO promedio: ${s.avg_dso || 0} dias
- Cobros vencidos: ${s.overdue_count || 0}
- Monto vencido: $${(s.overdue_amount || 0).toLocaleString('es-AR')}`;
  }

  private buildInventarioContext(data: Record<string, any>): string {
    const s = data.summary || {};
    return `DATOS DE INVENTARIO:
- Productos con control de stock: ${s.tracked_products || 0}
- Valor total del inventario: $${(s.total_value || 0).toLocaleString('es-AR')}
- Productos con stock bajo: ${s.low_stock_count || 0}
- Productos sin stock: ${s.zero_stock_count || 0}`;
  }

  private buildConversionContext(data: Record<string, any>): string {
    const s = data.summary || {};
    return `DATOS DE CONVERSION:
- Presupuestos enviados: ${s.quotes_sent || 0}
- Presupuestos convertidos: ${s.quotes_converted || 0}
- Tasa de conversion: ${(s.conversion_rate || 0).toFixed(1)}%
- Valor convertido: $${(s.converted_value || 0).toLocaleString('es-AR')}
- Valor perdido: $${(s.lost_value || 0).toLocaleString('es-AR')}`;
  }
}

export const narrativesService = new NarrativesService();
