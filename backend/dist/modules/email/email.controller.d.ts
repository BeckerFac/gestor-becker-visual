import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class EmailController {
    sendInvoiceEmail(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>>>;
    testEmail(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>>>;
}
export declare const emailController: EmailController;
//# sourceMappingURL=email.controller.d.ts.map