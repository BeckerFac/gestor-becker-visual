export interface AuthorizeInvoiceInput {
    invoiceId: string;
    invoiceNumber: number;
    invoiceType: 'A' | 'B' | 'C';
    customerId: string;
    subtotal: number;
    vat: number;
    total: number;
    items?: Array<{
        quantity: number;
        unitPrice: number;
        description: string;
    }>;
}
export interface AfipAuthorizationResult {
    cae: string;
    caeExpirationDate: string;
    invoiceNumber: number;
    invoiceType: string;
}
export declare class AfipService {
    /**
     * Authorizes an invoice with AFIP
     * In homologación (sandbox), returns mock CAE
     * In producción, contacts real AFIP WebService
     */
    authorizeInvoice(input: AuthorizeInvoiceInput): Promise<AfipAuthorizationResult>;
    /**
     * Generate mock CAE for testing/homologación
     */
    private generateMockAuthorization;
    /**
     * Authorize with real AFIP WebService (requires certificates)
     */
    private authorizeWithAfip;
    /**
     * Save authorized invoice to database
     */
    saveAuthorizedInvoice(invoiceId: string, authorization: AfipAuthorizationResult): Promise<void>;
    /**
     * Get AFIP token from service (production)
     * For development/testing, returns null
     */
    getAfipToken(): Promise<string | null>;
    /**
     * Verify CUIT with AFIP (checks if customer exists)
     */
    verifyCuit(cuit: string): Promise<{
        valid: boolean;
        name?: string;
    }>;
}
export declare const afipService: AfipService;
//# sourceMappingURL=afip.service.d.ts.map