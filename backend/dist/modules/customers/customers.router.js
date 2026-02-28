"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersRouter = void 0;
const express_1 = require("express");
const customers_controller_1 = require("./customers.controller");
exports.customersRouter = (0, express_1.Router)();
exports.customersRouter.get('/', (req, res) => customers_controller_1.customersController.getCustomers(req, res));
exports.customersRouter.post('/', (req, res) => customers_controller_1.customersController.createCustomer(req, res));
exports.customersRouter.get('/:id', (req, res) => customers_controller_1.customersController.getCustomer(req, res));
exports.customersRouter.put('/:id', (req, res) => customers_controller_1.customersController.updateCustomer(req, res));
exports.customersRouter.delete('/:id', (req, res) => customers_controller_1.customersController.deleteCustomer(req, res));
//# sourceMappingURL=customers.router.js.map