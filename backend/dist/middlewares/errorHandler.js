"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = exports.errorHandler = exports.ApiError = void 0;
class ApiError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError';
    }
}
exports.ApiError = ApiError;
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({ error: err.message });
    }
    if (err.message.includes('duplicate key')) {
        return res.status(409).json({ error: 'Resource already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
};
exports.errorHandler = errorHandler;
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
exports.asyncHandler = asyncHandler;
//# sourceMappingURL=errorHandler.js.map