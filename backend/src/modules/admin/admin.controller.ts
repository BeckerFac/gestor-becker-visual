import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { adminService } from './admin.service';
import { ApiError } from '../../middlewares/errorHandler';

export class AdminController {
  async getAllCompanies(req: AuthRequest, res: Response) {
    try {
      const companies = await adminService.getAllCompanies();
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
}

export const adminController = new AdminController();
