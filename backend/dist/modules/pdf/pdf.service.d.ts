export interface InvoicePdfInput {
    invoiceId: string;
    companyName: string;
    companyAddress?: string;
    companyPhone?: string;
    companyEmail?: string;
}
export declare class PdfService {
    private browser;
    initialize(): Promise<void>;
    generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer>;
    private generateInvoiceHtml;
    generateCatalogPdf(products: any[], companyName: string): Promise<Buffer>;
    private generateCatalogHtml;
    close(): Promise<void>;
}
export declare const pdfService: PdfService;
//# sourceMappingURL=pdf.service.d.ts.map