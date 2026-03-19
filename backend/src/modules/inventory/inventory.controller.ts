import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { inventoryService } from './inventory.service';

export class InventoryController {
  async getStock(req: AuthRequest, res: Response) {
    const data = await inventoryService.getStock(req.user!.company_id);
    res.json(data);
  }

  async createMovement(req: AuthRequest, res: Response) {
    const data = await inventoryService.createMovement(
      req.user!.company_id,
      req.user!.id,
      req.body
    );
    res.status(201).json(data);
  }

  async getLowStock(req: AuthRequest, res: Response) {
    const data = await inventoryService.getLowStock(req.user!.company_id);
    res.json(data);
  }

  async adjustStock(req: AuthRequest, res: Response) {
    const data = await inventoryService.adjustStock(
      req.user!.company_id,
      req.user!.id,
      req.body
    );
    res.status(201).json(data);
  }

  async getStockMovements(req: AuthRequest, res: Response) {
    const { skip = '0', limit = '50', product_id = '' } = req.query;
    const data = await inventoryService.getStockMovements(req.user!.company_id, {
      skip: parseInt(skip as string, 10),
      limit: parseInt(limit as string, 10),
      product_id: product_id as string,
    });
    res.json(data);
  }

  async addStockFromPurchase(req: AuthRequest, res: Response) {
    const data = await inventoryService.addStockFromPurchase(
      req.user!.company_id,
      req.user!.id,
      req.body.purchase_id,
      req.body.items || []
    );
    res.status(201).json(data);
  }
}

export const inventoryController = new InventoryController();
