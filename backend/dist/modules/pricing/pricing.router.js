"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pricingRouter = void 0;
const express_1 = require("express");
exports.pricingRouter = (0, express_1.Router)();
exports.pricingRouter.get('/', (req, res) => res.json({ message: 'List pricing' }));
exports.pricingRouter.post('/', (req, res) => res.json({ message: 'Create pricing' }));
exports.pricingRouter.get('/:id', (req, res) => res.json({ message: 'Get pricing', id: req.params.id }));
exports.pricingRouter.put('/:id', (req, res) => res.json({ message: 'Update pricing', id: req.params.id }));
exports.pricingRouter.delete('/:id', (req, res) => res.json({ message: 'Delete pricing', id: req.params.id }));
//# sourceMappingURL=pricing.router.js.map