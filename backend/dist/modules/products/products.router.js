"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productsRouter = void 0;
const express_1 = require("express");
const products_controller_1 = require("./products.controller");
exports.productsRouter = (0, express_1.Router)();
exports.productsRouter.get('/', (req, res) => products_controller_1.productsController.getProducts(req, res));
exports.productsRouter.post('/', (req, res) => products_controller_1.productsController.createProduct(req, res));
exports.productsRouter.get('/:id', (req, res) => products_controller_1.productsController.getProduct(req, res));
exports.productsRouter.put('/:id', (req, res) => products_controller_1.productsController.updateProduct(req, res));
exports.productsRouter.delete('/:id', (req, res) => products_controller_1.productsController.deleteProduct(req, res));
//# sourceMappingURL=products.router.js.map