import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

// Default rates when padron entry has no specific rate
const DEFAULT_RATES: Record<string, number> = {
  iibb: 3.0,       // 3% default IIBB
  ganancias: 2.0,  // 2% default Ganancias
  iva: 10.5,       // 10.5% default IVA withholding
  suss: 2.0,       // 2% default SUSS
};

interface RetencionFilters {
  type?: string;
  enterprise_id?: string;
  period?: string;
  date_from?: string;
  date_to?: string;
}

interface PadronEntry {
  source: string;
  cuit: string;
  regime?: string;
  rate?: number;
  valid_from?: string;
  valid_to?: string;
}

export class RetencionesService {
  /**
   * Look up padron entry for a given CUIT and retention type.
   * Returns the applicable rate or null if not found.
   */
  async lookupPadron(companyId: string, cuit: string, type: string): Promise<{ rate: number; regime: string | null } | null> {
    const today = new Date().toISOString().split('T')[0];
    const result = await db.execute(sql`
      SELECT rate, regime FROM padron_retenciones
      WHERE company_id = ${companyId}
        AND cuit = ${cuit}
        AND source = ${type}
        AND (valid_from IS NULL OR valid_from <= ${today}::date)
        AND (valid_to IS NULL OR valid_to >= ${today}::date)
      ORDER BY uploaded_at DESC
      LIMIT 1
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) return null;
    return {
      rate: parseFloat(rows[0].rate) || DEFAULT_RATES[type] || 0,
      regime: rows[0].regime || null,
    };
  }

  /**
   * Calculate retention amount for a given base amount.
   * Looks up padron first, falls back to default rate.
   */
  async calculateRetention(
    companyId: string,
    enterpriseCuit: string,
    type: string,
    baseAmount: number
  ): Promise<{ rate: number; amount: number; regime: string | null; found_in_padron: boolean }> {
    const padron = await this.lookupPadron(companyId, enterpriseCuit, type);
    const rate = padron ? padron.rate : (DEFAULT_RATES[type] || 0);
    const amount = Math.round(baseAmount * rate / 100 * 100) / 100; // Round to 2 decimals
    return {
      rate,
      amount,
      regime: padron?.regime || null,
      found_in_padron: !!padron,
    };
  }

  /**
   * Create a retention record.
   */
  async createRetention(companyId: string, userId: string, data: {
    type: string;
    regime?: string;
    enterprise_id?: string;
    pago_id?: string;
    cobro_id?: string;
    base_amount: number;
    rate: number;
    amount: number;
    certificate_number?: string;
    date?: string;
    period?: string;
    direction?: 'practicada' | 'sufrida';
  }) {
    const validTypes = ['iibb', 'ganancias', 'iva', 'suss'];
    if (!validTypes.includes(data.type)) {
      throw new ApiError(400, `Tipo de retencion invalido. Tipos validos: ${validTypes.join(', ')}`);
    }
    if (!data.base_amount || data.base_amount <= 0) {
      throw new ApiError(400, 'El monto base debe ser mayor a 0');
    }
    if (data.rate === undefined || data.rate < 0) {
      throw new ApiError(400, 'La alicuota debe ser mayor o igual a 0');
    }

    const id = uuid();
    const retencionDate = data.date || new Date().toISOString();
    // Auto-generate period from date if not provided (YYYY-MM)
    const period = data.period || retencionDate.substring(0, 7);

    try {
      await db.execute(sql`
        INSERT INTO retenciones (id, company_id, type, regime, enterprise_id, pago_id, cobro_id, base_amount, rate, amount, certificate_number, date, period, created_by, direction)
        VALUES (
          ${id}, ${companyId}, ${data.type}, ${data.regime || null},
          ${data.enterprise_id || null}, ${data.pago_id || null}, ${data.cobro_id || null},
          ${data.base_amount.toString()}, ${data.rate.toString()}, ${data.amount.toString()},
          ${data.certificate_number || null}, ${retencionDate}, ${period}, ${userId}, ${data.direction || null}
        )
      `);

      const result = await db.execute(sql`
        SELECT r.*, e.name as enterprise_name
        FROM retenciones r
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        WHERE r.id = ${id}
      `);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      console.error('Create retencion error:', error);
      throw new ApiError(500, 'Error al crear la retencion');
    }
  }

  /**
   * List retentions with optional filters.
   */
  async getRetentions(companyId: string, filters: RetencionFilters = {}) {
    try {
      let whereClause = sql`r.company_id = ${companyId}`;
      if (filters.type) {
        whereClause = sql`${whereClause} AND r.type = ${filters.type}`;
      }
      if (filters.enterprise_id) {
        whereClause = sql`${whereClause} AND r.enterprise_id = ${filters.enterprise_id}`;
      }
      if (filters.period) {
        whereClause = sql`${whereClause} AND r.period = ${filters.period}`;
      }
      if (filters.date_from) {
        whereClause = sql`${whereClause} AND r.date >= ${filters.date_from}`;
      }
      if (filters.date_to) {
        whereClause = sql`${whereClause} AND r.date <= ${filters.date_to}`;
      }

      const result = await db.execute(sql`
        SELECT r.*, e.name as enterprise_name
        FROM retenciones r
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        WHERE ${whereClause}
        ORDER BY r.date DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get retenciones error:', error);
      throw new ApiError(500, 'Error al obtener retenciones');
    }
  }

  /**
   * Get summary grouped by type for a given period.
   */
  async getRetentionSummary(companyId: string, period?: string) {
    try {
      let whereClause = sql`company_id = ${companyId}`;
      if (period) {
        whereClause = sql`${whereClause} AND period = ${period}`;
      }

      const result = await db.execute(sql`
        SELECT
          type,
          COUNT(*) as count,
          COALESCE(SUM(CAST(base_amount AS decimal)), 0) as total_base,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total_amount
        FROM retenciones
        WHERE ${whereClause}
        GROUP BY type
        ORDER BY type
      `);
      const rows = (result as any).rows || result || [];

      // Also get grand totals
      const totalResult = await db.execute(sql`
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total_amount
        FROM retenciones
        WHERE ${whereClause}
      `);
      const totalRows = (totalResult as any).rows || totalResult || [];

      return {
        by_type: rows.map((r: any) => ({
          type: r.type,
          count: parseInt(r.count),
          total_base: parseFloat(r.total_base),
          total_amount: parseFloat(r.total_amount),
        })),
        total_count: parseInt(totalRows[0]?.count || '0'),
        total_amount: parseFloat(totalRows[0]?.total_amount || '0'),
      };
    } catch (error) {
      console.error('Get retention summary error:', error);
      throw new ApiError(500, 'Error al obtener resumen de retenciones');
    }
  }

  /**
   * Import padron entries from CSV data (ARCA/ARBA format).
   * Expected columns: cuit, regime, rate, valid_from, valid_to
   */
  async importPadron(companyId: string, source: string, csvData: string) {
    const validSources = ['iibb', 'ganancias', 'iva', 'suss', 'arba', 'arca'];
    if (!validSources.includes(source)) {
      throw new ApiError(400, `Fuente invalida. Fuentes validas: ${validSources.join(', ')}`);
    }

    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      throw new ApiError(400, 'El CSV debe tener al menos una fila de encabezado y una de datos');
    }

    // Parse header — normalize to lowercase and trim
    const header = lines[0].split(/[;,]/).map(h => h.trim().toLowerCase());
    const cuitIdx = header.findIndex(h => h === 'cuit' || h === 'cuit del sujeto' || h === 'nro_cuit');
    const regimeIdx = header.findIndex(h => h === 'regime' || h === 'regimen' || h === 'cod_regimen');
    const rateIdx = header.findIndex(h => h === 'rate' || h === 'alicuota' || h === 'porc_retencion' || h === 'porcentaje');
    const fromIdx = header.findIndex(h => h === 'valid_from' || h === 'vigencia_desde' || h === 'fecha_desde');
    const toIdx = header.findIndex(h => h === 'valid_to' || h === 'vigencia_hasta' || h === 'fecha_hasta');

    if (cuitIdx === -1) {
      throw new ApiError(400, 'No se encontro la columna CUIT en el CSV. Columnas esperadas: cuit, regimen, alicuota, vigencia_desde, vigencia_hasta');
    }

    const entries: PadronEntry[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(/[;,]/).map(c => c.trim());
      const cuit = cols[cuitIdx]?.replace(/[^0-9]/g, '');

      if (!cuit || cuit.length < 7) {
        errors.push(`Fila ${i + 1}: CUIT invalido "${cols[cuitIdx]}"`);
        continue;
      }

      entries.push({
        source,
        cuit,
        regime: regimeIdx >= 0 ? cols[regimeIdx] || undefined : undefined,
        rate: rateIdx >= 0 ? parseFloat(cols[rateIdx]?.replace(',', '.')) || undefined : undefined,
        valid_from: fromIdx >= 0 ? this.parseDate(cols[fromIdx]) : undefined,
        valid_to: toIdx >= 0 ? this.parseDate(cols[toIdx]) : undefined,
      });
    }

    if (entries.length === 0) {
      throw new ApiError(400, `No se encontraron registros validos en el CSV. Errores: ${errors.join('; ')}`);
    }

    // Upsert in batches
    let imported = 0;
    for (const entry of entries) {
      try {
        await db.execute(sql`
          INSERT INTO padron_retenciones (id, company_id, source, cuit, regime, rate, valid_from, valid_to)
          VALUES (${uuid()}, ${companyId}, ${entry.source}, ${entry.cuit}, ${entry.regime || null},
                  ${entry.rate !== undefined ? entry.rate.toString() : null},
                  ${entry.valid_from || null}, ${entry.valid_to || null})
          ON CONFLICT (company_id, source, cuit, regime)
          DO UPDATE SET rate = EXCLUDED.rate, valid_from = EXCLUDED.valid_from,
                        valid_to = EXCLUDED.valid_to, uploaded_at = NOW()
        `);
        imported++;
      } catch (err) {
        errors.push(`CUIT ${entry.cuit}: ${(err as any)?.message || 'error'}`);
      }
    }

    return {
      imported,
      total_rows: entries.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : [],
    };
  }

  /**
   * Delete a retention by id.
   */
  async deleteRetention(companyId: string, retencionId: string) {
    const check = await db.execute(sql`
      SELECT id FROM retenciones WHERE id = ${retencionId} AND company_id = ${companyId}
    `);
    const rows = (check as any).rows || check || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Retencion no encontrada');
    }

    await db.execute(sql`DELETE FROM retenciones WHERE id = ${retencionId} AND company_id = ${companyId}`);
    return { success: true };
  }

  /**
   * Auto-calculate retentions for a pago.
   * Looks up the enterprise CUIT in padron for all retention types.
   * Returns array of calculated retentions (not yet persisted).
   */
  async calculateRetentionsForPago(companyId: string, enterpriseId: string, pagoAmount: number): Promise<Array<{
    type: string;
    regime: string | null;
    rate: number;
    amount: number;
    found_in_padron: boolean;
  }>> {
    // Get enterprise CUIT
    const entResult = await db.execute(sql`
      SELECT cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
    `);
    const entRows = (entResult as any).rows || entResult || [];
    if (entRows.length === 0 || !entRows[0].cuit) {
      return []; // No CUIT, can't calculate retentions
    }
    const cuit = entRows[0].cuit;

    const retentions = [];
    const types = ['iibb', 'ganancias', 'iva', 'suss'];

    for (const type of types) {
      const padron = await this.lookupPadron(companyId, cuit, type);
      if (padron) {
        const amount = Math.round(pagoAmount * padron.rate / 100 * 100) / 100;
        if (amount > 0) {
          retentions.push({
            type,
            regime: padron.regime,
            rate: padron.rate,
            amount,
            found_in_padron: true,
          });
        }
      }
    }

    return retentions;
  }

  /**
   * Parse date from various formats (DD/MM/YYYY, YYYY-MM-DD, etc.)
   */
  private parseDate(dateStr: string | undefined): string | undefined {
    if (!dateStr) return undefined;
    const trimmed = dateStr.trim();
    if (!trimmed) return undefined;

    // Try DD/MM/YYYY
    const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }

    // Try YYYY-MM-DD (already ISO)
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return trimmed;

    return undefined;
  }
}

export const retencionesService = new RetencionesService();
