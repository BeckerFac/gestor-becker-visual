import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { materialsService } from './materials.service';

export class MaterialsController {
  async getMaterials(req: AuthRequest, res: Response) {
    const search = req.query.search as string | undefined;
    const data = await materialsService.getMaterials(req.user!.company_id, search);
    res.json(data);
  }

  async getMaterial(req: AuthRequest, res: Response) {
    const data = await materialsService.getMaterial(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async createMaterial(req: AuthRequest, res: Response) {
    const data = await materialsService.createMaterial(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async updateMaterial(req: AuthRequest, res: Response) {
    const data = await materialsService.updateMaterial(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteMaterial(req: AuthRequest, res: Response) {
    const data = await materialsService.deleteMaterial(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async adjustStock(req: AuthRequest, res: Response) {
    const { quantity_change, reason } = req.body;
    if (quantity_change === undefined || quantity_change === null) {
      return res.status(400).json({ error: 'quantity_change es requerido' });
    }
    const data = await materialsService.adjustMaterialStock(
      req.user!.company_id,
      req.params.id,
      parseFloat(quantity_change),
      reason || 'Ajuste manual',
      req.user!.id
    );
    res.json(data);
  }

  async getMovements(req: AuthRequest, res: Response) {
    const data = await materialsService.getMaterialMovements(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async getProductMaterials(req: AuthRequest, res: Response) {
    const data = await materialsService.getProductMaterials(req.params.id);
    res.json(data);
  }

  async setProductMaterials(req: AuthRequest, res: Response) {
    const { materials } = req.body;
    if (!Array.isArray(materials)) {
      return res.status(400).json({ error: 'materials debe ser un array' });
    }
    const data = await materialsService.setProductMaterials(req.params.id, materials);
    res.json(data);
  }

  async getProductBOMCost(req: AuthRequest, res: Response) {
    const data = await materialsService.getProductBOMCost(req.params.id);
    res.json(data);
  }

  async checkAvailability(req: AuthRequest, res: Response) {
    const quantity = parseFloat(req.query.quantity as string) || 1;
    const data = await materialsService.checkMaterialAvailability(req.params.id, quantity);
    res.json(data);
  }
}

export const materialsController = new MaterialsController();
