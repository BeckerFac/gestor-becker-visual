import { pool } from '../../config/db';
import { ApiError } from '../../middlewares/errorHandler';

export class BusinessUnitsService {
  async getBusinessUnits(companyId: string) {
    const result = await pool.query(
      `SELECT * FROM business_units
       WHERE company_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [companyId]
    );
    return result.rows;
  }

  async getBusinessUnit(companyId: string, buId: string) {
    const result = await pool.query(
      `SELECT * FROM business_units WHERE id = $1 AND company_id = $2`,
      [buId, companyId]
    );
    if (result.rows.length === 0) {
      throw new ApiError(404, 'Razón social no encontrada');
    }
    return result.rows[0];
  }

  async createBusinessUnit(companyId: string, userId: string, data: {
    name: string;
    is_fiscal?: boolean;
    cuit?: string;
    address?: string;
    iibb_number?: string;
    afip_start_date?: string;
    sort_order?: number;
  }) {
    if (!data.name || data.name.trim().length === 0) {
      throw new ApiError(400, 'El nombre de la razón social es requerido');
    }

    // Check for duplicate name within company
    const existing = await pool.query(
      `SELECT id FROM business_units WHERE company_id = $1 AND LOWER(name) = LOWER($2)`,
      [companyId, data.name.trim()]
    );
    if (existing.rows.length > 0) {
      throw new ApiError(409, 'Ya existe una razón social con ese nombre');
    }

    const result = await pool.query(
      `INSERT INTO business_units (company_id, name, is_fiscal, cuit, address, iibb_number, afip_start_date, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        companyId,
        data.name.trim(),
        data.is_fiscal ?? false,
        data.cuit || null,
        data.address || null,
        data.iibb_number || null,
        data.afip_start_date || null,
        data.sort_order ?? 0,
        userId,
      ]
    );
    return result.rows[0];
  }

  async updateBusinessUnit(companyId: string, buId: string, data: {
    name?: string;
    is_fiscal?: boolean;
    cuit?: string;
    address?: string;
    iibb_number?: string;
    afip_start_date?: string;
    sort_order?: number;
    active?: boolean;
  }) {
    // Verify exists
    await this.getBusinessUnit(companyId, buId);

    // Check duplicate name if changing
    if (data.name) {
      const existing = await pool.query(
        `SELECT id FROM business_units WHERE company_id = $1 AND LOWER(name) = LOWER($2) AND id != $3`,
        [companyId, data.name.trim(), buId]
      );
      if (existing.rows.length > 0) {
        throw new ApiError(409, 'Ya existe una razón social con ese nombre');
      }
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const fields: Record<string, any> = {
      name: data.name?.trim(),
      is_fiscal: data.is_fiscal,
      cuit: data.cuit,
      address: data.address,
      iibb_number: data.iibb_number,
      afip_start_date: data.afip_start_date,
      sort_order: data.sort_order,
      active: data.active,
    };

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      return this.getBusinessUnit(companyId, buId);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(buId, companyId);

    const result = await pool.query(
      `UPDATE business_units SET ${setClauses.join(', ')}
       WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1}
       RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async deleteBusinessUnit(companyId: string, buId: string) {
    // Check if has any associated data
    const tables = ['orders', 'purchases', 'invoices', 'cobros', 'pagos', 'cheques'];
    for (const table of tables) {
      try {
        const check = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM ${table} WHERE business_unit_id = $1) as has_data`,
          [buId]
        );
        if (check.rows[0].has_data) {
          throw new ApiError(409, `No se puede eliminar: tiene ${table} asociados. Desactivala en lugar de borrarla.`);
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // Table might not exist yet
      }
    }

    const result = await pool.query(
      `DELETE FROM business_units WHERE id = $1 AND company_id = $2 RETURNING id`,
      [buId, companyId]
    );
    if (result.rows.length === 0) {
      throw new ApiError(404, 'Razón social no encontrada');
    }
    return { deleted: true };
  }

  async getDefaultBusinessUnit(companyId: string) {
    const result = await pool.query(
      `SELECT * FROM business_units
       WHERE company_id = $1 AND active = true
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }
}

export const businessUnitsService = new BusinessUnitsService();
