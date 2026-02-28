import { Router } from 'express';

export const afipRouter = Router();

afipRouter.get('/', (req, res) => res.json({ message: 'List afip' }));
afipRouter.post('/', (req, res) => res.json({ message: 'Create afip' }));
afipRouter.get('/:id', (req, res) => res.json({ message: 'Get afip', id: req.params.id }));
afipRouter.put('/:id', (req, res) => res.json({ message: 'Update afip', id: req.params.id }));
afipRouter.delete('/:id', (req, res) => res.json({ message: 'Delete afip', id: req.params.id }));
