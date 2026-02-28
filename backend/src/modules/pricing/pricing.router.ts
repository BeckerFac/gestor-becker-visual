import { Router } from 'express';

export const pricingRouter = Router();

pricingRouter.get('/', (req, res) => res.json({ message: 'List pricing' }));
pricingRouter.post('/', (req, res) => res.json({ message: 'Create pricing' }));
pricingRouter.get('/:id', (req, res) => res.json({ message: 'Get pricing', id: req.params.id }));
pricingRouter.put('/:id', (req, res) => res.json({ message: 'Update pricing', id: req.params.id }));
pricingRouter.delete('/:id', (req, res) => res.json({ message: 'Delete pricing', id: req.params.id }));
