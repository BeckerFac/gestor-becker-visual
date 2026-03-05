import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

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
          COALESCE((SELECT COUNT(*) FROM customers c WHERE c.enterprise_id = e.id), 0) as contact_count
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

      const contactsResult = await db.execute(sql`
        SELECT * FROM customers WHERE enterprise_id = ${enterpriseId} ORDER BY name ASC
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
      if (data.cuit) {
        const existing = await db.execute(sql`
          SELECT id FROM enterprises WHERE company_id = ${companyId} AND cuit = ${data.cuit}
        `);
        const rows = (existing as any).rows || existing || [];
        if (rows.length > 0) throw new ApiError(409, 'Enterprise with this CUIT already exists');
      }

      const enterpriseId = uuid();
      await db.execute(sql`
        INSERT INTO enterprises (id, company_id, name, cuit, address, city, province, phone, email, tax_condition, notes)
        VALUES (${enterpriseId}, ${companyId}, ${data.name}, ${data.cuit || null}, ${data.address || null}, ${data.city || null}, ${data.province || null}, ${data.phone || null}, ${data.email || null}, ${data.tax_condition || null}, ${data.notes || null})
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

      await db.execute(sql`
        UPDATE enterprises SET
          name = ${data.name},
          cuit = ${data.cuit || null},
          address = ${data.address || null},
          city = ${data.city || null},
          province = ${data.province || null},
          phone = ${data.phone || null},
          email = ${data.email || null},
          tax_condition = ${data.tax_condition || null},
          notes = ${data.notes || null},
          updated_at = NOW()
        WHERE id = ${enterpriseId} AND company_id = ${companyId}
      `);

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
