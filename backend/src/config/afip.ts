import { env } from './env'
import fs from 'fs'
import path from 'path'

export interface AfipConfig {
  cuit: string
  environment: 'homologacion' | 'produccion'
  certPath: string
  keyPath: string
  wsUrl: string
  tokenUrl: string
}

export function getAfipConfig(): AfipConfig {
  const env_mode = env.AFIP_ENV || 'homologacion'

  const wsUrl = env_mode === 'produccion'
    ? 'https://servicios1.afip.gov.ar/wsfe/service.asmx'
    : 'https://wswhomo.afip.gov.ar/wsfe/service.asmx'

  const tokenUrl = env_mode === 'produccion'
    ? 'https://servicios1.afip.gov.ar/wsaa/service.asmx'
    : 'https://wswhomo.afip.gov.ar/wsaa/service.asmx'

  return {
    cuit: env.AFIP_CUIT || '20000000191',
    environment: env_mode as 'homologacion' | 'produccion',
    certPath: env.AFIP_CERT_PATH || path.join(process.cwd(), 'certs', 'homolog.pem'),
    keyPath: env.AFIP_KEY_PATH || path.join(process.cwd(), 'certs', 'homolog-key.pem'),
    wsUrl,
    tokenUrl,
  }
}

export function validateAfipCerts(): boolean {
  const config = getAfipConfig()

  if (!fs.existsSync(config.certPath)) {
    console.warn(`⚠️  AFIP certificate not found at: ${config.certPath}`)
    return false
  }

  if (!fs.existsSync(config.keyPath)) {
    console.warn(`⚠️  AFIP key not found at: ${config.keyPath}`)
    return false
  }

  return true
}
