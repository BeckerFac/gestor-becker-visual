import { Router } from 'express';
import { customersController } from './customers.controller';

export const customersRouter = Router();

customersRouter.get('/', (req, res) => customersController.getCustomers(req, res));
customersRouter.post('/', (req, res) => customersController.createCustomer(req, res));
customersRouter.get('/:id', (req, res) => customersController.getCustomer(req, res));
customersRouter.put('/:id', (req, res) => customersController.updateCustomer(req, res));
customersRouter.delete('/:id', (req, res) => customersController.deleteCustomer(req, res));
