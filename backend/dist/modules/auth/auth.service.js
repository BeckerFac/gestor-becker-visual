"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../../config/db");
const schema_1 = require("../../db/schema");
const env_1 = require("../../config/env");
const drizzle_orm_1 = require("drizzle-orm");
const errorHandler_1 = require("../../middlewares/errorHandler");
class AuthService {
    async register(email, password, name, company_name, cuit) {
        try {
            // Check if user exists
            const existingUser = await db_1.db.query.users.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.users.email, email),
            });
            if (existingUser) {
                throw new errorHandler_1.ApiError(409, 'Email already registered');
            }
            // Create company
            const company = await db_1.db.insert(schema_1.companies).values({
                name: company_name,
                cuit,
            }).returning();
            if (!company[0]) {
                throw new errorHandler_1.ApiError(500, 'Failed to create company');
            }
            // Hash password
            const hashedPassword = await bcryptjs_1.default.hash(password, 10);
            // Create user
            const user = await db_1.db.insert(schema_1.users).values({
                company_id: company[0].id,
                email,
                password_hash: hashedPassword,
                name,
                role: 'admin',
            }).returning({
                id: schema_1.users.id,
                email: schema_1.users.email,
                name: schema_1.users.name,
                role: schema_1.users.role,
            });
            if (!user[0]) {
                throw new errorHandler_1.ApiError(500, 'Failed to create user');
            }
            // Generate tokens
            const tokens = this.generateTokens(user[0].id, email, company[0].id, user[0].role);
            return {
                user: user[0],
                company: company[0],
                ...tokens,
            };
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Registration failed');
        }
    }
    async login(email, password) {
        try {
            const user = await db_1.db.query.users.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.users.email, email),
            });
            if (!user) {
                throw new errorHandler_1.ApiError(401, 'Invalid credentials');
            }
            const passwordMatch = await bcryptjs_1.default.compare(password, user.password_hash);
            if (!passwordMatch) {
                throw new errorHandler_1.ApiError(401, 'Invalid credentials');
            }
            // Update last login
            await db_1.db.update(schema_1.users).set({ last_login: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
            // Generate tokens
            const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role);
            return {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    company_id: user.company_id,
                },
                ...tokens,
            };
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(500, 'Login failed');
        }
    }
    async refreshToken(userId, refreshToken) {
        try {
            // Verify refresh token
            const decoded = jsonwebtoken_1.default.verify(refreshToken, env_1.env.JWT_REFRESH_SECRET);
            if (decoded.id !== userId) {
                throw new errorHandler_1.ApiError(401, 'Invalid refresh token');
            }
            const user = await db_1.db.query.users.findFirst({
                where: (0, drizzle_orm_1.eq)(schema_1.users.id, userId),
            });
            if (!user) {
                throw new errorHandler_1.ApiError(404, 'User not found');
            }
            const tokens = this.generateTokens(user.id, user.email, user.company_id, user.role);
            return tokens;
        }
        catch (error) {
            if (error instanceof errorHandler_1.ApiError)
                throw error;
            throw new errorHandler_1.ApiError(401, 'Token refresh failed');
        }
    }
    generateTokens(userId, email, companyId, role) {
        const accessToken = jsonwebtoken_1.default.sign({ id: userId, email, company_id: companyId, role }, env_1.env.JWT_SECRET, { expiresIn: env_1.env.JWT_EXPIRATION });
        const refreshToken = jsonwebtoken_1.default.sign({ id: userId }, env_1.env.JWT_REFRESH_SECRET, { expiresIn: env_1.env.JWT_REFRESH_EXPIRATION });
        return {
            accessToken,
            refreshToken,
            expiresIn: env_1.env.JWT_EXPIRATION,
        };
    }
}
exports.AuthService = AuthService;
exports.authService = new AuthService();
//# sourceMappingURL=auth.service.js.map