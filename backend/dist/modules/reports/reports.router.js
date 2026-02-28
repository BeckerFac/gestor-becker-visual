"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
exports.reportsRouter = (0, express_1.Router)();
exports.reportsRouter.get('/', (req, res) => res.json({ message: 'List reports' }));
exports.reportsRouter.post('/', (req, res) => res.json({ message: 'Create reports' }));
exports.reportsRouter.get('/:id', (req, res) => res.json({ message: 'Get reports', id: req.params.id }));
exports.reportsRouter.put('/:id', (req, res) => res.json({ message: 'Update reports', id: req.params.id }));
exports.reportsRouter.delete('/:id', (req, res) => res.json({ message: 'Delete reports', id: req.params.id }));
//# sourceMappingURL=reports.router.js.map