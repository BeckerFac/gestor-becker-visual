export declare class InvoicesService {
    createInvoice(companyId: string, userId: string, data: any): Promise<{
        invoice_type: "A" | "B" | "C" | null;
        id: string;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        status: "draft" | "pending" | "authorized" | "cancelled" | null;
        customer_id: string | null;
        invoice_number: number;
        invoice_date: Date;
        due_date: Date | null;
        subtotal: string;
        vat_amount: string;
        total_amount: string;
        cae: string | null;
        cae_expiry_date: Date | null;
        qr_code: string | null;
        afip_response: unknown;
        created_by: string | null;
    }>;
    getInvoices(companyId: string, { skip, limit }?: {
        skip?: number | undefined;
        limit?: number | undefined;
    }): Promise<{
        items: {
            invoice_type: "A" | "B" | "C" | null;
            id: string;
            created_at: Date | null;
            updated_at: Date | null;
            company_id: string;
            status: "draft" | "pending" | "authorized" | "cancelled" | null;
            customer_id: string | null;
            invoice_number: number;
            invoice_date: Date;
            due_date: Date | null;
            subtotal: string;
            vat_amount: string;
            total_amount: string;
            cae: string | null;
            cae_expiry_date: Date | null;
            qr_code: string | null;
            afip_response: unknown;
            created_by: string | null;
        }[];
        total: number;
        skip: number;
        limit: number;
    }>;
    getInvoice(companyId: string, invoiceId: string): Promise<{
        invoice_type: "A" | "B" | "C" | null;
        id: string;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        status: "draft" | "pending" | "authorized" | "cancelled" | null;
        customer_id: string | null;
        invoice_number: number;
        invoice_date: Date;
        due_date: Date | null;
        subtotal: string;
        vat_amount: string;
        total_amount: string;
        cae: string | null;
        cae_expiry_date: Date | null;
        qr_code: string | null;
        afip_response: unknown;
        created_by: string | null;
    }>;
    authorizeInvoice(companyId: string, invoiceId: string): Promise<{
        invoice_type: "A" | "B" | "C" | null;
        id: string;
        created_at: Date | null;
        updated_at: Date | null;
        company_id: string;
        status: "draft" | "pending" | "authorized" | "cancelled" | null;
        customer_id: string | null;
        invoice_number: number;
        invoice_date: Date;
        due_date: Date | null;
        subtotal: string;
        vat_amount: string;
        total_amount: string;
        cae: string | null;
        cae_expiry_date: Date | null;
        qr_code: string | null;
        afip_response: unknown;
        created_by: string | null;
    }>;
}
export declare const invoicesService: InvoicesService;
//# sourceMappingURL=invoices.service.d.ts.map