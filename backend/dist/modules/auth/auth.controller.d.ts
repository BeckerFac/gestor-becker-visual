import { Request, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class AuthController {
    register(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    login(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    refreshToken(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    logout(req: Request, res: Response): void;
    getMe(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const authController: AuthController;
//# sourceMappingURL=auth.controller.d.ts.map