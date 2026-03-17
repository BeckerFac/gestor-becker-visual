import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { pool } from '../../config/db';

export class ExportController {
  async exportCompanyData(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;

      const queries = [
        pool.query('SELECT * FROM orders WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT id, name, email, phone, cuit, tax_condition, address, city, province, notes, created_at FROM customers WHERE company_id = $1', [companyId]),
        pool.query('SELECT * FROM enterprises WHERE company_id = $1', [companyId]),
        pool.query('SELECT * FROM products WHERE company_id = $1', [companyId]),
        pool.query('SELECT * FROM invoices WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM quotes WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM cheques WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM cobros WHERE company_id = $1 ORDER BY created_at DESC', [companyId]).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT s.*, p.name as product_name, p.sku
           FROM stock s JOIN products p ON s.product_id = p.id
           WHERE s.company_id = $1`,
          [companyId]
        ).catch(() => ({ rows: [] })),
        pool.query('SELECT * FROM purchases WHERE company_id = $1 ORDER BY created_at DESC', [companyId]).catch(() => ({ rows: [] })),
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
      res.status(500).json({ error: 'Error al exportar datos: ' + error.message });
    }
  }
}

export const exportController = new ExportController();
