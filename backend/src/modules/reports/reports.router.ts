import { Router } from 'express';

export const reportsRouter = Router();

reportsRouter.get('/', (req, res) => res.json({ message: 'List reports' }));
reportsRouter.post('/', (req, res) => res.json({ message: 'Create reports' }));
reportsRouter.get('/:id', (req, res) => res.json({ message: 'Get reports', id: req.params.id }));
reportsRouter.put('/:id', (req, res) => res.json({ message: 'Update reports', id: req.params.id }));
reportsRouter.delete('/:id', (req, res) => res.json({ message: 'Delete reports', id: req.params.id }));
