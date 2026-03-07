import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { tagsService } from './tags.service';

export class TagsController {
  async getTags(req: AuthRequest, res: Response) {
    const data = await tagsService.getTags(req.user!.company_id);
    res.json(data);
  }

  async createTag(req: AuthRequest, res: Response) {
    const data = await tagsService.createTag(req.user!.company_id, req.body);
    res.status(201).json(data);
  }

  async updateTag(req: AuthRequest, res: Response) {
    const data = await tagsService.updateTag(req.user!.company_id, req.params.id, req.body);
    res.json(data);
  }

  async deleteTag(req: AuthRequest, res: Response) {
    const data = await tagsService.deleteTag(req.user!.company_id, req.params.id);
    res.json(data);
  }

  async assignTag(req: AuthRequest, res: Response) {
    const { entity_id, entity_type, tag_id } = req.body;
    const data = await tagsService.assignTag(entity_id, entity_type, tag_id);
    res.json(data);
  }

  async removeTag(req: AuthRequest, res: Response) {
    const { entity_id, entity_type, tag_id } = req.body;
    const data = await tagsService.removeTag(entity_id, entity_type, tag_id);
    res.json(data);
  }
}

export const tagsController = new TagsController();
