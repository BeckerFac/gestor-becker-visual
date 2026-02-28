import { Request, Response } from 'express';
import { customersService } from './customers.service';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';

export class CustomersController {
  async createCustomer(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.body.cuit || !req.body.name) {
        throw new ApiError(400, 'Missing required fields');
      }
      const customer = await customersService.createCustomer(req.user.company_id, req.body);
      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to create customer' });
    }
  }

  async getCustomers(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const { skip = '0', limit = '50' } = req.query;
      const data = await customersService.getCustomers(req.user.company_id, {
        skip: parseInt(skip as string, 10),
        limit: parseInt(limit as string, 10),
      });
      res.json(data);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get customers' });
    }
  }

  async getCustomer(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing customer ID');
      const customer = await customersService.getCustomer(req.user.company_id, req.params.id);
      res.json(customer);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to get customer' });
    }
  }

  async updateCustomer(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing customer ID');
      const customer = await customersService.updateCustomer(req.user.company_id, req.params.id, req.body);
      res.json(customer);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to update customer' });
    }
  }

  async deleteCustomer(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id || !req.params.id) throw new ApiError(400, 'Missing customer ID');
      await customersService.deleteCustomer(req.user.company_id, req.params.id);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to delete customer' });
    }
  }
}

export const customersController = new CustomersController();
