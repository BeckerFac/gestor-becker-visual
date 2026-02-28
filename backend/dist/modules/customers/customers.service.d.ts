export declare class CustomersService {
    createCustomer(companyId: string, data: any): Promise<{
        id: string;
        name: string;
        cuit: string;
        address: string | null;
        city: string | null;
        province: string | null;
        phone: string | null;
        email: string | null;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        contact_name: string | null;
        postal_code: string | null;
        tax_condition: string | null;
        credit_limit: string | null;
        payment_terms: number | null;
        status: string | null;
    }>;
    getCustomers(companyId: string, { skip, limit }?: {
        skip?: number | undefined;
        limit?: number | undefined;
    }): Promise<{
        items: {
            id: string;
            name: string;
            cuit: string;
            address: string | null;
            city: string | null;
            province: string | null;
            phone: string | null;
            email: string | null;
            created_at: Date | null;
            updated_at: Date | null;
            company_id: string;
            contact_name: string | null;
            postal_code: string | null;
            tax_condition: string | null;
            credit_limit: string | null;
            payment_terms: number | null;
            status: string | null;
        }[];
        total: number;
        skip: number;
        limit: number;
    }>;
    getCustomer(companyId: string, customerId: string): Promise<{
        id: string;
        name: string;
        cuit: string;
        address: string | null;
        city: string | null;
        province: string | null;
        phone: string | null;
        email: string | null;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        contact_name: string | null;
        postal_code: string | null;
        tax_condition: string | null;
        credit_limit: string | null;
        payment_terms: number | null;
        status: string | null;
    }>;
    updateCustomer(companyId: string, customerId: string, data: any): Promise<{
        id: string;
        name: string;
        cuit: string;
        address: string | null;
        city: string | null;
        province: string | null;
        phone: string | null;
        email: string | null;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        contact_name: string | null;
        postal_code: string | null;
        tax_condition: string | null;
        credit_limit: string | null;
        payment_terms: number | null;
        status: string | null;
    }>;
    deleteCustomer(companyId: string, customerId: string): Promise<{
        success: boolean;
    }>;
}
export declare const customersService: CustomersService;
//# sourceMappingURL=customers.service.d.ts.map