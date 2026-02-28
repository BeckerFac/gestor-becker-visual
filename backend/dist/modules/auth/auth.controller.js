"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = exports.AuthController = void 0;
const auth_service_1 = require("./auth.service");
const errorHandler_1 = require("../../middlewares/errorHandler");
class AuthController {
    async register(req, res) {
        try {
            const { email, password, name, company_name, cuit } = req.body;
            if (!email || !password || !name || !company_name || !cuit) {
                throw new errorHandler_1.ApiError(400, 'Missing required fields');
            }
            const result = await auth_service_1.authService.register(email, password, name, company_name, cuit);
            res.status(201).json({
                message: 'Registration successful',
                ...result,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Registration failed' });
        }
    }
    async login(req, res) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                throw new errorHandler_1.ApiError(400, 'Email and password required');
            }
            const result = await auth_service_1.authService.login(email, password);
            res.json({
                message: 'Login successful',
                ...result,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Login failed' });
        }
    }
    async refreshToken(req, res) {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken || !req.user?.id) {
                throw new errorHandler_1.ApiError(400, 'Refresh token and user ID required');
            }
            const tokens = await auth_service_1.authService.refreshToken(req.user.id, refreshToken);
            res.json({
                message: 'Token refreshed',
                ...tokens,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Token refresh failed' });
        }
    }
    logout(req, res) {
        // JWT is stateless, so logout just returns success
        res.json({ message: 'Logout successful' });
    }
    async getMe(req, res) {
        try {
            if (!req.user) {
                throw new errorHandler_1.ApiError(401, 'Not authenticated');
            }
            res.json({
                user: req.user,
            });
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to get user info' });
        }
    }
}
exports.AuthController = AuthController;
exports.authController = new AuthController();
//# sourceMappingURL=auth.controller.js.map