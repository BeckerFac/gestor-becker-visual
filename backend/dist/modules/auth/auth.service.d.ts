export declare class AuthService {
    register(email: string, password: string, name: string, company_name: string, cuit: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: string;
        user: {
            id: string;
            name: string;
            email: string;
            role: "admin" | "gerente" | "vendedor" | "contable" | "viewer" | null;
        };
        company: {
            id: string;
            name: string;
            cuit: string;
            address: string | null;
            city: string | null;
            province: string | null;
            logo_url: string | null;
            phone: string | null;
            email: string | null;
            afip_cert: string | null;
            afip_key: string | null;
            afip_env: string | null;
            created_at: Date | null;
            updated_at: Date | null;
        };
    }>;
    login(email: string, password: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: string;
        user: {
            id: string;
            email: string;
            name: string;
            role: "admin" | "gerente" | "vendedor" | "contable" | "viewer" | null;
            company_id: string;
        };
    }>;
    refreshToken(userId: string, refreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: string;
    }>;
    private generateTokens;
}
export declare const authService: AuthService;
//# sourceMappingURL=auth.service.d.ts.map