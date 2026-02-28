"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.afipRouter = void 0;
const express_1 = require("express");
exports.afipRouter = (0, express_1.Router)();
exports.afipRouter.get('/', (req, res) => res.json({ message: 'List afip' }));
exports.afipRouter.post('/', (req, res) => res.json({ message: 'Create afip' }));
exports.afipRouter.get('/:id', (req, res) => res.json({ message: 'Get afip', id: req.params.id }));
exports.afipRouter.put('/:id', (req, res) => res.json({ message: 'Update afip', id: req.params.id }));
exports.afipRouter.delete('/:id', (req, res) => res.json({ message: 'Delete afip', id: req.params.id }));
//# sourceMappingURL=afip.router.js.map