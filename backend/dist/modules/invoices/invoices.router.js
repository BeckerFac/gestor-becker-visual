"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicesRouter = void 0;
const express_1 = require("express");
const invoices_controller_1 = require("./invoices.controller");
exports.invoicesRouter = (0, express_1.Router)();
exports.invoicesRouter.get('/', (req, res) => invoices_controller_1.invoicesController.getInvoices(req, res));
exports.invoicesRouter.post('/', (req, res) => invoices_controller_1.invoicesController.createInvoice(req, res));
exports.invoicesRouter.get('/:id', (req, res) => invoices_controller_1.invoicesController.getInvoice(req, res));
exports.invoicesRouter.post('/:id/authorize', (req, res) => invoices_controller_1.invoicesController.authorizeInvoice(req, res));
//# sourceMappingURL=invoices.router.js.map