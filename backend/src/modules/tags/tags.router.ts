import { Router } from 'express';
import { tagsController } from './tags.controller';

export const tagsRouter = Router();

tagsRouter.get('/', (req, res) => tagsController.getTags(req as any, res));
tagsRouter.post('/', (req, res) => tagsController.createTag(req as any, res));
tagsRouter.put('/:id', (req, res) => tagsController.updateTag(req as any, res));
tagsRouter.delete('/:id', (req, res) => tagsController.deleteTag(req as any, res));
tagsRouter.post('/assign', (req, res) => tagsController.assignTag(req as any, res));
tagsRouter.post('/remove', (req, res) => tagsController.removeTag(req as any, res));
