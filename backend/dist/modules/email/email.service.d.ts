export interface SendInvoiceEmailInput {
    invoiceId: string;
    recipientEmail: string;
    companyId: string;
    message?: string;
}
export declare class EmailService {
    private transporter;
    constructor();
    private initializeTransporter;
    sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<boolean>;
    sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean>;
    private generateEmailBody;
}
export declare const emailService: EmailService;
//# sourceMappingURL=email.service.d.ts.map