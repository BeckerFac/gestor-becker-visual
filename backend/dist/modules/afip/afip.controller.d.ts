import { Request, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class AfipController {
    authorizeInvoice(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>>>;
    verifyCuit(req: Request, res: Response): Promise<Response<any, Record<string, any>>>;
    getAuthorizedInvoices(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>>>;
}
export declare const afipController: AfipController;
//# sourceMappingURL=afip.controller.d.ts.map