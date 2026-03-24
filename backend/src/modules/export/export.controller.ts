import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { pool } from '../../config/db';

export class ExportController {
  async exportCompanyData(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;

      const queries = [
        pool.query(
          `SELECT id, customer_id, enterprise_id, bank_id, order_number, title, description,
                  product_type, status, priority, quantity, unit_price, total_amount, vat_rate,
                  estimated_profit, estimated_delivery, payment_method, payment_status,
                  invoice_id, quote_id, notes, created_by, created_at, updated_at
           FROM orders WHERE company_id = $1 ORDER BY created_at DESC`,
          [companyId],
        ),
        pool.query('SELECT id, name, email, phone, cuit, tax_condition, address, city, province, notes, created_at FROM customers WHERE company_id = $1', [companyId]),
        pool.query(
          `SELECT id, name, cuit, address, city, province, phone, email,
                  tax_condition, notes, status, created_at, updated_at
           FROM enterprises WHERE company_id = $1`,
          [companyId],
        ),
        pool.query(
          `SELECT id, sku, barcode, name, description, category_id, brand_id, image_url,
                  active, product_type, controls_stock, low_stock_threshold, created_at, updated_at
           FROM products WHERE company_id = $1`,
          [companyId],
        ),
        pool.query(
          `SELECT id, customer_id, enterprise_id, invoice_type, invoice_number, invoice_date,
                  due_date, subtotal, vat_amount, total_amount, cae, cae_expiry_date, qr_code,
                  status, is_fce, fce_payment_due_date, fce_cbu, fce_status,
                  export_type, destination_country, incoterms, export_permit,
                  created_by, created_at, updated_at
           FROM invoices WHERE company_id = $1 ORDER BY created_at DESC`,
          [companyId],
        ),
        pool.query(
          `SELECT id, customer_id, enterprise_id, title, valid_until, subtotal, vat_amount,
                  total_amount, status, notes, created_by, created_at, updated_at
           FROM quotes WHERE company_id = $1 ORDER BY created_at DESC`,
          [companyId],
        ),
        pool.query(
          `SELECT id, number, bank, drawer, amount, issue_date, due_date, status,
                  customer_id, order_id, notes, collected_date, created_by, created_at
           FROM cheques WHERE company_id = $1 ORDER BY created_at DESC`,
          [companyId],
        ),
        pool.query(
          `SELECT id, enterprise_id, order_id, invoice_id, amount, payment_method, bank_id,
                  reference, payment_date, notes, receipt_number, created_by, created_at
           FROM cobros WHERE company_id = $1 ORDER BY created_at DESC`,
          [companyId],
        ).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT s.*, p.name as product_name, p.sku
           FROM stock s JOIN products p ON s.product_id = p.id
           WHERE s.company_id = $1`,
          [companyId]
        ).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT id, enterprise_id, purchase_number, date, invoice_type, invoice_number,
                  invoice_cae, subtotal, vat_amount, total_amount, payment_method,
                  payment_status, bank_id, notes, status, created_by, created_at, updated_at
           FROM purchases WHERE company_id = $1 ORDER BY created_at DESC`,
          [companyId],
        ).catch(() => ({ rows: [] })),
      ];

      const [
        orders, customers, enterprises, products, invoices,
        quotes, cheques, cobros, inventory, purchases,
      ] = await Promise.all(queries);

      res.json({
        exported_at: new Date().toISOString(),
        company_id: companyId,
        data: {
          pedidos: orders.rows,
          clientes: customers.rows,
          empresas: enterprises.rows,
          productos: products.rows,
          facturas: invoices.rows,
          cotizaciones: quotes.rows,
          cheques: cheques.rows,
          cobros: cobros.rows,
          inventario: inventory.rows,
          compras: purchases.rows,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Error al exportar datos' });
    }
  }
}

export const exportController = new ExportController();
