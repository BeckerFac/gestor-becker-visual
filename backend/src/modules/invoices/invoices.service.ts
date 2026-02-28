import { db } from '../../config/db';
import { invoices, invoice_items, stock, stock_movements } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class InvoicesService {
  async createInvoice(companyId: string, userId: string, data: any) {
    try {
      const invoiceId = uuid();
      const invoice = await db.insert(invoices).values({
        id: invoiceId,
        company_id: companyId,
        customer_id: data.customer_id,
        invoice_type: data.invoice_type || 'B',
        invoice_number: Math.floor(Math.random() * 1000000),
        invoice_date: new Date(),
        subtotal: '0',
        vat_amount: '0',
        total_amount: '0',
        status: 'draft',
        created_by: userId,
      }).returning();

      // Add items
      if (data.items && Array.isArray(data.items)) {
        let subtotal = 0;
        let vatAmount = 0;

        for (const item of data.items) {
          const itemSubtotal = Number(item.unit_price) * Number(item.quantity);
          const itemVat = itemSubtotal * (Number(item.vat_rate) / 100);
          subtotal += itemSubtotal;
          vatAmount += itemVat;

          await db.insert(invoice_items).values({
            id: uuid(),
            invoice_id: invoiceId,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            vat_rate: item.vat_rate,
            subtotal: itemSubtotal.toString(),
          });
        }

        // Update invoice totals
        const total = subtotal + vatAmount;
        await db.update(invoices)
          .set({
            subtotal: subtotal.toString(),
            vat_amount: vatAmount.toString(),
            total_amount: total.toString(),
          })
          .where(eq(invoices.id, invoiceId));
      }

      return invoice[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to create invoice');
    }
  }

  async getInvoices(companyId: string, { skip = 0, limit = 50 } = {}) {
    try {
      const items = await db.select().from(invoices)
        .where(eq(invoices.company_id, companyId))
        .limit(limit)
        .offset(skip);
      return { items, total: items.length, skip, limit };
    } catch (error) {
      throw new ApiError(500, 'Failed to get invoices');
    }
  }

  async getInvoice(companyId: string, invoiceId: string) {
    try {
      const invoice = await db.query.invoices.findFirst({
        where: and(eq(invoices.company_id, companyId), eq(invoices.id, invoiceId)),
      });
      if (!invoice) throw new ApiError(404, 'Invoice not found');
      return invoice;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to get invoice');
    }
  }

  async authorizeInvoice(companyId: string, invoiceId: string) {
    try {
      const invoice = await this.getInvoice(companyId, invoiceId);
      if (invoice.status !== 'draft') throw new ApiError(400, 'Invoice cannot be authorized');

      // In real scenario: call AFIP WebService here
      const authorized = await db.update(invoices)
        .set({ status: 'authorized', cae: 'CAE123456789' })
        .where(eq(invoices.id, invoiceId))
        .returning();

      return authorized[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to authorize invoice');
    }
  }
}

export const invoicesService = new InvoicesService();
