import { Router } from 'express';

export const catalogRouter = Router();

catalogRouter.get('/', (req, res) => res.json({ message: 'List catalog' }));
catalogRouter.post('/', (req, res) => res.json({ message: 'Create catalog' }));
catalogRouter.get('/:id', (req, res) => res.json({ message: 'Get catalog', id: req.params.id }));
catalogRouter.put('/:id', (req, res) => res.json({ message: 'Update catalog', id: req.params.id }));
catalogRouter.delete('/:id', (req, res) => res.json({ message: 'Delete catalog', id: req.params.id }));
