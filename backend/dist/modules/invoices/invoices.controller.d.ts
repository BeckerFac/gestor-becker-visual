import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class InvoicesController {
    createInvoice(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getInvoices(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getInvoice(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    authorizeInvoice(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const invoicesController: InvoicesController;
//# sourceMappingURL=invoices.controller.d.ts.map