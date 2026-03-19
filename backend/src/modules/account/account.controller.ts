import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { pool } from '../../config/db';
import { ApiError } from '../../middlewares/errorHandler';

export class AccountController {
  /**
   * GET /api/account/my-data
   * Exports ALL user and company data as JSON.
   * Required by Argentine Law 25.326 (Proteccion de Datos Personales).
   */
  async exportMyData(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.company_id;

      // Fetch user personal data
      const userResult = await pool.query(
        'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
        [userId]
      );

      // Fetch company data
      const companyResult = await pool.query(
        'SELECT id, name, cuit, address, city, province, phone, email, condicion_iva, razon_social, created_at FROM companies WHERE id = $1',
        [companyId]
      );

      // Fetch all company business data
      const queries = [
        pool.query('SELECT id, name, email, phone, cuit, tax_condition, address, city, province, notes, created_at FROM customers WHERE company_id = $1', [companyId]),
        pool.query('SELECT * FROM enterprises WHERE company_id = $1', [companyId]),
        pool.query('SELECT * FROM products WHERE company_id = $1', [companyId]),
        pool.query('SELECT * FROM orders WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM invoices WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM quotes WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM cheques WHERE company_id = $1 ORDER BY created_at DESC', [companyId]),
        pool.query('SELECT * FROM cobros WHERE company_id = $1 ORDER BY created_at DESC', [companyId]).catch(() => ({ rows: [] })),
        pool.query('SELECT * FROM pagos WHERE company_id = $1 ORDER BY created_at DESC', [companyId]).catch(() => ({ rows: [] })),
        pool.query('SELECT * FROM purchases WHERE company_id = $1 ORDER BY created_at DESC', [companyId]).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT s.*, p.name as product_name, p.sku
           FROM stock s JOIN products p ON s.product_id = p.id
           WHERE s.company_id = $1`,
          [companyId]
        ).catch(() => ({ rows: [] })),
        pool.query('SELECT * FROM tags WHERE company_id = $1', [companyId]).catch(() => ({ rows: [] })),
        pool.query('SELECT * FROM remitos WHERE company_id = $1 ORDER BY created_at DESC', [companyId]).catch(() => ({ rows: [] })),
      ];

      const [
        customers, enterprises, products, orders, invoices,
        quotes, cheques, cobros, pagos, purchases, inventory, tags, remitos,
      ] = await Promise.all(queries);

      const exportData = {
        exported_at: new Date().toISOString(),
        legal_basis: 'Ley 25.326 - Proteccion de Datos Personales (Argentina)',
        user: userResult.rows[0] || null,
        company: companyResult.rows[0] || null,
        data: {
          clientes: customers.rows,
          empresas: enterprises.rows,
          productos: products.rows,
          pedidos: orders.rows,
          facturas: invoices.rows,
          cotizaciones: quotes.rows,
          cheques: cheques.rows,
          cobros: cobros.rows,
          pagos: pagos.rows,
          compras: purchases.rows,
          inventario: inventory.rows,
          etiquetas: tags.rows,
          remitos: remitos.rows,
        },
      };

      res.setHeader('Content-Disposition', `attachment; filename="beckervisual-data-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(exportData);
    } catch (error: any) {
      res.status(500).json({ error: 'Error al exportar datos: ' + error.message });
    }
  }

  /**
   * DELETE /api/account
   * Marks account for deletion with a 30-day grace period.
   * Required by Argentine Law 25.326 (Derecho de Supresion).
   */
  async requestDeletion(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const companyId = req.user!.company_id;
      const userRole = req.user!.role;

      // Only company owner/admin can request deletion
      if (userRole !== 'admin' && userRole !== 'owner') {
        throw new ApiError(403, 'Solo el administrador de la cuenta puede solicitar la eliminacion');
      }

      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 30);

      // Mark company for deletion
      await pool.query(
        `ALTER TABLE companies ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP WITH TIME ZONE`,
        []
      );
      await pool.query(
        `ALTER TABLE companies ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMP WITH TIME ZONE`,
        []
      );
      await pool.query(
        `UPDATE companies SET deletion_requested_at = NOW(), deletion_scheduled_for = $1 WHERE id = $2`,
        [deletionDate.toISOString(), companyId]
      );

      res.json({
        message: 'Solicitud de eliminacion registrada. Tu cuenta y todos los datos seran eliminados permanentemente despues del periodo de gracia.',
        deletion_requested_at: new Date().toISOString(),
        deletion_scheduled_for: deletionDate.toISOString(),
        grace_period_days: 30,
        note: 'Podes cancelar la eliminacion iniciando sesion antes de la fecha programada y contactando a soporte.',
      });
    } catch (error: any) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al procesar solicitud de eliminacion: ' + error.message });
    }
  }

  /**
   * GET /api/account/deletion-status
   * Check if account has pending deletion request.
   */
  async getDeletionStatus(req: AuthRequest, res: Response) {
    try {
      const companyId = req.user!.company_id;

      const result = await pool.query(
        `SELECT deletion_requested_at, deletion_scheduled_for FROM companies WHERE id = $1`,
        [companyId]
      );

      const company = result.rows[0];
      if (!company || !company.deletion_requested_at) {
        return res.json({ pending_deletion: false });
      }

      res.json({
        pending_deletion: true,
        deletion_requested_at: company.deletion_requested_at,
        deletion_scheduled_for: company.deletion_scheduled_for,
      });
    } catch (error: any) {
      // If columns don't exist yet, no deletion pending
      res.json({ pending_deletion: false });
    }
  }
}

export const accountController = new AccountController();
