import { db, pool } from '../../config/db'
import { invoices, companies } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { ApiError } from '../../middlewares/errorHandler'
import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'
import forge from 'node-forge'

// ==================== TYPES ====================

export interface AuthorizeInvoiceInput {
  invoiceId: string
  invoiceNumber: number
  invoiceType: 'A' | 'B' | 'C' | 'NC_A' | 'NC_B' | 'NC_C' | 'ND_A' | 'ND_B' | 'ND_C' | 'FCE_A' | 'FCE_B' | 'FCE_C' | 'NC_FCE_A' | 'NC_FCE_B' | 'NC_FCE_C' | 'ND_FCE_A' | 'ND_FCE_B' | 'ND_FCE_C' | 'E' | 'ND_E' | 'NC_E'
  customerCuit: string
  subtotal: number
  vat: number
  total: number
  invoiceDate: Date
  puntoVenta: number
  concepto: 1 | 2 | 3 // 1=Productos, 2=Servicios, 3=Productos y Servicios
  condicionIvaReceptorId?: number // AFIP RG 5616 - mandatory from 01/04/2026
  // Service date fields (mandatory when concepto=2 or 3)
  fchServDesde?: string   // YYYYMMDD format
  fchServHasta?: string   // YYYYMMDD format
  fchVtoPago?: string     // YYYYMMDD format
  items?: Array<{
    quantity: number
    unitPrice: number
    vatRate: number
    description: string
  }>
  // FCE MiPyME fields
  isFce?: boolean
  fceData?: {
    fchVtoPago: Date       // Fecha vencimiento pago (mandatory for FCE)
    cbu: string            // CBU 22 digits (mandatory for FCE)
    cbuAlias?: string      // Alias CBU (alternative to CBU)
  }
  cbtesAsoc?: Array<{     // For NC/ND FCE - associated vouchers
    tipo: number
    ptoVta: number
    nro: number
    cuit: string
    cbteFch: string        // YYYYMMDD
  }>
}

export interface AfipAuthorizationResult {
  cae: string
  caeExpirationDate: string
  invoiceNumber: number
  invoiceType: string
  qrCode: string | null
  afipResponse: any
}

interface WsaaToken {
  token: string
  sign: string
  expiresAt: Date
}

// ==================== CONSTANTS ====================

// AFIP Invoice type codes (CbteTipo)
const INVOICE_TYPE_MAP: Record<string, number> = {
  'A': 1, 'B': 6, 'C': 11,
  // Notas de Credito / Debito normales
  'NC_A': 3, 'NC_B': 8, 'NC_C': 13,
  'ND_A': 2, 'ND_B': 7, 'ND_C': 12,
  // FCE MiPyME (Factura de Credito Electronica)
  'FCE_A': 201, 'FCE_B': 206, 'FCE_C': 211,
  // NC FCE
  'NC_FCE_A': 203, 'NC_FCE_B': 208, 'NC_FCE_C': 213,
  // ND FCE
  'ND_FCE_A': 202, 'ND_FCE_B': 207, 'ND_FCE_C': 212,
  // Factura de Exportacion (Tipo E) - TODO: WSFEX integration for export invoices
  'E': 19, 'ND_E': 20, 'NC_E': 21,
}

// FCE CbteTipo codes for quick lookup
const FCE_CBTE_TIPOS = [201, 202, 203, 206, 207, 208, 211, 212, 213]

// NC/ND normal CbteTipo codes (require CbtesAsoc)
const NC_ND_CBTE_TIPOS = [2, 3, 7, 8, 12, 13]

// Export CbteTipo codes
const EXPORT_CBTE_TIPOS = [19, 20, 21]

// AFIP IVA rate codes
const IVA_RATE_MAP: Record<number, number> = {
  0: 3, 10.5: 4, 21: 5, 27: 6,
}

// AFIP URLs
const AFIP_URLS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
  },
}

// ==================== TOKEN CACHE ====================

const tokenCache: Map<string, WsaaToken> = new Map()

// ==================== SERVICE ====================

export class AfipService {

  // ==================== PUBLIC METHODS ====================

  /**
   * Authorize an invoice with AFIP
   */
  async authorizeInvoice(companyId: string, input: AuthorizeInvoiceInput): Promise<AfipAuthorizationResult> {
    const company = await this.getCompany(companyId)

    // If no certificates configured, use mock
    if (!company.afip_cert || !company.afip_key) {
      console.log('AFIP: No certificates configured, using mock authorization')
      return this.generateMockAuthorization(input, company.cuit)
    }

    try {
      return await this.authorizeWithAfip(company, input)
    } catch (error: any) {
      console.error('AFIP authorization error:', error.message)

      // Timeout recovery: check if AFIP actually authorized despite timeout
      if (this.isTimeoutError(error) && company.afip_cert && company.afip_key) {
        console.log('AFIP: Timeout detected, attempting recovery via FECompConsultar...')
        try {
          const cbteTipo = INVOICE_TYPE_MAP[input.invoiceType] || 6
          const ptoVta = input.puntoVenta || 1
          // Get the last authorized number to check
          const lastNum = await this.getLastVoucherNumber(companyId, ptoVta, input.invoiceType)
          if (lastNum > 0) {
            const consultResult = await this.consultarComprobante(companyId, ptoVta, input.invoiceType, lastNum)
            if (consultResult && consultResult.Resultado === 'A') {
              console.log('AFIP: Recovery successful, invoice was authorized')
              const cae = String(consultResult.CodAutorizacion)
              const caeExpStr = String(consultResult.FchVto)
              const caeYear = parseInt(caeExpStr.substring(0, 4))
              const caeMonth = parseInt(caeExpStr.substring(4, 6)) - 1
              const caeDay = parseInt(caeExpStr.substring(6, 8))
              const caeExpirationDate = new Date(caeYear, caeMonth, caeDay)
              return {
                cae,
                caeExpirationDate: caeExpirationDate.toISOString().split('T')[0],
                invoiceNumber: lastNum,
                invoiceType: input.invoiceType,
                qrCode: null,
                afipResponse: { recovered: true, consultResult },
              }
            }
          }
        } catch (recoveryError: any) {
          console.error('AFIP: Recovery attempt failed:', recoveryError.message)
        }
      }

      // In homologacion, fall back to mock if AFIP fails
      if (company.afip_env !== 'produccion') {
        console.log('AFIP: Falling back to mock (homologacion)')
        return this.generateMockAuthorization(input, company.cuit)
      }
      throw new ApiError(500, `Error AFIP: ${error.message}`)
    }
  }

  /**
   * Save authorization to database
   */
  async saveAuthorizedInvoice(invoiceId: string, authorization: AfipAuthorizationResult): Promise<void> {
    await db.update(invoices).set({
      cae: authorization.cae,
      cae_expiry_date: new Date(authorization.caeExpirationDate),
      qr_code: authorization.qrCode,
      status: 'authorized',
      invoice_number: authorization.invoiceNumber,
      afip_response: authorization.afipResponse,
      updated_at: new Date(),
    }).where(eq(invoices.id, invoiceId))
  }

  /**
   * Get last voucher number from AFIP
   */
  async getLastVoucherNumber(companyId: string, puntoVenta: number, invoiceType: string): Promise<number> {
    try {
      const company = await this.getCompany(companyId)
      if (!company.afip_cert || !company.afip_key) return 0

      const { token, sign } = await this.getWsaaToken(company, 'wsfe')
      const env = (company.afip_env === 'produccion') ? 'produccion' : 'homologacion'
      const cbteTipo = INVOICE_TYPE_MAP[invoiceType] || 6

      const soapBody = this.buildFECompUltimoAutorizadoRequest(
        token, sign, company.cuit, puntoVenta, cbteTipo
      )

      const response = await this.callWsfe(env, 'FECompUltimoAutorizado', soapBody)
      const result = response?.FECompUltimoAutorizadoResult || response
      return result?.CbteNro || 0
    } catch {
      return 0
    }
  }

  /**
   * Test AFIP connection
   */
  async testConnection(companyId: string): Promise<{ success: boolean; message: string; serverStatus?: any }> {
    try {
      const company = await this.getCompany(companyId)
      if (!company.afip_cert || !company.afip_key) {
        return { success: false, message: 'No hay certificados AFIP configurados' }
      }

      console.log('AFIP Test: Getting WSAA token...')
      console.log('AFIP Test: Cert length:', company.afip_cert.length, 'Key length:', company.afip_key.length)
      console.log('AFIP Test: Env:', company.afip_env)

      const { token, sign } = await this.getWsaaToken(company, 'wsfe')
      console.log('AFIP Test: Got token, length:', token.length)

      const env = (company.afip_env === 'produccion') ? 'produccion' : 'homologacion'

      const soapBody = this.buildFEDummyRequest()
      const response = await this.callWsfe(env, 'FEDummy', soapBody)

      const result = response?.FEDummyResult || response

      // Save successful test result
      try {
        await pool.query(
          `UPDATE companies SET afip_last_test = NOW(), afip_last_test_ok = $1 WHERE id = $2`,
          [true, companyId]
        )
      } catch (_) {}

      return {
        success: true,
        message: `Conexión exitosa. AppServer: ${result?.AppServer}, DbServer: ${result?.DbServer}, AuthServer: ${result?.AuthServer}`,
        serverStatus: result,
      }
    } catch (error: any) {
      console.error('AFIP Test Connection error:', error.message)
      if (error.response?.data) {
        console.error('AFIP response:', typeof error.response.data === 'string' ? error.response.data.substring(0, 500) : error.response.data)
      }
      // Save failed test result
      try {
        await pool.query(
          `UPDATE companies SET afip_last_test = NOW(), afip_last_test_ok = $1 WHERE id = $2`,
          [false, companyId]
        )
      } catch (_) {}
      return { success: false, message: `Error: ${error.message}` }
    }
  }

  /**
   * Verify a voucher exists in AFIP using FECompConsultar
   */
  async consultarComprobante(
    companyId: string,
    puntoVenta: number,
    invoiceType: string,
    cbteNro: number
  ): Promise<any> {
    const company = await this.getCompany(companyId)
    if (!company.afip_cert || !company.afip_key) {
      throw new ApiError(400, 'No hay certificados AFIP configurados')
    }

    const { token, sign } = await this.getWsaaToken(company, 'wsfe')
    const env = (company.afip_env === 'produccion') ? 'produccion' : 'homologacion'
    const cbteTipo = INVOICE_TYPE_MAP[invoiceType] || 6
    const cleanCuit = company.cuit.replace(/-/g, '')

    const soapBody = `<FECompConsultar xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
      <FeCompConsReq>
        <CbteTipo>${cbteTipo}</CbteTipo>
        <CbteNro>${cbteNro}</CbteNro>
        <PtoVta>${puntoVenta}</PtoVta>
      </FeCompConsReq>
    </FECompConsultar>`

    const rawResponse = await this.callWsfe(env, 'FECompConsultar', soapBody)
    const result = rawResponse?.FECompConsultarResult || rawResponse

    if (result?.Errors) {
      const errors = Array.isArray(result.Errors.Err)
        ? result.Errors.Err
        : [result.Errors.Err]
      const errorMsg = errors.map((e: any) => `${e.Code}: ${e.Msg}`).join(', ')
      throw new ApiError(404, `AFIP: ${errorMsg}`)
    }

    return result?.ResultGet || result
  }

  /**
   * Verify CUIT (simple validation, no AFIP call needed)
   */
  async verifyCuit(_companyId: string, cuit: string): Promise<{ valid: boolean; name?: string }> {
    const clean = cuit.replace(/-/g, '')
    if (clean.length !== 11 || !/^\d+$/.test(clean)) {
      return { valid: false }
    }
    // Modulo 11 checksum
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    const digits = clean.split('').map(Number)
    const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0)
    const remainder = sum % 11
    const expected = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder
    if (digits[10] !== expected) {
      return { valid: false }
    }
    return { valid: true }
  }

  /**
   * Static CUIT validation with Modulo 11 (no AFIP call needed)
   */
  static isValidCuit(cuit: string): boolean {
    const clean = cuit.replace(/-/g, '')
    if (clean.length !== 11 || !/^\d+$/.test(clean)) return false
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    const digits = clean.split('').map(Number)
    const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0)
    const remainder = sum % 11
    const expected = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder
    return digits[10] === expected
  }

  // ==================== WSAA AUTHENTICATION ====================

  /**
   * Get WSAA token for a service (cached)
   */
  private async getWsaaToken(company: any, service: string): Promise<{ token: string; sign: string }> {
    const cacheKey = `${company.id}-${service}`
    const cached = tokenCache.get(cacheKey)

    if (cached && cached.expiresAt > new Date()) {
      return { token: cached.token, sign: cached.sign }
    }

    // Generate TRA (Ticket de Requerimiento de Acceso)
    const tra = this.generateTRA(service)

    // Sign TRA with CMS using company certificate
    const cms = this.signTRA(tra, company.afip_cert, company.afip_key)

    // Call WSAA LoginCms
    const env = (company.afip_env === 'produccion') ? 'produccion' : 'homologacion'
    const wsaaUrl = AFIP_URLS[env].wsaa

    const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`

    const response = await axios.post(
      wsaaUrl.replace('?WSDL', ''),
      soapEnvelope,
      {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '',
        },
        timeout: 30000,
      }
    )

    // Parse WSAA response
    const parser = new XMLParser({ ignoreAttributes: false })
    const parsed = parser.parse(response.data)

    const loginReturn = this.extractValue(parsed, 'loginCmsReturn') ||
                        this.extractValue(parsed, 'loginCmsResponse')

    if (!loginReturn) {
      throw new Error('Respuesta WSAA inválida')
    }

    // loginReturn is an XML string, parse it
    const loginData = parser.parse(typeof loginReturn === 'string' ? loginReturn : JSON.stringify(loginReturn))

    const credentials = loginData?.loginTicketResponse?.credentials
    if (!credentials) {
      throw new Error('No se pudieron obtener credenciales de WSAA')
    }

    const token = credentials.token
    const sign = credentials.sign

    // Cache token (expires in ~12 hours, cache for 11)
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 11)
    tokenCache.set(cacheKey, { token, sign, expiresAt })

    return { token, sign }
  }

  /**
   * Generate TRA XML
   */
  private generateTRA(service: string): string {
    const now = new Date()
    const generationTime = new Date(now.getTime() - 600000) // 10 min before
    const expirationTime = new Date(now.getTime() + 600000) // 10 min after

    // Format as ISO 8601 in UTC with Z suffix (AFIP accepts this)
    const formatDate = (d: Date) => d.toISOString()

    return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${formatDate(generationTime)}</generationTime>
    <expirationTime>${formatDate(expirationTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`
  }

  /**
   * Sign TRA with CMS (PKCS#7) using node-forge (pure JS, no openssl needed)
   */
  private signTRA(tra: string, cert: string, key: string): string {
    try {
      const certificate = forge.pki.certificateFromPem(cert)
      const privateKey = forge.pki.privateKeyFromPem(key)

      // Create PKCS#7 signed data
      const p7 = forge.pkcs7.createSignedData()
      p7.content = forge.util.createBuffer(tra, 'utf8')
      p7.addCertificate(certificate)
      p7.addSigner({
        key: privateKey,
        certificate: certificate,
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
        ],
      })

      p7.sign()

      // Convert to DER then base64
      const asn1 = p7.toAsn1()
      const der = forge.asn1.toDer(asn1)
      return forge.util.encode64(der.getBytes())
    } catch (error: any) {
      throw new Error(`Error firmando TRA: ${error.message}`)
    }
  }

  // ==================== WSFE (ELECTRONIC BILLING) ====================

  /**
   * Authorize invoice with real AFIP WSFE
   */
  private async authorizeWithAfip(company: any, input: AuthorizeInvoiceInput): Promise<AfipAuthorizationResult> {
    const { token, sign } = await this.getWsaaToken(company, 'wsfe')
    const env = (company.afip_env === 'produccion') ? 'produccion' : 'homologacion'

    const cbteTipo = INVOICE_TYPE_MAP[input.invoiceType] || 6
    const ptoVta = input.puntoVenta || 1

    // Get last voucher from AFIP to ensure correct sequence
    const lastVoucherBody = this.buildFECompUltimoAutorizadoRequest(
      token, sign, company.cuit, ptoVta, cbteTipo
    )
    const lastVoucherResp = await this.callWsfe(env, 'FECompUltimoAutorizado', lastVoucherBody)
    const lastVoucherResult = lastVoucherResp?.FECompUltimoAutorizadoResult || lastVoucherResp
    const lastNumber = lastVoucherResult?.CbteNro || 0
    const cbteNro = lastNumber + 1

    // Determine doc type - validate CUIT with modulo 11 before assigning DocTipo=80
    let docTipo = 99 // Consumidor Final
    let docNro = 0
    const cleanCuit = input.customerCuit?.replace(/-/g, '') || ''
    if (cleanCuit.length === 11 && /^\d+$/.test(cleanCuit) && AfipService.isValidCuit(cleanCuit)) {
      docTipo = 80 // CUIT verified
      docNro = parseInt(cleanCuit)
    }

    // Factura C / NC_C / ND_C (Monotributo): NO se informa IVA, todo va como ImpNeto
    // Factura A/B: se informa IVA desglosado
    const isFacturaC = [11, 12, 13].includes(cbteTipo)
    const ivaItems = isFacturaC ? [] : this.buildIvaArray(input)

    // Calculate ImpTotConc (no gravado) and ImpOpEx (exento) from items with IVA 0%
    let impTotConc = 0
    let impOpEx = 0
    let impNetoGravado = 0
    if (!isFacturaC && input.items) {
      for (const item of input.items) {
        const lineTotal = item.quantity * item.unitPrice
        if (item.vatRate === 0) {
          // Items with 0% IVA are "no gravado" (ImpTotConc)
          impTotConc += lineTotal
        } else {
          impNetoGravado += lineTotal
        }
      }
    } else if (!isFacturaC) {
      impNetoGravado = input.subtotal
    }

    const concepto = input.concepto || 1 // 1=Productos, 2=Servicios, 3=Ambos

    // Format date
    const fchDate = this.formatAfipDate(input.invoiceDate)

    // Resolve CondicionIVAReceptorId (AFIP RG 5616 - mandatory from 01/04/2026)
    let condicionIvaReceptorId = input.condicionIvaReceptorId
    if (!condicionIvaReceptorId) {
      // Default logic based on invoice type and document type
      if (docTipo === 99) {
        condicionIvaReceptorId = 5 // Consumidor Final
      } else if ([1, 2, 3].includes(cbteTipo)) {
        // Tipo A (Factura/NC/ND) -> RI by default
        condicionIvaReceptorId = 1
      } else if ([11, 12, 13].includes(cbteTipo)) {
        // Tipo C (Factura/NC/ND) -> Consumidor Final by default
        condicionIvaReceptorId = 5
      } else {
        // Factura B -> Consumidor Final by default
        condicionIvaReceptorId = 5
      }
    }

    // Build FCE-specific data if applicable
    const isFce = input.isFce || FCE_CBTE_TIPOS.includes(cbteTipo)
    let fceFields: any = {}
    if (isFce && input.fceData) {
      // FchVtoPago (mandatory for FCE)
      if (input.fceData.fchVtoPago) {
        fceFields.FchVtoPago = this.formatAfipDate(new Date(input.fceData.fchVtoPago))
      }
      // Opcionales: CBU (Id=2101) and SCA (Id=27)
      const opcionales: Array<{ Id: number; Valor: string }> = []
      if (input.fceData.cbu) {
        opcionales.push({ Id: 2101, Valor: input.fceData.cbu })
      } else if (input.fceData.cbuAlias) {
        opcionales.push({ Id: 2102, Valor: input.fceData.cbuAlias })
      }
      opcionales.push({ Id: 27, Valor: 'SCA' })
      fceFields.Opcionales = opcionales
    }

    // CbtesAsoc for NC/ND (both FCE and normal)
    // NC/ND normal types (2,3,7,8,12,13) require CbtesAsoc just like FCE NC/ND
    if (NC_ND_CBTE_TIPOS.includes(cbteTipo) && (!input.cbtesAsoc || input.cbtesAsoc.length === 0)) {
      throw new Error('NC/ND requiere comprobante asociado (CbtesAsoc)')
    }

    let cbtesAsocFields: any = {}
    if (input.cbtesAsoc && input.cbtesAsoc.length > 0) {
      cbtesAsocFields.CbtesAsoc = input.cbtesAsoc.map(asoc => ({
        Tipo: asoc.tipo,
        PtoVta: asoc.ptoVta,
        Nro: asoc.nro,
        Cuit: asoc.cuit.replace(/-/g, ''),
        CbteFch: asoc.cbteFch,
      }))
    }

    // Service date fields (mandatory for concepto 2 or 3)
    const serviceDateFields: Record<string, string | undefined> = {}
    if (concepto !== 1) {
      serviceDateFields.FchServDesde = input.fchServDesde || fchDate
      serviceDateFields.FchServHasta = input.fchServHasta || fchDate
      serviceDateFields.FchVtoPago = input.fchVtoPago || fchDate
    }

    // Build FECAESolicitar request
    const soapBody = this.buildFECAESolicitarRequest(
      token, sign, company.cuit, {
        CantReg: 1,
        PtoVta: ptoVta,
        CbteTipo: cbteTipo,
        Concepto: concepto,
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: cbteNro,
        CbteHasta: cbteNro,
        CbteFch: fchDate,
        ImpTotal: this.round2(input.total),
        ImpTotConc: this.round2(impTotConc),
        ImpNeto: isFacturaC ? this.round2(input.total) : this.round2(impNetoGravado),
        ImpOpEx: this.round2(impOpEx),
        ImpIVA: isFacturaC ? 0 : this.round2(input.vat),
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
        Iva: ivaItems,
        CondicionIVAReceptorId: condicionIvaReceptorId,
        ...serviceDateFields,
        ...fceFields,
        ...cbtesAsocFields,
      }
    )

    const rawResponse = await this.callWsfe(env, 'FECAESolicitar', soapBody)
    console.log('AFIP raw response keys:', Object.keys(rawResponse || {}))
    // Response may be wrapped in FECAESolicitarResult or directly contain FeCabResp
    const result = rawResponse?.FECAESolicitarResult || rawResponse

    console.log('AFIP FECAESolicitar result keys:', Object.keys(result || {}))

    // Check for errors
    if (result?.Errors) {
      const errors = Array.isArray(result.Errors.Err)
        ? result.Errors.Err
        : [result.Errors.Err]
      const errorMsg = errors.map((e: any) => `${e.Code}: ${e.Msg}`).join(', ')
      throw new Error(`AFIP rechazó la factura: ${errorMsg}`)
    }

    const det = result?.FeDetResp?.FECAEDetResponse
    if (!det) {
      console.error('AFIP: unexpected response structure:', JSON.stringify(result, null, 2))
      throw new Error('AFIP: respuesta vacía de FECAESolicitar')
    }

    // Log observations (warnings) even on success
    if (det.Observaciones?.Obs) {
      const obs = Array.isArray(det.Observaciones.Obs) ? det.Observaciones.Obs : [det.Observaciones.Obs]
      console.log('AFIP Observaciones:', obs.map((o: any) => `${o.Code}: ${o.Msg}`).join(', '))
    }

    if (det.Resultado !== 'A') {
      const obs = det?.Observaciones?.Obs
      const obsMsg = obs
        ? (Array.isArray(obs) ? obs : [obs]).map((o: any) => `${o.Code}: ${o.Msg}`).join(', ')
        : 'Sin observaciones'
      throw new Error(`AFIP no autorizó la factura: ${obsMsg}`)
    }

    const cae = String(det.CAE)
    const caeExpDateStr = String(det.CAEFchVto) // YYYYMMDD

    const caeYear = parseInt(caeExpDateStr.substring(0, 4))
    const caeMonth = parseInt(caeExpDateStr.substring(4, 6)) - 1
    const caeDay = parseInt(caeExpDateStr.substring(6, 8))
    const caeExpirationDate = new Date(caeYear, caeMonth, caeDay)

    // Generate QR code
    const qrData = this.generateQrData({
      fecha: input.invoiceDate,
      cuit: company.cuit,
      ptoVta,
      tipoCmp: cbteTipo,
      nroCmp: cbteNro,
      importe: input.total,
      moneda: 'PES',
      tipoDocRec: docTipo,
      nroDocRec: docNro,
      cae,
      caeExpDate: caeExpirationDate,
    })

    return {
      cae,
      caeExpirationDate: caeExpirationDate.toISOString().split('T')[0],
      invoiceNumber: cbteNro,
      invoiceType: input.invoiceType,
      qrCode: qrData,
      afipResponse: result,
    }
  }

  // ==================== WSFE SOAP BUILDERS ====================

  private buildFEDummyRequest(): string {
    return `<FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" />`
  }

  private buildFECompUltimoAutorizadoRequest(
    token: string, sign: string, cuit: string, ptoVta: number, cbteTipo: number
  ): string {
    const cleanCuit = cuit.replace(/-/g, '')
    return `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
      <PtoVta>${ptoVta}</PtoVta>
      <CbteTipo>${cbteTipo}</CbteTipo>
    </FECompUltimoAutorizado>`
  }

  private buildFECAESolicitarRequest(
    token: string, sign: string, cuit: string, data: any
  ): string {
    const cleanCuit = cuit.replace(/-/g, '')

    let ivaXml = ''
    if (data.Iva && data.Iva.length > 0) {
      const ivaItems = data.Iva.map((iva: any) =>
        `<AlicIva>
          <Id>${iva.Id}</Id>
          <BaseImp>${iva.BaseImp}</BaseImp>
          <Importe>${iva.Importe}</Importe>
        </AlicIva>`
      ).join('')
      ivaXml = `<Iva>${ivaItems}</Iva>`
    }

    // Service date fields (concepto 2 or 3)
    const fchServDesdeXml = data.FchServDesde ? `<FchServDesde>${data.FchServDesde}</FchServDesde>` : ''
    const fchServHastaXml = data.FchServHasta ? `<FchServHasta>${data.FchServHasta}</FchServHasta>` : ''

    // FchVtoPago: mandatory for services (concepto 2/3) and FCE invoices
    const isFce = FCE_CBTE_TIPOS.includes(data.CbteTipo)
    const fchVtoPagoXml = (data.FchVtoPago || (isFce && data.FchVtoPago))
      ? `<FchVtoPago>${data.FchVtoPago}</FchVtoPago>`
      : ''

    // FCE: Opcionales node with CBU (Id=2101) and SCA (Id=27)
    let opcionalesXml = ''
    if (isFce && data.Opcionales && data.Opcionales.length > 0) {
      const opcItems = data.Opcionales.map((opc: any) =>
        `<Opcional>
          <Id>${opc.Id}</Id>
          <Valor>${opc.Valor}</Valor>
        </Opcional>`
      ).join('')
      opcionalesXml = `<Opcionales>${opcItems}</Opcionales>`
    }

    // CbtesAsoc: for NC/ND FCE (associated vouchers)
    let cbtesAsocXml = ''
    if (data.CbtesAsoc && data.CbtesAsoc.length > 0) {
      const asocItems = data.CbtesAsoc.map((asoc: any) =>
        `<CbteAsoc>
          <Tipo>${asoc.Tipo}</Tipo>
          <PtoVta>${asoc.PtoVta}</PtoVta>
          <Nro>${asoc.Nro}</Nro>
          <Cuit>${asoc.Cuit}</Cuit>
          <CbteFch>${asoc.CbteFch}</CbteFch>
        </CbteAsoc>`
      ).join('')
      cbtesAsocXml = `<CbtesAsoc>${asocItems}</CbtesAsoc>`
    }

    return `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
      <FeCAEReq>
        <FeCabReq>
          <CantReg>${data.CantReg}</CantReg>
          <PtoVta>${data.PtoVta}</PtoVta>
          <CbteTipo>${data.CbteTipo}</CbteTipo>
        </FeCabReq>
        <FeDetReq>
          <FECAEDetRequest>
            <Concepto>${data.Concepto}</Concepto>
            <DocTipo>${data.DocTipo}</DocTipo>
            <DocNro>${data.DocNro}</DocNro>
            <CbteDesde>${data.CbteDesde}</CbteDesde>
            <CbteHasta>${data.CbteHasta}</CbteHasta>
            <CbteFch>${data.CbteFch}</CbteFch>
            ${fchServDesdeXml}
            ${fchServHastaXml}
            ${fchVtoPagoXml}
            <ImpTotal>${data.ImpTotal}</ImpTotal>
            <ImpTotConc>${data.ImpTotConc}</ImpTotConc>
            <ImpNeto>${data.ImpNeto}</ImpNeto>
            <ImpOpEx>${data.ImpOpEx}</ImpOpEx>
            <ImpIVA>${data.ImpIVA}</ImpIVA>
            <ImpTrib>${data.ImpTrib}</ImpTrib>
            <CondicionIVAReceptorId>${data.CondicionIVAReceptorId || 5}</CondicionIVAReceptorId>
            <MonId>${data.MonId}</MonId>
            <MonCotiz>${data.MonCotiz}</MonCotiz>
            ${ivaXml}
            ${cbtesAsocXml}
            ${opcionalesXml}
          </FECAEDetRequest>
        </FeDetReq>
      </FeCAEReq>
    </FECAESolicitar>`
  }

  /**
   * Call WSFE SOAP service
   */
  private async callWsfe(env: 'homologacion' | 'produccion', method: string, body: string): Promise<any> {
    const url = AFIP_URLS[env].wsfe.replace('?WSDL', '')

    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`

    const response = await axios.post(url, envelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `http://ar.gov.afip.dif.FEV1/${method}`,
      },
      timeout: 30000,
    })

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    })
    const parsed = parser.parse(response.data)

    // Navigate through SOAP envelope to get body
    const soapBody = parsed?.Envelope?.Body || parsed?.['soap:Envelope']?.['soap:Body'] || {}
    const methodResponse = soapBody[`${method}Response`] || soapBody

    return methodResponse
  }

  // ==================== HELPERS ====================

  private isTimeoutError(error: any): boolean {
    const code = error?.code || ''
    const message = error?.message || ''
    return (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      message.includes('timeout') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT')
    )
  }

  private async getCompany(companyId: string) {
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, companyId),
    })
    if (!company) throw new ApiError(404, 'Empresa no encontrada')
    return company
  }

  private buildIvaArray(input: AuthorizeInvoiceInput): Array<{ Id: number; BaseImp: number; Importe: number }> {
    if (input.items && input.items.length > 0) {
      const vatGroups: Record<number, { base: number; amount: number }> = {}
      for (const item of input.items) {
        const rate = item.vatRate || 21
        if (!vatGroups[rate]) vatGroups[rate] = { base: 0, amount: 0 }
        const lineBase = item.quantity * item.unitPrice
        vatGroups[rate].base += lineBase
        vatGroups[rate].amount += lineBase * (rate / 100)
      }
      return Object.entries(vatGroups).map(([rate, amounts]) => ({
        Id: IVA_RATE_MAP[Number(rate)] || 5,
        BaseImp: this.round2(amounts.base),
        Importe: this.round2(amounts.amount),
      }))
    }

    return [{
      Id: 5, // 21%
      BaseImp: this.round2(input.subtotal),
      Importe: this.round2(input.vat),
    }]
  }

  private generateMockAuthorization(input: AuthorizeInvoiceInput, companyCuit: string): AfipAuthorizationResult {
    const cae = Math.floor(Math.random() * 99999999999999).toString().padStart(14, '0')
    const expirationDate = new Date()
    expirationDate.setDate(expirationDate.getDate() + 10)

    const qrData = this.generateQrData({
      fecha: input.invoiceDate,
      cuit: companyCuit,
      ptoVta: input.puntoVenta,
      tipoCmp: INVOICE_TYPE_MAP[input.invoiceType] || 6,
      nroCmp: input.invoiceNumber,
      importe: input.total,
      moneda: 'PES',
      tipoDocRec: input.customerCuit ? 80 : 99,
      nroDocRec: input.customerCuit ? parseInt(input.customerCuit.replace(/-/g, '') || '0') : 0,
      cae,
      caeExpDate: expirationDate,
    })

    return {
      cae,
      caeExpirationDate: expirationDate.toISOString().split('T')[0],
      invoiceNumber: input.invoiceNumber,
      invoiceType: input.invoiceType,
      qrCode: qrData,
      afipResponse: { mock: true, environment: 'homologacion' },
    }
  }

  private generateQrData(params: {
    fecha: Date; cuit: string; ptoVta: number; tipoCmp: number; nroCmp: number;
    importe: number; moneda: string; tipoDocRec: number; nroDocRec: number;
    cae: string; caeExpDate: Date;
  }): string {
    const payload = {
      ver: 1,
      fecha: params.fecha.toISOString().split('T')[0],
      cuit: parseInt(params.cuit.replace(/-/g, '')),
      ptoVta: params.ptoVta,
      tipoCmp: params.tipoCmp,
      nroCmp: params.nroCmp,
      importe: this.round2(params.importe),
      moneda: params.moneda,
      ctz: 1,
      tipoDocRec: params.tipoDocRec,
      nroDocRec: params.nroDocRec,
      tipoCodAut: 'E',
      codAut: parseInt(params.cae),
    }
    const base64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    return `https://www.afip.gob.ar/fe/qr/?p=${base64}`
  }

  private formatAfipDate(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}${m}${d}`
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100
  }

  /**
   * Deep extract a value from nested XML object
   */
  private extractValue(obj: any, key: string): any {
    if (!obj || typeof obj !== 'object') return null
    if (obj[key] !== undefined) return obj[key]
    for (const k of Object.keys(obj)) {
      const result = this.extractValue(obj[k], key)
      if (result !== null) return result
    }
    return null
  }
}

export const afipService = new AfipService()
