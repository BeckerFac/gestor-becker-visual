import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { productComponentsService } from './product-components.service';

export class ProductComponentsController {
  async getComponents(req: AuthRequest, res: Response) {
    const data = await productComponentsService.getComponents(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async addComponent(req: AuthRequest, res: Response) {
    const data = await productComponentsService.addComponent(req.user!.company_id, req.params.id, req.body);
    res.status(201).json(data);
  }

  async updateComponent(req: AuthRequest, res: Response) {
    const data = await productComponentsService.updateComponent(req.user!.company_id, req.params.componentId, req.body);
    res.json(data);
  }

  async removeComponent(req: AuthRequest, res: Response) {
    const data = await productComponentsService.removeComponent(req.user!.company_id, req.params.componentId);
    res.json(data);
  }

  async getBOMCost(req: AuthRequest, res: Response) {
    const data = await productComponentsService.getBOMCost(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async checkAvailability(req: AuthRequest, res: Response) {
    const quantity = parseFloat(req.query.quantity as string) || 1;
    const data = await productComponentsService.checkBOMAvailability(req.user!.company_id, req.params.id, quantity);
    res.json(data);
  }

  async getProductsUsing(req: AuthRequest, res: Response) {
    const data = await productComponentsService.getProductsUsingComponent(req.user!.company_id, req.params.id);
    res.json(data);
  }
}

export const productComponentsController = new ProductComponentsController();
