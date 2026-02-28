export declare class ProductsService {
    createProduct(companyId: string, data: any): Promise<{
        id: string;
        name: string;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        active: boolean | null;
        description: string | null;
        sku: string;
        barcode: string | null;
        category_id: string | null;
        brand_id: string | null;
        image_url: string | null;
    }>;
    getProducts(companyId: string, { skip, limit, search }?: {
        skip?: number | undefined;
        limit?: number | undefined;
        search?: string | undefined;
    }): Promise<{
        items: {
            id: string;
            name: string;
            created_at: Date | null;
            updated_at: Date | null;
            company_id: string;
            active: boolean | null;
            description: string | null;
            sku: string;
            barcode: string | null;
            category_id: string | null;
            brand_id: string | null;
            image_url: string | null;
        }[];
        total: number;
        skip: number;
        limit: number;
    }>;
    getProduct(companyId: string, productId: string): Promise<{
        id: string;
        name: string;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        active: boolean | null;
        description: string | null;
        sku: string;
        barcode: string | null;
        category_id: string | null;
        brand_id: string | null;
        image_url: string | null;
    }>;
    updateProduct(companyId: string, productId: string, data: any): Promise<{
        id: string;
        name: string;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        active: boolean | null;
        description: string | null;
        sku: string;
        barcode: string | null;
        category_id: string | null;
        brand_id: string | null;
        image_url: string | null;
    }>;
    deleteProduct(companyId: string, productId: string): Promise<{
        success: boolean;
    }>;
}
export declare const productsService: ProductsService;
//# sourceMappingURL=products.service.d.ts.map