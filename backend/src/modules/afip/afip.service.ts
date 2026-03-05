import { db } from '../../config/db'
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
  invoiceType: 'A' | 'B' | 'C'
  customerCuit: string
  subtotal: number
  vat: number
  total: number
  invoiceDate: Date
  puntoVenta: number
  items?: Array<{
    quantity: number
    unitPrice: number
    vatRate: number
    description: string
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
}

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
      // In homologación, fall back to mock if AFIP fails
      if (company.afip_env !== 'produccion') {
        console.log('AFIP: Falling back to mock (homologación)')
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
    const cleanCuit = cuit.replace(/-/g, '')
    if (cleanCuit.length !== 11 || !/^\d+$/.test(cleanCuit)) {
      return { valid: false }
    }
    return { valid: true }
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

    // Determine doc type
    let docTipo = 99 // Consumidor Final
    let docNro = 0
    const cleanCuit = input.customerCuit?.replace(/-/g, '') || ''
    if (cleanCuit.length >= 10) {
      docTipo = 80 // CUIT
      docNro = parseInt(cleanCuit)
    }

    // Factura C (Monotributo): NO se informa IVA, todo va como ImpNeto
    // Factura A/B: se informa IVA desglosado
    const isFacturaC = cbteTipo === 11
    const ivaItems = isFacturaC ? [] : this.buildIvaArray(input)

    // Format date
    const fchDate = this.formatAfipDate(input.invoiceDate)

    // Build FECAESolicitar request
    const soapBody = this.buildFECAESolicitarRequest(
      token, sign, company.cuit, {
        CantReg: 1,
        PtoVta: ptoVta,
        CbteTipo: cbteTipo,
        Concepto: 1, // Products
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: cbteNro,
        CbteHasta: cbteNro,
        CbteFch: fchDate,
        ImpTotal: this.round2(input.total),
        ImpTotConc: 0,
        ImpNeto: isFacturaC ? this.round2(input.total) : this.round2(input.subtotal),
        ImpOpEx: 0,
        ImpIVA: isFacturaC ? 0 : this.round2(input.vat),
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
        Iva: ivaItems,
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
            <ImpTotal>${data.ImpTotal}</ImpTotal>
            <ImpTotConc>${data.ImpTotConc}</ImpTotConc>
            <ImpNeto>${data.ImpNeto}</ImpNeto>
            <ImpOpEx>${data.ImpOpEx}</ImpOpEx>
            <ImpIVA>${data.ImpIVA}</ImpIVA>
            <ImpTrib>${data.ImpTrib}</ImpTrib>
            <MonId>${data.MonId}</MonId>
            <MonCotiz>${data.MonCotiz}</MonCotiz>
            ${ivaXml}
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
