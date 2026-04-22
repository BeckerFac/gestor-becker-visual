import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { activityService } from '../activity/activity.service';

// Default rates when padron entry has no specific rate
const DEFAULT_RATES: Record<string, number> = {
  iibb: 3.0,       // 3% default IIBB
  ganancias: 2.0,  // 2% default Ganancias
  iva: 10.5,       // 10.5% default IVA withholding
  suss: 2.0,       // 2% default SUSS
};

/**
 * Minimum non-taxable base (minimo no imponible) per retention type.
 * AFIP / ARBA / AGIP review these amounts frequently; the values below are
 * reasonable approximations for 2026 but MUST be revisited each period.
 *
 * FOLLOW-UP: replace with a `retention_thresholds` table keyed by
 * (type, jurisdiction, valid_from, valid_to) so finance can update without
 * redeploying. See H5.
 */
const MINIMUM_BASE: Record<string, number> = {
  ganancias: 60000,   // RG 830 - servicios (~$60k)
  suss: 108000,       // SUSS construccion (~$108k)
  // IIBB / IVA: no minimum by default (varies per regime & jurisdiccion).
  iibb: 0,
  iibb_caba: 0,
  iibb_pba: 0,
  iibb_otra: 0,
  iva: 0,
};

interface RetencionFilters {
  type?: string;
  enterprise_id?: string;
  period?: string;
  date_from?: string;
  date_to?: string;
  direction?: 'sufrida' | 'practicada';
  jurisdiction?: string;
  pago_id?: string;
  cobro_id?: string;
  purchase_invoice_id?: string;
  invoice_id?: string;
}

interface PadronEntry {
  source: string;
  cuit: string;
  regime?: string;
  rate?: number;
  valid_from?: string;
  valid_to?: string;
  jurisdiction?: string;
}

function getRows(result: any): any[] {
  return (result as any).rows || result || [];
}

export class RetencionesService {
  /**
   * Look up padron entry for a given CUIT, retention type, and jurisdiction.
   * Returns the applicable rate valid at `retentionDate` (defaults to today).
   *
   * H7 fix: back-dated retenciones must use the rate valid at the retention
   * date, not today. Otherwise a 2025-11-03 retencion loaded in 2026-04 picks
   * up 2026 rates — wrong per AFIP.
   */
  async lookupPadron(
    companyId: string,
    type: string,
    cuit: string,
    jurisdiction?: string | null,
    retentionDate?: string | null,
  ): Promise<{ rate: number; regime: string | null } | null> {
    const effectiveDate = (retentionDate || new Date().toISOString()).substring(0, 10);
    const jurisdictionFilter = jurisdiction
      ? sql`AND (jurisdiction IS NULL OR jurisdiction = ${jurisdiction})`
      : sql``;
    const result = await db.execute(sql`
      SELECT rate, regime FROM padron_retenciones
      WHERE company_id = ${companyId}
        AND cuit = ${cuit}
        AND source = ${type}
        ${jurisdictionFilter}
        AND (valid_from IS NULL OR valid_from <= ${effectiveDate}::date)
        AND (valid_to IS NULL OR valid_to >= ${effectiveDate}::date)
      ORDER BY valid_from DESC NULLS LAST, uploaded_at DESC
      LIMIT 1
    `);
    const rows = getRows(result);
    if (rows.length === 0) return null;
    return {
      rate: parseFloat(rows[0].rate) || DEFAULT_RATES[type] || 0,
      regime: rows[0].regime || null,
    };
  }

  /**
   * H8: Preview retention calculation. Used by UI before user confirms
   * creation. Returns rate, amount, and source (padron vs default).
   */
  async calculateRetention(params: {
    companyId: string;
    type: string;
    base_amount: number;
    jurisdiction?: string | null;
    cuit?: string | null;
    date?: string | null;
  }): Promise<{
    type: string;
    base_amount: number;
    rate: number;
    amount: number;
    source: 'padron' | 'default';
    regime: string | null;
    below_minimum: boolean;
    minimum_base: number;
  }> {
    const { companyId, type, base_amount, jurisdiction, cuit, date } = params;
    let padron: { rate: number; regime: string | null } | null = null;
    if (cuit) {
      padron = await this.lookupPadron(companyId, type, cuit, jurisdiction, date);
    }
    const rate = padron ? padron.rate : (DEFAULT_RATES[type] || 0);
    const amount = Math.round(base_amount * rate / 100 * 100) / 100;
    const minKey = jurisdiction ? `${type}_${jurisdiction}` : type;
    const minimum = MINIMUM_BASE[minKey] ?? MINIMUM_BASE[type] ?? 0;
    return {
      type,
      base_amount,
      rate,
      amount,
      source: padron ? 'padron' : 'default',
      regime: padron?.regime || null,
      below_minimum: base_amount < minimum,
      minimum_base: minimum,
    };
  }

  /**
   * Create a retention record.
   *
   * Fixes: H3 (duplicate detection), H4 (accepts purchase_invoice_id /
   * invoice_id), H5 (minimum threshold).
   */
  async createRetention(companyId: string, userId: string, data: {
    type: string;
    regime?: string;
    enterprise_id?: string;
    pago_id?: string;
    cobro_id?: string;
    purchase_invoice_id?: string;
    invoice_id?: string;
    base_amount: number;
    rate: number;
    amount: number;
    certificate_number?: string;
    date?: string;
    period?: string;
    direction?: 'practicada' | 'sufrida';
    jurisdiction?: 'caba' | 'pba' | 'otra' | string;
    notes?: string;
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

    if (data.type === 'iibb' && !data.jurisdiction) {
      throw new ApiError(400, 'Para retenciones IIBB debe especificar la jurisdiccion (caba, pba, otra)');
    }
    if (data.jurisdiction && !['caba', 'pba', 'otra'].includes(data.jurisdiction)) {
      throw new ApiError(400, `Jurisdiccion invalida: ${data.jurisdiction}. Use: caba, pba, otra`);
    }

    // H5: minimum non-taxable base check.
    const minKey = data.jurisdiction ? `${data.type}_${data.jurisdiction}` : data.type;
    const minimum = MINIMUM_BASE[minKey] ?? MINIMUM_BASE[data.type] ?? 0;
    if (minimum > 0 && data.base_amount < minimum) {
      throw new ApiError(
        400,
        `Base ${data.base_amount} menor al minimo no imponible ${minimum} para ${data.type}${data.jurisdiction ? '/' + data.jurisdiction : ''}`,
      );
    }

    const id = uuid();
    const retencionDate = data.date || new Date().toISOString();
    // Auto-generate period from date if not provided (YYYY-MM)
    const period = data.period || retencionDate.substring(0, 7);

    // H3: duplicate certificate_number per (company, type, period, jurisdiction).
    if (data.certificate_number && data.certificate_number.trim() !== '') {
      const dup = await db.execute(sql`
        SELECT id FROM retenciones
        WHERE company_id = ${companyId}
          AND type = ${data.type}
          AND period = ${period}
          AND COALESCE(jurisdiction, '') = ${data.jurisdiction || ''}
          AND certificate_number = ${data.certificate_number}
          AND (status IS NULL OR status != 'anulada')
      `);
      if (getRows(dup).length > 0) {
        throw new ApiError(
          409,
          `Certificado ${data.certificate_number} ya existe para ${data.type} periodo ${period}${data.jurisdiction ? ' (' + data.jurisdiction + ')' : ''}`,
        );
      }
    }

    try {
      await db.execute(sql`
        INSERT INTO retenciones (
          id, company_id, type, regime, enterprise_id,
          pago_id, cobro_id, purchase_invoice_id, invoice_id,
          base_amount, rate, amount,
          certificate_number, date, period, created_by,
          direction, jurisdiction, status
        )
        VALUES (
          ${id}, ${companyId}, ${data.type}, ${data.regime || null}, ${data.enterprise_id || null},
          ${data.pago_id || null}, ${data.cobro_id || null}, ${data.purchase_invoice_id || null}, ${data.invoice_id || null},
          ${data.base_amount.toString()}, ${data.rate.toString()}, ${data.amount.toString()},
          ${data.certificate_number || null}, ${retencionDate}, ${period}, ${userId},
          ${data.direction || null}, ${data.jurisdiction || null}, 'activa'
        )
      `);

      const result = await db.execute(sql`
        SELECT r.*, e.name as enterprise_name
        FROM retenciones r
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        WHERE r.id = ${id}
      `);

      // Wave 2C audit.
      try {
        await activityService.log({
          companyId,
          userId,
          module: 'retenciones',
          action: 'create',
          entityType: 'retencion',
          entityId: id,
          circuit: null,
          metadata: {
            type: data.type,
            amount: data.amount,
            direction: data.direction,
            enterprise_id: data.enterprise_id,
          },
        });
      } catch (e) { console.error('[audit] failed:', e); }

      return getRows(result)[0];
    } catch (error: any) {
      // Catch DB-level unique constraint violation (defensive; app check above should catch it first).
      if (error?.code === '23505' || /uq_retenciones_certificate/.test(error?.message || '')) {
        throw new ApiError(409, `Certificado ${data.certificate_number} ya existe (violacion unique DB)`);
      }
      console.error('Create retencion error:', error);
      throw new ApiError(500, 'Error al crear la retencion');
    }
  }

  /**
   * H8: retenciones are immutable. Updates are explicitly rejected; to fix a
   * wrong retencion, anular the original and create a new one. This preserves
   * the audit trail required by AFIP.
   */
  async updateRetention(): Promise<never> {
    throw new ApiError(
      405,
      'Las retenciones son inmutables una vez creadas. Para corregir, anule la retencion y cree una nueva.',
    );
  }

  /**
   * List retentions with optional filters.
   *
   * H1/H2: supports direction, jurisdiction, pago_id, cobro_id,
   * purchase_invoice_id, invoice_id filters.
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
      if (filters.direction) {
        whereClause = sql`${whereClause} AND r.direction = ${filters.direction}`;
      }
      if (filters.jurisdiction) {
        whereClause = sql`${whereClause} AND r.jurisdiction = ${filters.jurisdiction}`;
      }
      if (filters.pago_id) {
        whereClause = sql`${whereClause} AND r.pago_id = ${filters.pago_id}`;
      }
      if (filters.cobro_id) {
        whereClause = sql`${whereClause} AND r.cobro_id = ${filters.cobro_id}`;
      }
      if (filters.purchase_invoice_id) {
        whereClause = sql`${whereClause} AND r.purchase_invoice_id = ${filters.purchase_invoice_id}`;
      }
      if (filters.invoice_id) {
        whereClause = sql`${whereClause} AND r.invoice_id = ${filters.invoice_id}`;
      }

      const result = await db.execute(sql`
        SELECT r.*, e.name as enterprise_name
        FROM retenciones r
        LEFT JOIN enterprises e ON r.enterprise_id = e.id
        WHERE ${whereClause}
        ORDER BY r.date DESC
      `);
      return getRows(result);
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
      let whereClause = sql`company_id = ${companyId} AND (status IS NULL OR status != 'anulada')`;
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
      const rows = getRows(result);

      const totalResult = await db.execute(sql`
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(CAST(amount AS decimal)), 0) as total_amount
        FROM retenciones
        WHERE ${whereClause}
      `);
      const totalRows = getRows(totalResult);

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
   * H6: Soft-delete a retention with audit trail.
   *
   * Guards:
   *  - Mandatory reason (>= 5 chars) for fiscal traceability.
   *  - Cannot delete if linked to an active (non-anulado) pago / cobro —
   *    user must anular the pago/cobro first (cascada correcta).
   *
   * Does not hard-DELETE: marks status='anulada' with anulled_{at,by,reason}.
   * This preserves the record for AFIP audits.
   */
  async deleteRetention(companyId: string, retencionId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new ApiError(400, 'Motivo de anulacion obligatorio (minimo 5 caracteres)');
    }

    const ret = await db.execute(sql`
      SELECT r.*, p.status as pago_status, c.status as cobro_status
      FROM retenciones r
      LEFT JOIN pagos p ON p.id = r.pago_id
      LEFT JOIN cobros c ON c.id = r.cobro_id
      WHERE r.id = ${retencionId} AND r.company_id = ${companyId}
    `);
    const row = getRows(ret)[0];
    if (!row) {
      throw new ApiError(404, 'Retencion no encontrada');
    }
    if (row.status === 'anulada') {
      throw new ApiError(409, 'La retencion ya esta anulada');
    }
    if (row.pago_id && row.pago_status && row.pago_status !== 'anulado') {
      throw new ApiError(
        409,
        'No se puede eliminar: retencion vinculada a pago activo. Anule el pago primero.',
      );
    }
    if (row.cobro_id && row.cobro_status && row.cobro_status !== 'anulado') {
      throw new ApiError(
        409,
        'No se puede eliminar: retencion vinculada a cobro activo. Anule el cobro primero.',
      );
    }

    await db.execute(sql`
      UPDATE retenciones SET
        status = 'anulada',
        anulled_at = NOW(),
        anulled_by = ${userId},
        anulled_reason = ${reason.trim()}
      WHERE id = ${retencionId} AND company_id = ${companyId}
    `);

    // FOLLOW-UP: recalculateInvoicePaymentStatus/recalculatePurchaseInvoiceStatus
    // in cobros/pagos services should also filter retenciones by
    // status != 'anulada' so that soft-deleted retenciones stop contributing
    // to applied totals. Currently they only filter by cobro/pago status —
    // this works for the common case (anular cobro cascades), but an
    // orphan retencion anulada would still count. See follow-up list.

    // Wave 2C audit.
    try {
      await activityService.log({
        companyId,
        userId,
        module: 'retenciones',
        action: 'anular',
        entityType: 'retencion',
        entityId: retencionId,
        circuit: null,
        metadata: { reason: reason.trim() },
      });
    } catch (e) { console.error('[audit] failed:', e); }

    return { success: true, id: retencionId, status: 'anulada' };
  }

  /**
   * Auto-calculate retentions for a pago.
   * Looks up the enterprise CUIT in padron for all retention types.
   * Returns array of calculated retentions (not yet persisted).
   */
  async calculateRetentionsForPago(
    companyId: string,
    enterpriseId: string,
    pagoAmount: number,
    pagoDate?: string,
  ): Promise<Array<{
    type: string;
    regime: string | null;
    rate: number;
    amount: number;
    found_in_padron: boolean;
  }>> {
    const entResult = await db.execute(sql`
      SELECT cuit FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
    `);
    const entRows = getRows(entResult);
    if (entRows.length === 0 || !entRows[0].cuit) {
      return [];
    }
    const cuit = entRows[0].cuit;

    const retentions = [];
    const types = ['iibb', 'ganancias', 'iva', 'suss'];

    for (const type of types) {
      const padron = await this.lookupPadron(companyId, type, cuit, null, pagoDate);
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

    const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }

    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return trimmed;

    return undefined;
  }
}

export const retencionesService = new RetencionesService();
