import { Router } from 'express';

export const companiesRouter = Router();

companiesRouter.get('/', (req, res) => {
  res.json({ message: 'Get companies' });
});

companiesRouter.get('/:id', (req, res) => {
  res.json({ message: 'Get company', id: req.params.id });
});

companiesRouter.put('/:id', (req, res) => {
  res.json({ message: 'Update company', id: req.params.id });
});
