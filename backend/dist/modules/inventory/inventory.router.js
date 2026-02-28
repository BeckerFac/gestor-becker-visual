"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryRouter = void 0;
const express_1 = require("express");
exports.inventoryRouter = (0, express_1.Router)();
exports.inventoryRouter.get('/', (req, res) => res.json({ message: 'List inventory' }));
exports.inventoryRouter.post('/', (req, res) => res.json({ message: 'Create inventory' }));
exports.inventoryRouter.get('/:id', (req, res) => res.json({ message: 'Get inventory', id: req.params.id }));
exports.inventoryRouter.put('/:id', (req, res) => res.json({ message: 'Update inventory', id: req.params.id }));
exports.inventoryRouter.delete('/:id', (req, res) => res.json({ message: 'Delete inventory', id: req.params.id }));
//# sourceMappingURL=inventory.router.js.map