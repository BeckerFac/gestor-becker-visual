"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfRouter = void 0;
const express_1 = require("express");
const pdf_controller_1 = require("./pdf.controller");
exports.pdfRouter = (0, express_1.Router)();
exports.pdfRouter.get('/invoice/:invoiceId', (req, res) => pdf_controller_1.pdfController.generateInvoicePdf(req, res));
exports.pdfRouter.post('/catalog', (req, res) => pdf_controller_1.pdfController.generateCatalogPdf(req, res));
//# sourceMappingURL=pdf.router.js.map