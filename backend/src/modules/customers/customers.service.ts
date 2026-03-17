import { db } from '../../config/db';
import { customers } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';

function generateAccessCode(): string {
  return crypto.randomBytes(8).toString('hex'); // 16 char hex string
}

export class CustomersService {
  private migrated = false;

  private async ensureMigrations() {
    if (this.migrated) return;
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`).catch(() => {});
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS role VARCHAR(100)`).catch(() => {});
    this.migrated = true;
  }

  async createCustomer(companyId: string, data: any) {
    try {
      await this.ensureMigrations();
      const existingCuit = await db.query.customers.findFirst({
        where: and(eq(customers.company_id, companyId), eq(customers.cuit, data.cuit)),
      });
      if (existingCuit) throw new ApiError(409, 'Customer CUIT already exists');

      const customerId = uuid();
      const customer = await db.insert(customers).values({
        id: customerId,
        company_id: companyId,
        cuit: data.cuit,
        name: data.name,
        contact_name: data.contact_name,
        address: data.address,
        city: data.city,
        province: data.province,
        email: data.email,
        phone: data.phone,
        tax_condition: data.tax_condition,
        credit_limit: data.credit_limit,
        payment_terms: data.payment_terms,
      }).returning();

      // Set fields not in Drizzle schema via raw SQL
      if (data.notes) {
        await db.execute(sql`UPDATE customers SET notes = ${data.notes} WHERE id = ${customerId}`);
      }
      if (data.enterprise_id !== undefined) {
        await db.execute(sql`UPDATE customers SET enterprise_id = ${data.enterprise_id || null} WHERE id = ${customerId}`);
      }
      if (data.role !== undefined) {
        await db.execute(sql`UPDATE customers SET role = ${data.role || null} WHERE id = ${customerId}`);
      }

      const result = await db.execute(sql`SELECT * FROM customers WHERE id = ${customerId}`);
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
      const customer = await db.query.customers.findFirst({
        where: and(eq(customers.company_id, companyId), eq(customers.id, customerId)),
      });
      if (!customer) throw new ApiError(404, 'Customer not found');
      return customer;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get customer');
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

      // Only do Drizzle update if there are remaining fields
      const { access_code: _ac, notes: _n, enterprise_id: _ei, role: _r, ...drizzleData } = data;
      if (Object.keys(drizzleData).length > 0) {
        await db.update(customers)
          .set({ ...drizzleData, updated_at: new Date() })
          .where(and(eq(customers.company_id, companyId), eq(customers.id, customerId)));
      }

      // Return updated customer via raw SQL
      const result = await db.execute(sql`SELECT * FROM customers WHERE id = ${customerId}`);
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
