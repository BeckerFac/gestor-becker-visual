import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { reportsService } from './reports.service';
import { accountingService } from './accounting.service';
import { businessService } from './business.service';

export class ReportsController {
  async getDashboard(req: AuthRequest, res: Response) {
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const userPermissions: Map<string, Set<string>> | undefined = (req as any)._userPermissions;
    const data = await reportsService.getDashboard(req.user!.company_id, dateFrom, dateTo, userPermissions);
    res.json(data);
  }

  async getSalesReport(req: AuthRequest, res: Response) {
    const days = parseInt(req.query.days as string) || 7;
    const data = await reportsService.getSalesReport(req.user!.company_id, days);
    res.json(data);
  }

  async getTopProducts(req: AuthRequest, res: Response) {
    const limit = parseInt(req.query.limit as string) || 5;
    const data = await reportsService.getTopProducts(req.user!.company_id, limit);
    res.json(data);
  }
  async getInsights(req: AuthRequest, res: Response) {
    const userPermissions: Map<string, Set<string>> | undefined = (req as any)._userPermissions;
    const data = await reportsService.getInsights(req.user!.company_id, userPermissions);
    res.json(data);
  }

  async getAgingReport(req: AuthRequest, res: Response) {
    const data = await reportsService.getAgingReport(req.user!.company_id);
    res.json(data);
  }

  async globalSearch(req: AuthRequest, res: Response) {
    const query = (req.query.q as string) || '';
    const userPermissions: Map<string, Set<string>> | undefined = (req as any)._userPermissions;
    const data = await reportsService.globalSearch(req.user!.company_id, query, userPermissions);
    res.json(data);
  }
  async getLibroIVAVentas(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await accountingService.getLibroIVAVentas(req.user!.company_id, dateFrom as any, dateTo as any);
      res.json(data);
    } catch (error) {
      console.error('Controller getLibroIVAVentas error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getLibroIVACompras(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await accountingService.getLibroIVACompras(req.user!.company_id, dateFrom as any, dateTo as any);
      res.json(data);
    } catch (error) {
      console.error('Controller getLibroIVACompras error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getPosicionIVA(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await accountingService.getPosicionIVA(req.user!.company_id, dateFrom as any, dateTo as any);
      res.json(data);
    } catch (error) {
      console.error('Controller getPosicionIVA error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getFlujoCaja(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await accountingService.getFlujoCaja(req.user!.company_id, dateFrom as any, dateTo as any);
      res.json(data);
    } catch (error) {
      console.error('Controller getFlujoCaja error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  // -- Business Intelligence Reports --

  async getBusinessVentas(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await businessService.getVentasReport(req.user!.company_id, dateFrom, dateTo);
      res.json(data);
    } catch (error) {
      console.error('Controller getBusinessVentas error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getBusinessRentabilidad(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await businessService.getRentabilidadReport(req.user!.company_id, dateFrom, dateTo);
      res.json(data);
    } catch (error) {
      console.error('Controller getBusinessRentabilidad error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getBusinessClientes(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await businessService.getClientesReport(req.user!.company_id, dateFrom, dateTo);
      res.json(data);
    } catch (error) {
      console.error('Controller getBusinessClientes error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getBusinessCobranzas(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await businessService.getCobranzasReport(req.user!.company_id, dateFrom, dateTo);
      res.json(data);
    } catch (error) {
      console.error('Controller getBusinessCobranzas error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getBusinessInventario(req: AuthRequest, res: Response) {
    try {
      const data = await businessService.getInventarioReport(req.user!.company_id);
      res.json(data);
    } catch (error) {
      console.error('Controller getBusinessInventario error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }

  async getBusinessConversion(req: AuthRequest, res: Response) {
    try {
      const dateFrom = (req.query.date_from as string) || undefined;
      const dateTo = (req.query.date_to as string) || undefined;
      const data = await businessService.getConversionReport(req.user!.company_id, dateFrom, dateTo);
      res.json(data);
    } catch (error) {
      console.error('Controller getBusinessConversion error:', error);
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal server error';
      res.status(status).json({ error: message });
    }
  }
}

export const reportsController = new ReportsController();
