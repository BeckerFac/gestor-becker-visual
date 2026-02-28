import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class CustomersController {
    createCustomer(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getCustomers(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getCustomer(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateCustomer(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    deleteCustomer(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const customersController: CustomersController;
//# sourceMappingURL=customers.controller.d.ts.map