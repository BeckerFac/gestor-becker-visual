import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';

export const pricingRouter = Router();

pricingRouter.get('/', authorize('products', 'view'), (req, res) => res.json({ message: 'List pricing' }));
pricingRouter.post('/', authorize('products', 'edit'), (req, res) => res.json({ message: 'Create pricing' }));
pricingRouter.get('/:id', authorize('products', 'view'), (req, res) => res.json({ message: 'Get pricing', id: req.params.id }));
pricingRouter.put('/:id', authorize('products', 'edit'), (req, res) => res.json({ message: 'Update pricing', id: req.params.id }));
pricingRouter.delete('/:id', authorize('products', 'edit'), (req, res) => res.json({ message: 'Delete pricing', id: req.params.id }));
