import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { adminService, BLOCK_REASON_CATEGORIES, BlockReasonCategory } from './admin.service';
import { ApiError } from '../../middlewares/errorHandler';
import { getSecurityDashboard } from '../../lib/security-monitor';
import { activityService } from '../activity/activity.service';
import { pool } from '../../config/db';

/**
 * PR7-T20 postmortem: expected schema snapshot used by the /schema-check
 * diagnostic endpoint. When production 500s are suspected to be caused by a
 * silently-failed migration, this endpoint diffs the live DB against this
 * list and returns the missing columns per table.
 */
const EXPECTED_SCHEMA: Record<string, string[]> = {
  retenciones: [
    'direction', 'jurisdiction', 'anulled_at', 'anulled_by', 'anulled_reason',
    'purchase_invoice_id', 'cobro_id', 'invoice_id', 'status',
  ],
  pagos: [
    'anulled_at', 'anulled_by', 'anulled_reason', 'total_amount', 'status',
    'business_unit_id',
  ],
  cheques: ['direction', 'issuer_type', 'drawer_cuit'],
  purchase_invoices: [
    'is_credit_note', 'related_invoice_id', 'status', 'cancellation_reason',
    'cancelled_at', 'cancelled_by',
  ],
  purchases: ['business_unit_id'],
};

export class AdminController {
  async getAllCompanies(req: AuthRequest, res: Response) {
    try {
      const {
        search,
        plan: planFilter,
        status: statusFilter,
        sortBy,
        sortDir,
      } = req.query as Record<string, string>;

      const companies = await adminService.getAllCompanies({
        search,
        planFilter,
        statusFilter,
        sortBy,
        sortDir,
      });
      res.json({ companies });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener companies' });
    }
  }

  async getCompanyDetail(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const detail = await adminService.getCompanyDetail(id);
      res.json(detail);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener detalle de company' });
    }
  }

  async blockCompany(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { category, reason } = req.body;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      if (!category || !reason) {
        throw new ApiError(400, 'Category and reason are required');
      }
      const result = await adminService.blockCompany(
        id,
        category as BlockReasonCategory,
        reason,
        req.user!.id
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al bloquear company' });
    }
  }

  async unblockCompany(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const result = await adminService.unblockCompany(id, req.user!.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al desbloquear company' });
    }
  }

  // Legacy endpoints kept for backwards compatibility
  async disableCompany(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      if (!reason) {
        throw new ApiError(400, 'Motivo de deshabilitacion requerido');
      }
      const result = await adminService.disableCompany(id, reason);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al deshabilitar company' });
    }
  }

  async enableCompany(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const result = await adminService.enableCompany(id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al habilitar company' });
    }
  }

  async impersonateCompany(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const result = await adminService.impersonateCompany(id, req.user!.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al impersonar company' });
    }
  }

  async getSystemStats(req: AuthRequest, res: Response) {
    try {
      const stats = await adminService.getSystemStats();
      res.json(stats);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener estadisticas del sistema' });
    }
  }

  async getSystemHealth(req: AuthRequest, res: Response) {
    try {
      const health = await adminService.getSystemHealth();
      res.json(health);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener salud del sistema' });
    }
  }

  async createCompany(req: AuthRequest, res: Response) {
    try {
      const { name, cuit, adminEmail, adminName, plan, billingPeriod } = req.body;
      if (!name || !cuit || !adminEmail || !adminName) {
        throw new ApiError(400, 'name, cuit, adminEmail, adminName son requeridos');
      }
      const result = await adminService.createCompanyManual(
        { name, cuit, adminEmail, adminName, plan: plan || 'trial', billingPeriod: billingPeriod || 'monthly' },
        req.user!.id
      );
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al crear company' });
    }
  }

  async updateCompanyPlan(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const { plan, billingPeriod, planOverrides, trialExtensionDays } = req.body;
      const result = await adminService.updateCompanyPlan(
        id,
        { plan, billingPeriod, planOverrides, trialExtensionDays },
        req.user!.id
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al actualizar plan' });
    }
  }

  async downloadBackup(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const backup = await adminService.backupCompany(id);
      const filename = `backup_${id}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(backup);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Download backup error:', error);
      res.status(500).json({ error: 'Error al descargar backup' });
    }
  }

  async listBackups(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const backups = await adminService.listBackups(id);
      res.json({ backups });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al listar backups' });
    }
  }

  async restoreBackup(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { backupId } = req.body;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      if (!backupId) {
        throw new ApiError(400, 'Backup ID requerido');
      }
      const result = await adminService.restoreBackup(id, backupId, req.user!.id);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al restaurar backup' });
    }
  }

  async getAuditTrail(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!id) {
        throw new ApiError(400, 'Company ID requerido');
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const trail = await adminService.getAuditTrail(id, Math.min(limit, 200));
      res.json({ audit_trail: trail });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener audit trail' });
    }
  }

  async getBlockReasonCategories(_req: AuthRequest, res: Response) {
    res.json({ categories: BLOCK_REASON_CATEGORIES });
  }

  async getGlobalLogs(req: AuthRequest, res: Response) {
    try {
      const { companyId, userId, module, action, dateFrom, dateTo, search, page, limit } = req.query;
      const logs = await activityService.getAllLogs({
        companyId: companyId as string,
        userId: userId as string,
        module: module as string,
        action: action as string,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        search: search as string,
        page: parseInt(page as string) || 1,
        limit: Math.min(parseInt(limit as string) || 50, 100),
      });
      res.json(logs);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener logs globales' });
    }
  }

  async getLogStats(_req: AuthRequest, res: Response) {
    try {
      const stats = await activityService.getLogStats();
      res.json(stats);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener estadisticas de logs' });
    }
  }

  async getSecurityDashboard(_req: AuthRequest, res: Response) {
    try {
      const dashboard = await getSecurityDashboard();
      res.json(dashboard);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener dashboard de seguridad' });
    }
  }

  /**
   * Schema diagnostic: returns per-table list of expected columns that are
   * currently MISSING from the live database. Used to diagnose production
   * 500s caused by silently-failed ALTER TABLE migrations (PR7-T20).
   *
   * Route is mounted under /api/admin which already enforces superadmin.
   */
  async getSchemaCheck(_req: AuthRequest, res: Response) {
    try {
      const report: Record<string, { expected: string[]; present: string[]; missing: string[] }> = {};
      let anyMissing = false;

      for (const [table, expectedCols] of Object.entries(EXPECTED_SCHEMA)) {
        const result = await pool.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        const present = (result.rows || []).map((r: any) => r.column_name as string);
        const missing = expectedCols.filter((c) => !present.includes(c));
        if (missing.length > 0) anyMissing = true;
        report[table] = { expected: expectedCols, present, missing };
      }

      res.json({
        ok: !anyMissing,
        tables: report,
        checked_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[ADMIN schema-check] error:', error);
      res.status(500).json({ error: 'Error al verificar esquema de base de datos' });
    }
  }
}

export const adminController = new AdminController();
