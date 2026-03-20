import { Router } from 'express';
import { priceCriteriaController } from './price-criteria.controller';
import { authorize } from '../../middlewares/authorize';

export const priceCriteriaRouter = Router();

// Price criteria CRUD
priceCriteriaRouter.get('/', authorize('products', 'view'), (req, res) =>
  priceCriteriaController.getCriteria(req, res)
);
priceCriteriaRouter.post('/', authorize('products', 'create'), (req, res) =>
  priceCriteriaController.createCriteria(req, res)
);
priceCriteriaRouter.delete('/:id', authorize('products', 'delete'), (req, res) =>
  priceCriteriaController.deleteCriteria(req, res)
);
