import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
export declare class ProductsController {
    createProduct(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getProducts(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getProduct(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateProduct(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    deleteProduct(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const productsController: ProductsController;
//# sourceMappingURL=products.controller.d.ts.map