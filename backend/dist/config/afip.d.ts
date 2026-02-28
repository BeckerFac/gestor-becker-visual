export interface AfipConfig {
    cuit: string;
    environment: 'homologacion' | 'produccion';
    certPath: string;
    keyPath: string;
    wsUrl: string;
    tokenUrl: string;
}
export declare function getAfipConfig(): AfipConfig;
export declare function validateAfipCerts(): boolean;
//# sourceMappingURL=afip.d.ts.map