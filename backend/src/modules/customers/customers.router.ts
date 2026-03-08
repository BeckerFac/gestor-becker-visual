import { Router } from 'express';
import { customersController } from './customers.controller';
import { authorize } from '../../middlewares/authorize';

export const customersRouter = Router();

customersRouter.get('/', authorize('enterprises', 'view'), (req, res) => customersController.getCustomers(req, res));
customersRouter.post('/', authorize('enterprises', 'create'), (req, res) => customersController.createCustomer(req, res));
customersRouter.get('/:id', authorize('enterprises', 'view'), (req, res) => customersController.getCustomer(req, res));
customersRouter.put('/:id', authorize('enterprises', 'edit'), (req, res) => customersController.updateCustomer(req, res));
customersRouter.delete('/:id', authorize('enterprises', 'delete'), (req, res) => customersController.deleteCustomer(req, res));
