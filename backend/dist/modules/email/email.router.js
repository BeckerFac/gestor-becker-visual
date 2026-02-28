"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailRouter = void 0;
const express_1 = require("express");
const email_controller_1 = require("./email.controller");
exports.emailRouter = (0, express_1.Router)();
exports.emailRouter.post('/send-invoice', (req, res) => email_controller_1.emailController.sendInvoiceEmail(req, res));
exports.emailRouter.post('/test', (req, res) => email_controller_1.emailController.testEmail(req, res));
//# sourceMappingURL=email.router.js.map