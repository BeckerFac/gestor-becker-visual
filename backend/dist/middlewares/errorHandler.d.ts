import { Request, Response, NextFunction } from 'express';
export declare class ApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string);
}
export declare const errorHandler: (err: Error, req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const asyncHandler: (fn: Function) => (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=errorHandler.d.ts.map