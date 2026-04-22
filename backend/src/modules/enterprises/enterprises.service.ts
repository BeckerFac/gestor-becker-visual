import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { generateAccessCode, ACCESS_CODE_MIN_LENGTH } from '../../utils/access-code';

// Nor feedback item 3: whitelist of accepted default_fiscal_type values.
// Sol = 'fiscal' (default); Luna = 'no_fiscal'. Anything else is a 400.
const VALID_DEFAULT_FISCAL_TYPES = ['fiscal', 'no_fiscal'] as const;

function normalizeDefaultFiscalType(value: unknown): 'fiscal' | 'no_fiscal' {
  if (value === undefined || value === null || value === '') return 'fiscal';
  if (typeof value !== 'string' || !(VALID_DEFAULT_FISCAL_TYPES as readonly string[]).includes(value)) {
    throw new ApiError(400, `default_fiscal_type invalido. Debe ser uno de: ${VALID_DEFAULT_FISCAL_TYPES.join(', ')}`);
  }
  return value as 'fiscal' | 'no_fiscal';
}

export class EnterprisesService {
  private tablesEnsured = false;

  async ensureTables() {
    if (this.tablesEnsured) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS enterprises (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          cuit VARCHAR(20),
          address TEXT,
          city VARCHAR(100),
          province VARCHAR(100),
          phone VARCHAR(20),
          email VARCHAR(100),
          tax_condition VARCHAR(50),
          notes TEXT,
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      // Add enterprise_id and role to customers
      await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`).catch(() => {});
      await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS role VARCHAR(100)`).catch(() => {});
      // Fase 1: razon_social, direccion fiscal, codigo postal
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS razon_social VARCHAR(255)`).catch(() => {});
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10)`).catch(() => {});
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS fiscal_address TEXT`).catch(() => {});
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS fiscal_city VARCHAR(100)`).catch(() => {});
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS fiscal_province VARCHAR(100)`).catch(() => {});
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS fiscal_postal_code VARCHAR(10)`).catch(() => {});
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS default_discount DECIMAL(5,2) DEFAULT 0`).catch(() => {});
      // Nor feedback item 3: default Sol/Luna circuit per enterprise.
      await db.execute(sql`ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS default_fiscal_type VARCHAR(20) DEFAULT 'fiscal'`).catch(() => {});
      this.tablesEnsured = true;
    } catch (error) {
      console.error('Ensure enterprises tables error:', error);
    }
  }

  async getEnterprises(companyId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT e.*,
          COALESCE((SELECT COUNT(*) FROM customers c WHERE c.enterprise_id = e.id), 0) as contact_count,
          COALESCE(
            (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM entity_tags et JOIN tags t ON et.tag_id = t.id
             WHERE et.entity_id = e.id AND et.entity_type = 'enterprise'),
            '[]'::json
          ) as tags
        FROM enterprises e
        WHERE e.company_id = ${companyId}
        ORDER BY e.name ASC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      throw new ApiError(500, 'Failed to get enterprises');
    }
  }

  async getEnterprise(companyId: string, enterpriseId: string) {
    await this.ensureTables();
    try {
      const result = await db.execute(sql`
        SELECT * FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Enterprise not found');

      // PR1-T6: scope contacts lookup by company_id for defense-in-depth.
      // Even though enterprise was validated by company_id above, customers
      // rows should never be fetched without the tenant filter.
      const contactsResult = await db.execute(sql`
        SELECT * FROM customers
        WHERE enterprise_id = ${enterpriseId} AND company_id = ${companyId}
        ORDER BY name ASC
      `);
      const contacts = (contactsResult as any).rows || contactsResult || [];

      return { ...rows[0], contacts };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get enterprise');
    }
  }

  async createEnterprise(companyId: string, data: any) {
    await this.ensureTables();
    try {
      // PR7-T14: normalizar CUIT al inicio para evitar inconsistencias de whitespace
      // (un "  " pasaba el trim-check pero fallaba regex; un "20-12345678-9" entraba con guiones).
      const cuitNormalized = (data.cuit || '').replace(/[-\s]/g, '').trim() || null;

      // Option B: AFIP fiscal data required only on create (updateEnterprise stays permissive)
      const missingFields: string[] = [];
      if (!data.name?.trim()) missingFields.push('nombre');
      if (!data.razon_social?.trim()) missingFields.push('razon social');
      if (!data.tax_condition?.trim()) missingFields.push('condicion IVA');

      const taxCond = (data.tax_condition || '').toLowerCase();
      const isConsumidorFinal = taxCond.includes('consumidor final');
      if (!isConsumidorFinal && !cuitNormalized) {
        missingFields.push('CUIT');
      }

      const hasFiscalAddress = data.fiscal_address?.trim() || data.address?.trim();
      if (!hasFiscalAddress) missingFields.push('direccion fiscal');

      if (cuitNormalized && !/^\d{11}$/.test(cuitNormalized)) {
        throw new ApiError(400, 'CUIT invalido. Debe tener 11 digitos.');
      }

      if (missingFields.length > 0) {
        throw new ApiError(400, `Faltan datos obligatorios para crear empresa: ${missingFields.join(', ')}. Son requeridos para facturar en AFIP.`);
      }

      if (cuitNormalized) {
        const existing = await db.execute(sql`
          SELECT id FROM enterprises WHERE company_id = ${companyId} AND cuit = ${cuitNormalized}
        `);
        const rows = (existing as any).rows || existing || [];
        if (rows.length > 0) throw new ApiError(409, 'Enterprise with this CUIT already exists');
      }

      // Nor feedback item 3: validate + default Sol/Luna circuit.
      // Throws 400 on unknown values; missing/empty -> 'fiscal'.
      const defaultFiscalType = normalizeDefaultFiscalType(data.default_fiscal_type);

      const enterpriseId = uuid();
      await db.execute(sql`
        INSERT INTO enterprises (id, company_id, name, razon_social, cuit, address, city, province, postal_code, fiscal_address, fiscal_city, fiscal_province, fiscal_postal_code, phone, email, tax_condition, notes, default_discount, default_fiscal_type)
        VALUES (${enterpriseId}, ${companyId}, ${data.name}, ${data.razon_social || null}, ${cuitNormalized}, ${data.address || null}, ${data.city || null}, ${data.province || null}, ${data.postal_code || null}, ${data.fiscal_address || null}, ${data.fiscal_city || null}, ${data.fiscal_province || null}, ${data.fiscal_postal_code || null}, ${data.phone || null}, ${data.email || null}, ${data.tax_condition || null}, ${data.notes || null}, ${data.default_discount || 0}, ${defaultFiscalType})
      `);

      const result = await db.execute(sql`SELECT * FROM enterprises WHERE id = ${enterpriseId}`);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create enterprise error:', error);
      throw new ApiError(500, 'Failed to create enterprise');
    }
  }

  async updateEnterprise(companyId: string, enterpriseId: string, data: any) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Enterprise not found');

      // Wave 2A-1 H12: MERGE semantics. Only UPDATE columns explicitly present
      // in the payload; never overwrite unsent fields with NULL. The previous
      // full-replace UPDATE destroyed razon_social/cuit/fiscal_address/etc. on
      // every partial PUT from the UI edit modal.
      const setClauses: string[] = [];
      const values: any[] = [];
      let i = 1;
      const push = (col: string, val: any) => {
        setClauses.push(`${col} = $${i++}`);
        values.push(val);
      };

      // Validate CUIT format if sending (empty string → null, valid 11-digit required otherwise).
      if ('cuit' in data) {
        const raw = typeof data.cuit === 'string' ? data.cuit : (data.cuit == null ? '' : String(data.cuit));
        const trimmed = raw.trim();
        if (trimmed === '') {
          push('cuit', null);
        } else {
          const cleanCuit = trimmed.replace(/[-\s]/g, '');
          if (!/^\d{11}$/.test(cleanCuit)) {
            throw new ApiError(400, 'CUIT invalido. Debe tener 11 digitos (XX-XXXXXXXX-X)');
          }
          push('cuit', trimmed);
        }
      }

      // Handle access_code update (can be set to null to revoke).
      if ('access_code' in data) {
        // HIGH-6: enforce minimum length; weak codes auto-upgrade to a strong one.
        let nextCode = data.access_code;
        if (nextCode !== null) {
          if (typeof nextCode !== 'string' || nextCode.length < ACCESS_CODE_MIN_LENGTH) {
            nextCode = generateAccessCode();
          }
        }
        push('access_code', nextCode);
      }

      if ('name' in data) push('name', data.name);
      if ('razon_social' in data) push('razon_social', data.razon_social || null);
      if ('address' in data) push('address', data.address || null);
      if ('city' in data) push('city', data.city || null);
      if ('province' in data) push('province', data.province || null);
      if ('postal_code' in data) push('postal_code', data.postal_code || null);
      if ('fiscal_address' in data) push('fiscal_address', data.fiscal_address || null);
      if ('fiscal_city' in data) push('fiscal_city', data.fiscal_city || null);
      if ('fiscal_province' in data) push('fiscal_province', data.fiscal_province || null);
      if ('fiscal_postal_code' in data) push('fiscal_postal_code', data.fiscal_postal_code || null);
      if ('phone' in data) push('phone', data.phone || null);
      if ('email' in data) push('email', data.email || null);
      if ('tax_condition' in data) push('tax_condition', data.tax_condition || null);
      if ('notes' in data) push('notes', data.notes || null);
      if ('default_discount' in data) push('default_discount', data.default_discount ?? 0);
      if ('default_fiscal_type' in data) {
        push('default_fiscal_type', normalizeDefaultFiscalType(data.default_fiscal_type));
      }

      if (setClauses.length > 0) {
        const idIdx = i++;
        const companyIdx = i++;
        values.push(enterpriseId, companyId);
        await pool.query(
          `UPDATE enterprises SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${idIdx} AND company_id = $${companyIdx}`,
          values
        );
      }

      const result = await db.execute(sql`SELECT * FROM enterprises WHERE id = ${enterpriseId}`);
      const updated = (result as any).rows || result || [];
      return updated[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update enterprise');
    }
  }

  async deleteEnterprise(companyId: string, enterpriseId: string) {
    await this.ensureTables();
    try {
      const check = await db.execute(sql`
        SELECT id FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);
      const rows = (check as any).rows || check || [];
      if (rows.length === 0) throw new ApiError(404, 'Enterprise not found');

      // Unlink customers first
      await db.execute(sql`UPDATE customers SET enterprise_id = NULL WHERE enterprise_id = ${enterpriseId}`);
      await db.execute(sql`DELETE FROM enterprises WHERE id = ${enterpriseId} AND company_id = ${companyId}`);
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete enterprise');
    }
  }
}

export const enterprisesService = new EnterprisesService();
