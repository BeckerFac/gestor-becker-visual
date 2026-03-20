import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class ReceiptsService {
  private migrationsRun = false;

  async ensureMigrations() {
    if (this.migrationsRun) return;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          receipt_number INTEGER NOT NULL,
          receipt_date TIMESTAMP WITH TIME ZONE NOT NULL,
          total_amount DECIMAL(12,2) NOT NULL,
          payment_method VARCHAR(50),
          notes TEXT,
          created_by UUID REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS receipt_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
          invoice_id UUID NOT NULL REFERENCES invoices(id),
          amount DECIMAL(12,2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      // Add new columns for simple receipts (without invoices)
      await db.execute(sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id)`);
      await db.execute(sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES banks(id)`);
      await db.execute(sql`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reference VARCHAR(255)`);
      // Add cobro_id to cheques table for linking
      await db.execute(sql`ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cobro_id UUID REFERENCES cobros(id)`);

      // Add migrated_to_receipt column to cobros table
      await db.execute(sql`ALTER TABLE cobros ADD COLUMN IF NOT EXISTS migrated_to_receipt BOOLEAN DEFAULT false`);

      // Migrate old cobros that don't have a corresponding receipt
      await this.migrateOldCobros();

      this.migrationsRun = true;
    } catch (error) {
      console.error('Receipts migrations error:', error);
    }
  }

  private async migrateOldCobros() {
    try {
      // Check if migration already ran (any cobro already marked as migrated)
      const checkMigration = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM cobros WHERE migrated_to_receipt = true
      `);
      const alreadyMigrated = parseInt(((checkMigration as any).rows || checkMigration)?.[0]?.cnt || '0');

      // Also check if there are any unmigrated cobros without a receipt reference
      const unmigrated = await db.execute(sql`
        SELECT c.id, c.company_id, c.enterprise_id, c.amount, c.payment_method,
          c.bank_id, c.reference, c.payment_date, c.notes, c.created_by
        FROM cobros c
        WHERE c.migrated_to_receipt = false
          AND c.reference NOT LIKE 'Recibo #%'
      `);
      const unmigratedRows = (unmigrated as any).rows || unmigrated || [];

      if (unmigratedRows.length === 0) return;

      // Group by company_id for receipt_number generation
      const byCompany: Record<string, any[]> = {};
      for (const cobro of unmigratedRows) {
        const cid = cobro.company_id;
        if (!byCompany[cid]) byCompany[cid] = [];
        byCompany[cid].push(cobro);
      }

      for (const [companyId, cobros] of Object.entries(byCompany)) {
        // Get current max receipt number for this company
        const maxResult = await db.execute(sql`
          SELECT COALESCE(MAX(receipt_number), 0) as max_num
          FROM receipts WHERE company_id = ${companyId}
        `);
        let nextNumber = parseInt(((maxResult as any).rows || maxResult)?.[0]?.max_num || '0') + 1;

        for (const cobro of cobros) {
          const receiptId = uuid();
          await db.execute(sql`BEGIN`);
          try {
            await db.execute(sql`
              INSERT INTO receipts (id, company_id, receipt_number, receipt_date, total_amount, payment_method, notes, enterprise_id, bank_id, reference, created_by, created_at)
              VALUES (${receiptId}, ${companyId}, ${nextNumber}, ${cobro.payment_date || new Date().toISOString()}, ${cobro.amount}, ${cobro.payment_method || null}, ${cobro.notes || null}, ${cobro.enterprise_id || null}, ${cobro.bank_id || null}, ${cobro.reference || null}, ${cobro.created_by || null}, NOW())
            `);

            await db.execute(sql`
              UPDATE cobros SET migrated_to_receipt = true WHERE id = ${cobro.id}
            `);

            await db.execute(sql`COMMIT`);
            nextNumber++;
          } catch (txErr) {
            await db.execute(sql`ROLLBACK`);
            console.error(`Failed to migrate cobro ${cobro.id}:`, txErr);
          }
        }
      }

      console.log(`Migrated ${unmigratedRows.length} old cobros to receipts`);
    } catch (error) {
      console.error('Cobros migration error (non-fatal):', error);
    }
  }

  async getReceipts(companyId: string) {
    await this.ensureMigrations();
    try {
      const result = await db.execute(sql`
        SELECT r.*,
          ent.name as enterprise_name,
          b.bank_name,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'id', ri.id,
              'invoice_id', ri.invoice_id,
              'amount', ri.amount,
              'invoice_number', i.invoice_number,
              'invoice_type', i.invoice_type,
              'invoice_total', i.total_amount,
              'fiscal_type', i.fiscal_type,
              'enterprise_name', COALESCE(e.name, ''),
              'customer_name', COALESCE(c.name, 'Consumidor Final')
            ) ORDER BY ri.created_at)
            FROM receipt_items ri
            JOIN invoices i ON ri.invoice_id = i.id
            LEFT JOIN enterprises e ON i.enterprise_id = e.id
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE ri.receipt_id = r.id),
            '[]'::json
          ) as items
        FROM receipts r
        LEFT JOIN enterprises ent ON r.enterprise_id = ent.id
        LEFT JOIN banks b ON r.bank_id = b.id
        WHERE r.company_id = ${companyId}
        ORDER BY r.created_at DESC
      `);
      return (result as any).rows || result || [];
    } catch (error) {
      console.error('Get receipts error:', error);
      throw new ApiError(500, 'Failed to get receipts');
    }
  }

  async createReceipt(companyId: string, userId: string, data: any) {
    await this.ensureMigrations();
    try {
      const { receipt_date, payment_method, notes, items, order_items, enterprise_id, amount, bank_id, reference, cheque_data } = data;

      const hasItems = Array.isArray(items) && items.length > 0;
      const hasOrderItems = Array.isArray(order_items) && order_items.length > 0;

      // Validate: either items with invoices, order_items, OR a direct amount
      if (!hasItems && !hasOrderItems) {
        if (!amount || parseFloat(amount) <= 0) {
          throw new ApiError(400, 'El recibo debe tener un monto mayor a 0');
        }
      }
      if (hasItems) {
        for (const item of items) {
          if (!item.invoice_id) throw new ApiError(400, 'Cada item debe tener una factura asociada');
          if (!item.amount || parseFloat(item.amount) <= 0) throw new ApiError(400, 'Cada item debe tener un monto mayor a 0');
        }
      }
      if (hasOrderItems) {
        for (const item of order_items) {
          if (!item.order_id) throw new ApiError(400, 'Cada item de pedido debe tener un pedido asociado');
          if (!item.amount || parseFloat(item.amount) <= 0) throw new ApiError(400, 'Cada item de pedido debe tener un monto mayor a 0');
        }
      }

      // Auto-generate receipt_number
      const maxResult = await db.execute(sql`
        SELECT COALESCE(MAX(receipt_number), 0) + 1 as next_number
        FROM receipts WHERE company_id = ${companyId}
      `);
      const rows = (maxResult as any).rows || maxResult || [];
      const receiptNumber = parseInt(rows[0]?.next_number || '1');

      // Calculate total: from items if present, otherwise from direct amount
      const invoiceItemsTotal = hasItems
        ? items.reduce((sum: number, item: any) => sum + parseFloat(item.amount), 0)
        : 0;
      const orderItemsTotal = hasOrderItems
        ? order_items.reduce((sum: number, item: any) => sum + parseFloat(item.amount), 0)
        : 0;
      const totalAmount = (hasItems || hasOrderItems)
        ? invoiceItemsTotal + orderItemsTotal
        : parseFloat(amount);

      const receiptId = uuid();

      // Transaction: all inserts succeed or all rollback
      await db.execute(sql`BEGIN`);
      try {
        await db.execute(sql`
          INSERT INTO receipts (id, company_id, receipt_number, receipt_date, total_amount, payment_method, notes, enterprise_id, bank_id, reference, created_by, created_at)
          VALUES (${receiptId}, ${companyId}, ${receiptNumber}, ${receipt_date || new Date().toISOString()}, ${totalAmount.toFixed(2)}, ${payment_method || null}, ${notes || null}, ${enterprise_id || null}, ${bank_id || null}, ${reference || null}, ${userId}, NOW())
        `);

        if (hasItems) {
          // Receipt with invoice items
          for (const item of items) {
            const itemId = uuid();
            await db.execute(sql`
              INSERT INTO receipt_items (id, receipt_id, invoice_id, amount, created_at)
              VALUES (${itemId}, ${receiptId}, ${item.invoice_id}, ${parseFloat(item.amount).toFixed(2)}, NOW())
            `);

            const cobroId = uuid();
            const invResult = await db.execute(sql`
              SELECT enterprise_id, order_id FROM invoices WHERE id = ${item.invoice_id}
            `);
            const invRows = (invResult as any).rows || invResult || [];
            const invEnterpriseId = invRows[0]?.enterprise_id || null;
            const orderId = invRows[0]?.order_id || null;

            await db.execute(sql`
              INSERT INTO cobros (id, company_id, enterprise_id, order_id, invoice_id, amount, payment_method, reference, payment_date, notes, created_by, created_at)
              VALUES (${cobroId}, ${companyId}, ${invEnterpriseId}, ${orderId}, ${item.invoice_id}, ${parseFloat(item.amount).toFixed(2)}, ${payment_method || 'efectivo'}, ${`Recibo #${receiptNumber}`}, ${receipt_date || new Date().toISOString()}, ${notes || null}, ${userId}, NOW())
            `);
          }
        }
        if (hasOrderItems) {
          // Receipt with order items (pedidos sin facturar)
          for (const item of order_items) {
            const cobroId = uuid();
            // Get enterprise_id from the order
            const orderResult = await db.execute(sql`
              SELECT o.id, COALESCE(e.id, c2.enterprise_id) as enterprise_id
              FROM orders o
              LEFT JOIN enterprises e ON o.enterprise_id = e.id
              LEFT JOIN customers c2 ON o.customer_id = c2.id
              WHERE o.id = ${item.order_id}
            `);
            const orderRows = (orderResult as any).rows || orderResult || [];
            const orderEnterpriseId = orderRows[0]?.enterprise_id || enterprise_id || null;

            await db.execute(sql`
              INSERT INTO cobros (id, company_id, enterprise_id, order_id, amount, payment_method, bank_id, reference, payment_date, notes, created_by, created_at)
              VALUES (${cobroId}, ${companyId}, ${orderEnterpriseId}, ${item.order_id}, ${parseFloat(item.amount).toFixed(2)}, ${payment_method || 'efectivo'}, ${bank_id || null}, ${`Recibo #${receiptNumber}`}, ${receipt_date || new Date().toISOString()}, ${notes || null}, ${userId}, NOW())
            `);

            // Recalculate payment status for linked order
            const { cobrosService } = await import('../cobros/cobros.service');
            await cobrosService.recalculateOrderPaymentStatus(item.order_id);
          }
        }

        if (!hasItems && !hasOrderItems) {
          // Simple receipt without invoices or orders - create a single cobro
          const cobroId = uuid();
          await db.execute(sql`
            INSERT INTO cobros (id, company_id, enterprise_id, amount, payment_method, bank_id, reference, payment_date, notes, created_by, created_at)
            VALUES (${cobroId}, ${companyId}, ${enterprise_id || null}, ${totalAmount.toFixed(2)}, ${payment_method || 'efectivo'}, ${bank_id || null}, ${reference || `Recibo #${receiptNumber}`}, ${receipt_date || new Date().toISOString()}, ${notes || null}, ${userId}, NOW())
          `);

          // If cheque_data is provided, create a cheque linked to this cobro
          if (cheque_data && payment_method === 'cheque') {
            const chequeId = uuid();
            await db.execute(sql`
              INSERT INTO cheques (id, company_id, number, bank, drawer, drawer_cuit, cheque_type, amount, issue_date, due_date, status, cobro_id, notes, created_by)
              VALUES (
                ${chequeId},
                ${companyId},
                ${cheque_data.number},
                ${cheque_data.bank},
                ${cheque_data.drawer},
                ${cheque_data.drawer_cuit || null},
                ${cheque_data.cheque_type || 'comun'},
                ${totalAmount.toFixed(2)},
                ${new Date(cheque_data.issue_date)},
                ${new Date(cheque_data.due_date)},
                'a_cobrar',
                ${cobroId},
                ${notes || null},
                ${userId}
              )
            `);
          }
        }

        await db.execute(sql`COMMIT`);
      } catch (txError) {
        await db.execute(sql`ROLLBACK`);
        throw txError;
      }

      return { id: receiptId, receipt_number: receiptNumber, total_amount: totalAmount };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Create receipt error:', error);
      throw new ApiError(500, 'Failed to create receipt');
    }
  }

  async deleteReceipt(companyId: string, receiptId: string) {
    await this.ensureMigrations();
    try {
      // Verify receipt exists
      const check = await db.execute(sql`
        SELECT id, receipt_number FROM receipts WHERE id = ${receiptId} AND company_id = ${companyId}
      `);
      const checkRows = (check as any).rows || check || [];
      if (checkRows.length === 0) throw new ApiError(404, 'Recibo no encontrado');

      const receiptNumber = checkRows[0].receipt_number;

      // Delete associated cobros: those linked via receipt_items (invoice-based)
      await db.execute(sql`
        DELETE FROM cobros WHERE company_id = ${companyId} AND reference = ${`Recibo #${receiptNumber}`}
          AND invoice_id IN (SELECT invoice_id FROM receipt_items WHERE receipt_id = ${receiptId})
      `);

      // Also delete cobros for simple receipts (no invoice_id, matched by reference)
      await db.execute(sql`
        DELETE FROM cobros WHERE company_id = ${companyId} AND reference = ${`Recibo #${receiptNumber}`}
          AND invoice_id IS NULL
      `);

      // Delete receipt items (cascade should handle it, but be explicit)
      await db.execute(sql`DELETE FROM receipt_items WHERE receipt_id = ${receiptId}`);

      // Delete receipt
      await db.execute(sql`DELETE FROM receipts WHERE id = ${receiptId} AND company_id = ${companyId}`);

      return { deleted: true };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Delete receipt error:', error);
      throw new ApiError(500, 'Failed to delete receipt');
    }
  }
}

export const receiptsService = new ReceiptsService();
