"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProduction = exports.isDevelopment = exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    // Server
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3000', 10),
    // Database
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://gestor_user:gestor_password_dev@localhost:5432/gestor_becker',
    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret_here',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'your_jwt_refresh_secret_here',
    JWT_EXPIRATION: process.env.JWT_EXPIRATION || '15m',
    JWT_REFRESH_EXPIRATION: process.env.JWT_REFRESH_EXPIRATION || '7d',
    // AFIP
    AFIP_ENV: (process.env.AFIP_ENV || 'homologacion'),
    AFIP_CUIT: process.env.AFIP_CUIT || '20123456789',
    AFIP_CERT_PATH: process.env.AFIP_CERT_PATH || './certs/test.pem',
    AFIP_KEY_PATH: process.env.AFIP_KEY_PATH || './certs/test.key',
    // Email
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
    SMTP_USER: process.env.SMTP_USER || 'your-email@gmail.com',
    SMTP_PASS: process.env.SMTP_PASS || 'your-app-password',
    SMTP_FROM: process.env.SMTP_FROM || 'noreply@gestorbecker.com',
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
};
exports.isDevelopment = exports.env.NODE_ENV === 'development';
exports.isProduction = exports.env.NODE_ENV === 'production';
//# sourceMappingURL=env.js.map