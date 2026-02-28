import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class PdfController {
    generateInvoicePdf(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    generateCatalogPdf(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const pdfController: PdfController;
//# sourceMappingURL=pdf.controller.d.ts.map