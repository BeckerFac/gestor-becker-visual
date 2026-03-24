import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { v4 as uuid } from 'uuid';

export class PurchaseInvoicesService {

  async getPurchaseInvoices(companyId: string, filters: {
    enterprise_id?: string;
    business_unit_id?: string;
    purchase_id?: string;
    payment_status?: string;
    status?: string;
  } = {}) {
    let whereClause = sql`pi.company_id = ${companyId}`;

    if (filters.business_unit_id) {
      whereClause = sql`${whereClause} AND pi.business_unit_id = ${filters.business_unit_id}`;
    }
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND pi.enterprise_id = ${filters.enterprise_id}`;
    }
    if (filters.purchase_id) {
      whereClause = sql`${whereClause} AND pi.purchase_id = ${filters.purchase_id}`;
    }
    if (filters.payment_status) {
      whereClause = sql`${whereClause} AND pi.payment_status = ${filters.payment_status}`;
    }
    if (filters.status) {
      whereClause = sql`${whereClause} AND pi.status = ${filters.status}`;
    }

    const result = await db.execute(sql`
      SELECT pi.*,
        e.name as enterprise_name,
        e.cuit as enterprise_cuit,
        p.purchase_number,
        bu.name as business_unit_name,
        pi.total_amount - COALESCE((
          SELECT SUM(CAST(pia.amount_applied AS decimal))
          FROM pago_invoice_applications pia
          WHERE pia.purchase_invoice_id = pi.id
        ), 0) as remaining_balance
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN business_units bu ON pi.business_unit_id = bu.id
      WHERE ${whereClause}
      ORDER BY pi.invoice_date DESC
    `);
    return (result as any).rows || [];
  }

  async getPurchaseInvoice(companyId: string, piId: string) {
    const result = await db.execute(sql`
      SELECT pi.*,
        e.name as enterprise_name,
        e.cuit as enterprise_cuit,
        p.purchase_number,
        bu.name as business_unit_name
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN business_units bu ON pi.business_unit_id = bu.id
      WHERE pi.id = ${piId} AND pi.company_id = ${companyId}
    `);
    const row = ((result as any).rows || [])[0];
    if (!row) throw new ApiError(404, 'Factura de compra no encontrada');
    return row;
  }

  async createPurchaseInvoice(companyId: string, userId: string, data: {
    business_unit_id: string;
    enterprise_id: string;
    purchase_id?: string;
    invoice_type: string;
    punto_venta?: string;
    invoice_number: string;
    invoice_date: string;
    cae?: string;
    cae_expiry_date?: string;
    subtotal?: number;
    vat_amount?: number;
    other_taxes?: number;
    total_amount: number;
    notes?: string;
    items?: Array<{ product_name: string; description?: string; quantity: number; unit_price: number }>;
  }) {
    if (!data.business_unit_id) throw new ApiError(400, 'Razon social requerida');
    if (!data.enterprise_id) throw new ApiError(400, 'Proveedor requerido');
    if (!data.invoice_type) throw new ApiError(400, 'Tipo de factura requerido');
    if (!data.invoice_number) throw new ApiError(400, 'Numero de factura requerido');
    if (!data.invoice_date) throw new ApiError(400, 'Fecha de factura requerida');
    if (!data.total_amount || data.total_amount <= 0) throw new ApiError(400, 'Monto total requerido');

    // Verify business_unit belongs to company
    const buCheck = await db.execute(sql`
      SELECT id FROM business_units WHERE id = ${data.business_unit_id} AND company_id = ${companyId}
    `);
    if (((buCheck as any).rows || []).length === 0) {
      throw new ApiError(400, 'Razon social no valida');
    }

    // Verify enterprise belongs to company
    const entCheck = await db.execute(sql`
      SELECT id FROM enterprises WHERE id = ${data.enterprise_id} AND company_id = ${companyId}
    `);
    if (((entCheck as any).rows || []).length === 0) {
      throw new ApiError(400, 'Proveedor no valido');
    }

    // Verify purchase if provided
    if (data.purchase_id) {
      const purchaseCheck = await db.execute(sql`
        SELECT id FROM purchases WHERE id = ${data.purchase_id} AND company_id = ${companyId}
      `);
      if (((purchaseCheck as any).rows || []).length === 0) {
        throw new ApiError(400, 'Compra no valida');
      }
    }

    const piId = uuid();
    const piCurrency = (data as any).currency || 'ARS';
    const piExchangeRate = (data as any).exchange_rate ? parseFloat((data as any).exchange_rate) : null;

    await db.execute(sql`
      INSERT INTO purchase_invoices (
        id, company_id, business_unit_id, enterprise_id, purchase_id,
        invoice_type, punto_venta, invoice_number, invoice_date,
        cae, cae_expiry_date,
        subtotal, vat_amount, other_taxes, total_amount,
        notes, created_by, currency, exchange_rate
      ) VALUES (
        ${piId}, ${companyId}, ${data.business_unit_id}, ${data.enterprise_id}, ${data.purchase_id || null},
        ${data.invoice_type}, ${data.punto_venta || null}, ${data.invoice_number}, ${data.invoice_date},
        ${data.cae || null}, ${data.cae_expiry_date || null},
        ${(data.subtotal || 0).toString()}, ${(data.vat_amount || 0).toString()}, ${(data.other_taxes || 0).toString()}, ${data.total_amount.toString()},
        ${data.notes || null}, ${userId}, ${piCurrency}, ${piExchangeRate}
      )
    `);

    // Insert items if provided
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      for (const item of data.items) {
        if (!item.product_name || !item.quantity || !item.unit_price) continue;
        const qty = parseFloat(String(item.quantity)) || 1;
        const price = parseFloat(String(item.unit_price)) || 0;
        const subtotal = qty * price;
        await db.execute(sql`
          INSERT INTO purchase_invoice_items (id, purchase_invoice_id, product_name, description, quantity, unit_price, subtotal)
          VALUES (${uuid()}, ${piId}, ${item.product_name}, ${item.description || null}, ${qty.toString()}, ${price.toString()}, ${subtotal.toString()})
        `);
      }
    }

    // Accounting entry
    try {
      const { accountingEntriesService } = await import('../accounting/accounting-entries.service');
      const piItems = (data.items || []).map((i: any) => ({
        quantity: Number(i.quantity || 1),
        unit_price: parseFloat(i.unit_price?.toString() || '0'),
        vat_rate: parseFloat(((i as any).vat_rate || '21').toString()),
      }));
      await accountingEntriesService.createEntryForPurchaseInvoice({
        id: piId,
        company_id: companyId,
        date: data.invoice_date,
        total: data.total_amount,
        subtotal: data.subtotal,
        vat_amount: data.vat_amount,
        items: piItems,
      });
    } catch (accErr) { console.warn('Accounting entry skipped (purchase_invoice):', (accErr as Error).message); }

    return this.getPurchaseInvoice(companyId, piId);
  }

  async getPurchaseInvoiceItems(companyId: string, piId: string) {
    // Verify ownership
    await this.getPurchaseInvoice(companyId, piId);

    const result = await db.execute(sql`
      SELECT pii.*,
        CAST(pii.subtotal AS decimal) - COALESCE((
          SELECT SUM(CAST(piia.amount_applied AS decimal))
          FROM pago_invoice_item_applications piia
          WHERE piia.purchase_invoice_item_id = pii.id
        ), 0) as remaining
      FROM purchase_invoice_items pii
      WHERE pii.purchase_invoice_id = ${piId}
      ORDER BY pii.created_at ASC
    `);
    return (result as any).rows || [];
  }

  /**
   * Get purchase items available for invoicing (not yet fully invoiced).
   */
  async getAvailablePurchaseItemsForInvoicing(companyId: string, filters: {
    enterprise_id?: string;
  } = {}) {
    let whereClause = sql`p.company_id = ${companyId} AND p.status != 'cancelada'`;
    if (filters.enterprise_id) {
      whereClause = sql`${whereClause} AND p.enterprise_id = ${filters.enterprise_id}`;
    }

    const result = await db.execute(sql`
      SELECT
        p.id as purchase_id, p.purchase_number, p.enterprise_id,
        e.name as enterprise_name,
        pi.id as purchase_item_id, pi.product_name, pi.description,
        CAST(pi.quantity AS decimal) as quantity,
        CAST(pi.unit_price AS decimal) as unit_price,
        CAST(pi.subtotal AS decimal) as subtotal,
        COALESCE((
          SELECT SUM(CAST(pii.quantity AS decimal))
          FROM purchase_invoice_items pii
          JOIN purchase_invoices pinv ON pii.purchase_invoice_id = pinv.id
          WHERE pii.purchase_item_id = pi.id AND pinv.status != 'cancelled'
        ), 0) as qty_invoiced,
        CAST(pi.quantity AS decimal) - COALESCE((
          SELECT SUM(CAST(pii.quantity AS decimal))
          FROM purchase_invoice_items pii
          JOIN purchase_invoices pinv ON pii.purchase_invoice_id = pinv.id
          WHERE pii.purchase_item_id = pi.id AND pinv.status != 'cancelled'
        ), 0) as qty_remaining
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN enterprises e ON p.enterprise_id = e.id
      WHERE ${whereClause}
      ORDER BY p.purchase_number DESC, pi.created_at ASC
    `);
    return (result as any).rows || [];
  }

  async updatePurchaseInvoice(companyId: string, piId: string, data: any) {
    // Verify exists
    await this.getPurchaseInvoice(companyId, piId);

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const updatableFields: Record<string, any> = {
      invoice_type: data.invoice_type,
      punto_venta: data.punto_venta,
      invoice_number: data.invoice_number,
      invoice_date: data.invoice_date,
      cae: data.cae,
      cae_expiry_date: data.cae_expiry_date,
      subtotal: data.subtotal?.toString(),
      vat_amount: data.vat_amount?.toString(),
      other_taxes: data.other_taxes?.toString(),
      total_amount: data.total_amount?.toString(),
      purchase_id: data.purchase_id,
      notes: data.notes,
      status: data.status,
    };

    for (const [key, val] of Object.entries(updatableFields)) {
      if (val !== undefined) {
        setClauses.push(`${key} = $${paramIdx}`);
        values.push(val);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) return this.getPurchaseInvoice(companyId, piId);

    setClauses.push(`updated_at = NOW()`);
    values.push(piId, companyId);

    await pool.query(
      `UPDATE purchase_invoices SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND company_id = $${paramIdx + 1}`,
      values
    );

    return this.getPurchaseInvoice(companyId, piId);
  }

  // TODO [ACC-3.11]: When purchase invoice cancellation is implemented (status -> 'cancelled'),
  // add: accountingEntriesService.createReverseEntry(companyId, 'purchase_invoice', piId)
  // to generate the contra-entry that reverses the original accounting entry.

  async deletePurchaseInvoice(companyId: string, piId: string) {
    // Check for linked pagos
    const pagoCheck = await db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM pago_invoice_applications WHERE purchase_invoice_id = ${piId}
      ) as has_pagos
    `);
    if (((pagoCheck as any).rows || [])[0]?.has_pagos) {
      throw new ApiError(409, 'No se puede eliminar: tiene pagos vinculados. Cancelela en su lugar.');
    }

    const result = await db.execute(sql`
      DELETE FROM purchase_invoices WHERE id = ${piId} AND company_id = ${companyId} RETURNING id
    `);
    if (((result as any).rows || []).length === 0) {
      throw new ApiError(404, 'Factura de compra no encontrada');
    }
    return { deleted: true };
  }

  async getPaymentBalance(companyId: string, piId: string) {
    const pi = await this.getPurchaseInvoice(companyId, piId);

    const appliedResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(amount_applied AS decimal)), 0) as total_applied
      FROM pago_invoice_applications
      WHERE purchase_invoice_id = ${piId}
    `);
    const totalApplied = parseFloat(((appliedResult as any).rows || [])[0]?.total_applied || '0');
    const totalAmount = parseFloat(pi.total_amount);
    const remaining = Math.max(0, totalAmount - totalApplied);

    return {
      purchase_invoice_id: piId,
      total_amount: totalAmount,
      total_applied: totalApplied,
      remaining,
      payment_status: remaining === 0 && totalAmount > 0 ? 'pagado' : totalApplied > 0 ? 'parcial' : 'pendiente',
    };
  }

  /**
   * Get purchase invoices by purchase (1 purchase → N purchase invoices).
   */
  async getPurchaseInvoicesByPurchase(companyId: string, purchaseId: string) {
    const result = await db.execute(sql`
      SELECT pi.*,
        e.name as enterprise_name,
        pi.total_amount - COALESCE((
          SELECT SUM(CAST(pia.amount_applied AS decimal))
          FROM pago_invoice_applications pia
          WHERE pia.purchase_invoice_id = pi.id
        ), 0) as remaining_balance
      FROM purchase_invoices pi
      LEFT JOIN enterprises e ON pi.enterprise_id = e.id
      WHERE pi.purchase_id = ${purchaseId} AND pi.company_id = ${companyId}
      ORDER BY pi.invoice_date DESC
    `);
    return (result as any).rows || [];
  }
}

export const purchaseInvoicesService = new PurchaseInvoicesService();
