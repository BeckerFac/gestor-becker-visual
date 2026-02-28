"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.companiesRouter = void 0;
const express_1 = require("express");
exports.companiesRouter = (0, express_1.Router)();
exports.companiesRouter.get('/', (req, res) => {
    res.json({ message: 'Get companies' });
});
exports.companiesRouter.get('/:id', (req, res) => {
    res.json({ message: 'Get company', id: req.params.id });
});
exports.companiesRouter.put('/:id', (req, res) => {
    res.json({ message: 'Update company', id: req.params.id });
});
//# sourceMappingURL=companies.router.js.map