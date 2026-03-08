import { Router } from 'express';
import { tagsController } from './tags.controller';
import { authorize } from '../../middlewares/authorize';

export const tagsRouter = Router();

tagsRouter.get('/', authorize('enterprises', 'view'), (req, res) => tagsController.getTags(req as any, res));
tagsRouter.post('/', authorize('enterprises', 'edit'), (req, res) => tagsController.createTag(req as any, res));
tagsRouter.put('/:id', authorize('enterprises', 'edit'), (req, res) => tagsController.updateTag(req as any, res));
tagsRouter.delete('/:id', authorize('enterprises', 'edit'), (req, res) => tagsController.deleteTag(req as any, res));
tagsRouter.post('/assign', authorize('enterprises', 'edit'), (req, res) => tagsController.assignTag(req as any, res));
tagsRouter.post('/remove', authorize('enterprises', 'edit'), (req, res) => tagsController.removeTag(req as any, res));
