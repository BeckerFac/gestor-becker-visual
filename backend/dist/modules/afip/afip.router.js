"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.afipRouter = void 0;
const express_1 = require("express");
const afip_controller_1 = require("./afip.controller");
exports.afipRouter = (0, express_1.Router)();
exports.afipRouter.post('/authorize', (req, res) => afip_controller_1.afipController.authorizeInvoice(req, res));
exports.afipRouter.post('/verify-cuit', (req, res) => afip_controller_1.afipController.verifyCuit(req, res));
exports.afipRouter.get('/authorized', (req, res) => afip_controller_1.afipController.getAuthorizedInvoices(req, res));
//# sourceMappingURL=afip.router.js.map