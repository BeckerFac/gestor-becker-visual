"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_1 = require("../../middlewares/auth");
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/register', (req, res) => auth_controller_1.authController.register(req, res));
exports.authRouter.post('/login', (req, res) => auth_controller_1.authController.login(req, res));
exports.authRouter.post('/refresh', auth_1.authMiddleware, (req, res) => auth_controller_1.authController.refreshToken(req, res));
exports.authRouter.post('/logout', auth_1.authMiddleware, (req, res) => auth_controller_1.authController.logout(req, res));
exports.authRouter.get('/me', auth_1.authMiddleware, (req, res) => auth_controller_1.authController.getMe(req, res));
//# sourceMappingURL=auth.router.js.map