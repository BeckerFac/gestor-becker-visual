import { db } from '../../config/db';
import { customers } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class CustomersService {
  async createCustomer(companyId: string, data: any) {
    try {
      const existingCuit = await db.query.customers.findFirst({
        where: and(eq(customers.company_id, companyId), eq(customers.cuit, data.cuit)),
      });
      if (existingCuit) throw new ApiError(409, 'Customer CUIT already exists');

      const customer = await db.insert(customers).values({
        id: uuid(),
        company_id: companyId,
        cuit: data.cuit,
        name: data.name,
        contact_name: data.contact_name,
        address: data.address,
        email: data.email,
        phone: data.phone,
        credit_limit: data.credit_limit,
        payment_terms: data.payment_terms,
      }).returning();

      return customer[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create customer');
    }
  }

  async getCustomers(companyId: string, { skip = 0, limit = 50 } = {}) {
    try {
      const items = await db.select().from(customers)
        .where(eq(customers.company_id, companyId))
        .limit(limit)
        .offset(skip);
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
      const customer = await this.getCustomer(companyId, customerId);
      const updated = await db.update(customers)
        .set({ ...data, updated_at: new Date() })
        .where(and(eq(customers.company_id, companyId), eq(customers.id, customerId)))
        .returning();
      return updated[0];
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
