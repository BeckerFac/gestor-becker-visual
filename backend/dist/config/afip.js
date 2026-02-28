"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAfipConfig = getAfipConfig;
exports.validateAfipCerts = validateAfipCerts;
const env_1 = require("./env");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function getAfipConfig() {
    const env_mode = env_1.env.AFIP_ENV || 'homologacion';
    const wsUrl = env_mode === 'produccion'
        ? 'https://servicios1.afip.gov.ar/wsfe/service.asmx'
        : 'https://wswhomo.afip.gov.ar/wsfe/service.asmx';
    const tokenUrl = env_mode === 'produccion'
        ? 'https://servicios1.afip.gov.ar/wsaa/service.asmx'
        : 'https://wswhomo.afip.gov.ar/wsaa/service.asmx';
    return {
        cuit: env_1.env.AFIP_CUIT || '20000000191',
        environment: env_mode,
        certPath: env_1.env.AFIP_CERT_PATH || path_1.default.join(process.cwd(), 'certs', 'homolog.pem'),
        keyPath: env_1.env.AFIP_KEY_PATH || path_1.default.join(process.cwd(), 'certs', 'homolog-key.pem'),
        wsUrl,
        tokenUrl,
    };
}
function validateAfipCerts() {
    const config = getAfipConfig();
    if (!fs_1.default.existsSync(config.certPath)) {
        console.warn(`⚠️  AFIP certificate not found at: ${config.certPath}`);
        return false;
    }
    if (!fs_1.default.existsSync(config.keyPath)) {
        console.warn(`⚠️  AFIP key not found at: ${config.keyPath}`);
        return false;
    }
    return true;
}
//# sourceMappingURL=afip.js.map