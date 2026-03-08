import { Router } from 'express';
import { authorize } from '../../middlewares/authorize';

export const catalogRouter = Router();

catalogRouter.get('/', (req, res) => res.json({ message: 'List catalog' }));
catalogRouter.post('/', authorize('products', 'edit'), (req, res) => res.json({ message: 'Create catalog' }));
catalogRouter.get('/:id', (req, res) => res.json({ message: 'Get catalog', id: req.params.id }));
catalogRouter.put('/:id', authorize('products', 'edit'), (req, res) => res.json({ message: 'Update catalog', id: req.params.id }));
catalogRouter.delete('/:id', authorize('products', 'edit'), (req, res) => res.json({ message: 'Delete catalog', id: req.params.id }));
