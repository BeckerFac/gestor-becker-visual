"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogRouter = void 0;
const express_1 = require("express");
exports.catalogRouter = (0, express_1.Router)();
exports.catalogRouter.get('/', (req, res) => res.json({ message: 'List catalog' }));
exports.catalogRouter.post('/', (req, res) => res.json({ message: 'Create catalog' }));
exports.catalogRouter.get('/:id', (req, res) => res.json({ message: 'Get catalog', id: req.params.id }));
exports.catalogRouter.put('/:id', (req, res) => res.json({ message: 'Update catalog', id: req.params.id }));
exports.catalogRouter.delete('/:id', (req, res) => res.json({ message: 'Delete catalog', id: req.params.id }));
//# sourceMappingURL=catalog.router.js.map