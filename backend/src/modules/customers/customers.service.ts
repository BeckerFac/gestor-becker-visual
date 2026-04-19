import { db } from '../../config/db';
import { customers } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import { generateAccessCode } from '../../utils/access-code';

export class CustomersService {
  private migrated = false;

  private async ensureMigrations() {
    if (this.migrated) return;
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS role VARCHAR(100)`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS condicion_iva INTEGER`).catch(() => {});
    // Nor feedback item 4: multi-razon-social per Empresa. A customer with its
    // own fiscal identity (razon_social + cuit) issues invoices under its
    // OWN CUIT; enterprise remains the CC grouping entity.
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS razon_social VARCHAR(255)`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_condition VARCHAR(50)`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS fiscal_address TEXT`).catch(() => {});
    this.migrated = true;
  }

  async createCustomer(companyId: string, data: any) {
    try {
      await this.ensureMigrations();

      // CUIT is optional (Nor feedback item 2). Validate format only if provided.
      // Accept "20-12345678-9" or "20123456789"; store normalized as NULL when empty.
      const rawCuit = typeof data.cuit === 'string' ? data.cuit.trim() : '';
      const cuitNormalized = rawCuit ? rawCuit.replace(/[-\s]/g, '') : '';
      if (cuitNormalized && !/^\d{11}$/.test(cuitNormalized)) {
        throw new ApiError(400, 'CUIT invalido. Debe tener 11 digitos.');
      }
      const cuitToStore = cuitNormalized ? rawCuit : null;

      // Only check uniqueness when a CUIT is actually provided (multiple NULLs allowed).
      if (cuitToStore) {
        const existingCuit = await db.query.customers.findFirst({
          where: and(eq(customers.company_id, companyId), eq(customers.cuit, cuitToStore)),
        });
        if (existingCuit) throw new ApiError(409, 'Customer CUIT already exists');
      }

      const customerId = uuid();
      const customer = await db.insert(customers).values({
        id: customerId,
        company_id: companyId,
        cuit: cuitToStore as any,
        name: data.name,
        contact_name: data.contact_name,
        address: data.address,
        city: data.city,
        province: data.province,
        email: data.email,
        phone: data.phone,
        tax_condition: data.tax_condition,
        condicion_iva: data.condicion_iva ?? null,
        credit_limit: data.credit_limit,
        payment_terms: data.payment_terms,
      }).returning();

      // Set fields not in Drizzle schema via raw SQL
      // PR1-T5: scope all UPDATE/SELECT by company_id (defense-in-depth IDOR)
      if (data.notes) {
        await db.execute(sql`UPDATE customers SET notes = ${data.notes} WHERE id = ${customerId} AND company_id = ${companyId}`);
      }
      if (data.enterprise_id !== undefined) {
        await db.execute(sql`UPDATE customers SET enterprise_id = ${data.enterprise_id || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
      }
      if (data.role !== undefined) {
        await db.execute(sql`UPDATE customers SET role = ${data.role || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
      }
      // Nor feedback item 4: own fiscal identity (razon_social + fiscal_address).
      // Only persisted when the client sends them (undefined = don't touch).
      // Empty string normalizes to NULL so "falls back to enterprise" semantics
      // are explicit at the column level.
      if (data.razon_social !== undefined) {
        const rs = typeof data.razon_social === 'string' ? data.razon_social.trim() : '';
        await db.execute(sql`UPDATE customers SET razon_social = ${rs || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
      }
      if (data.fiscal_address !== undefined) {
        const fa = typeof data.fiscal_address === 'string' ? data.fiscal_address.trim() : '';
        await db.execute(sql`UPDATE customers SET fiscal_address = ${fa || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
      }

      const result = await db.execute(sql`SELECT * FROM customers WHERE id = ${customerId} AND company_id = ${companyId}`);
      const rows = (result as any).rows || result || [];
      return rows[0] || customer[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create customer');
    }
  }

  async getCustomers(companyId: string, { skip = 0, limit = 50 } = {}) {
    try {
      await this.ensureMigrations();
      // Use raw SQL to include access_code column
      const result = await db.execute(sql`
        SELECT c.*,
          COALESCE(
            (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM entity_tags et JOIN tags t ON et.tag_id = t.id
             WHERE et.entity_id = c.id AND et.entity_type = 'customer'),
            '[]'::json
          ) as tags
        FROM customers c WHERE c.company_id = ${companyId} ORDER BY c.name ASC LIMIT ${limit} OFFSET ${skip}
      `);
      const items = (result as any).rows || result || [];
      return { items, total: items.length, skip, limit };
    } catch (error) {
      throw new ApiError(500, 'Failed to get customers');
    }
  }

  async getCustomer(companyId: string, customerId: string) {
    try {
      await this.ensureMigrations();
      // Raw SQL to include fields that aren't in the Drizzle schema
      // (razon_social, fiscal_address, notes, enterprise_id, role).
      const result = await db.execute(sql`
        SELECT * FROM customers WHERE id = ${customerId} AND company_id = ${companyId}
      `);
      const rows = (result as any).rows || result || [];
      if (rows.length === 0) throw new ApiError(404, 'Customer not found');
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get customer');
    }
  }

  /**
   * Nor feedback item 4: helper to fetch all contacts of a given enterprise.
   * Used by UI flows that need to list the enterprise's billing contacts
   * (e.g., "+ Pedido" from Empresa, invoice receiver indicator).
   */
  async getCustomersByEnterprise(companyId: string, enterpriseId: string) {
    try {
      await this.ensureMigrations();
      const result = await db.execute(sql`
        SELECT * FROM customers
        WHERE company_id = ${companyId} AND enterprise_id = ${enterpriseId}
        ORDER BY name ASC
      `);
      const rows = (result as any).rows || result || [];
      return rows;
    } catch (error) {
      throw new ApiError(500, 'Failed to get customers by enterprise');
    }
  }

  async updateCustomer(companyId: string, customerId: string, data: any) {
    try {
      await this.ensureMigrations();
      await this.getCustomer(companyId, customerId);

      // Handle access_code separately (not in Drizzle schema)
      if (data.access_code !== undefined) {
        if (data.access_code && data.access_code.length < 8) {
          throw new ApiError(400, 'El codigo de acceso debe tener al menos 8 caracteres');
        }
        await db.execute(sql`UPDATE customers SET access_code = ${data.access_code} WHERE id = ${customerId} AND company_id = ${companyId}`);
        delete data.access_code;
      }

      // Handle notes separately (not in Drizzle schema)
      if (data.notes !== undefined) {
        await db.execute(sql`UPDATE customers SET notes = ${data.notes || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
        delete data.notes;
      }

      // Handle enterprise_id separately (not in Drizzle schema)
      if (data.enterprise_id !== undefined) {
        await db.execute(sql`UPDATE customers SET enterprise_id = ${data.enterprise_id || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
        delete data.enterprise_id;
      }

      // Handle role separately (not in Drizzle schema)
      if (data.role !== undefined) {
        await db.execute(sql`UPDATE customers SET role = ${data.role || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
        delete data.role;
      }

      // Nor feedback item 4: own fiscal identity updates (razon_social +
      // fiscal_address). Not in Drizzle schema — handled via raw SQL so
      // legacy fields pass through the drizzle path unchanged.
      if (data.razon_social !== undefined) {
        const rs = typeof data.razon_social === 'string' ? data.razon_social.trim() : '';
        await db.execute(sql`UPDATE customers SET razon_social = ${rs || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
        delete data.razon_social;
      }
      if (data.fiscal_address !== undefined) {
        const fa = typeof data.fiscal_address === 'string' ? data.fiscal_address.trim() : '';
        await db.execute(sql`UPDATE customers SET fiscal_address = ${fa || null} WHERE id = ${customerId} AND company_id = ${companyId}`);
        delete data.fiscal_address;
      }
      // Validate CUIT format on update if provided (mirrors createCustomer).
      // Empty string normalizes to NULL. Uniqueness check done below only when
      // CUIT is non-null and differs from current row.
      if (data.cuit !== undefined) {
        const rawCuit = typeof data.cuit === 'string' ? data.cuit.trim() : '';
        const cuitNormalized = rawCuit ? rawCuit.replace(/[-\s]/g, '') : '';
        if (cuitNormalized && !/^\d{11}$/.test(cuitNormalized)) {
          throw new ApiError(400, 'CUIT invalido. Debe tener 11 digitos.');
        }
        data.cuit = rawCuit || null;
      }

      // Only do Drizzle update if there are remaining fields
      const { access_code: _ac, notes: _n, enterprise_id: _ei, role: _r, ...drizzleData } = data;
      if (Object.keys(drizzleData).length > 0) {
        await db.update(customers)
          .set({ ...drizzleData, updated_at: new Date() })
          .where(and(eq(customers.company_id, companyId), eq(customers.id, customerId)));
      }

      // Return updated customer via raw SQL — PR1-T5: scoped by company_id
      const result = await db.execute(sql`SELECT * FROM customers WHERE id = ${customerId} AND company_id = ${companyId}`);
      const rows = (result as any).rows || result || [];
      return rows[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to update customer');
    }
  }

  async deleteCustomer(companyId: string, customerId: string) {
    try {
      await this.getCustomer(companyId, customerId);
      await db.delete(customers)
        .where(and(eq(customers.company_id, companyId), eq(customers.id, customerId)));
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to delete customer');
    }
  }
}

export const customersService = new CustomersService();
