import { Router } from 'express';

export const inventoryRouter = Router();

inventoryRouter.get('/', (req, res) => res.json({ message: 'List inventory' }));
inventoryRouter.post('/', (req, res) => res.json({ message: 'Create inventory' }));
inventoryRouter.get('/:id', (req, res) => res.json({ message: 'Get inventory', id: req.params.id }));
inventoryRouter.put('/:id', (req, res) => res.json({ message: 'Update inventory', id: req.params.id }));
inventoryRouter.delete('/:id', (req, res) => res.json({ message: 'Delete inventory', id: req.params.id }));
