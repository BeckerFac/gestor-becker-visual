import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { adminService, BLOCK_REASON_CATEGORIES, BlockReasonCategory } from './admin.service';
import { ApiError } from '../../middlewares/errorHandler';
import { getSecurityDashboard } from '../../lib/security-monitor';

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
}

export const adminController = new AdminController();
