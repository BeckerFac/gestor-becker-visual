import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'

// ==================== TYPES ====================

export interface WsfexAuthorizeInput {
  token: string
  sign: string
  cuit: string
  // Voucher header
  Id: number                // Unique request ID (use Date.now())
  Cbte_Tipo: number         // 19=Factura E, 20=ND E, 21=NC E
  Fecha_cbte: string        // YYYYMMDD
  Punto_vta: number
  Cbte_nro: number
  Tipo_expo: number         // 1=Bienes, 2=Servicios, 4=Otros
  Permiso_existente: string // 'S' or 'N' (export permits)
  Dst_cmp: number           // Destination country code (AFIP table)
  Cliente: string           // Foreign buyer name
  Domicilio_cliente: string // Foreign buyer address
  Cuit_pais_cliente: number // Buyer country CUIT (AFIP code)
  Id_impositivo: string     // Buyer tax ID
  Moneda_Id: string         // Currency code (AFIP table, e.g. 'DOL', 'PES')
  Moneda_ctz: number        // Exchange rate
  Obs_comerciales?: string  // Commercial observations
  Obs?: string              // General observations
  Idioma_cbte: number       // 1=Spanish, 2=English, 3=Portuguese
  Incoterms?: string        // FOB, CIF, EXW, etc.
  Incoterms_Ds?: string     // Incoterms description
  Forma_pago?: string       // Payment method description
  // Amounts
  Imp_total: number
  // Items
  Items: Array<{
    Item_Id: number
    Item_Pro_codigo?: string
    Item_Pro_ds: string
    Item_Pro_qty: number
    Item_Pro_umed: number   // Unit code (AFIP table, 7=unidad)
    Item_Pro_precio_uni: number
    Item_Pro_total_item: number
  }>
  // Associated vouchers (for NC/ND)
  CbtesAsoc?: Array<{
    Cbte_tipo: number
    Cbte_punto_vta: number
    Cbte_nro: number
    Cbte_cuit: number
  }>
  // Export permits (when Permiso_existente = 'S')
  Permisos?: Array<{
    Id_permiso: string
    Dst_merc: number
  }>
}

export interface WsfexAuthorizeResult {
  FEXResultAuth: {
    Id: number
    Cbte_nro: number
    Fch_cbte: string
    Resultado: string       // 'A' = approved, 'R' = rejected
    Motivos_Obs?: string
    Reproceso?: string      // 'S' or 'N'
    Cae: string
    Fch_venc_Cae: string    // YYYYMMDD
  }
  FEXErr?: { ErrCode: number; ErrMsg: string }
  FEXEvents?: any
}

// ==================== CONSTANTS ====================

const WSFEX_URLS = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfexv1/service.asmx',
}

const WSFEX_NAMESPACE = 'http://ar.gov.afip.dif.fexv1/'

// ==================== SERVICE ====================

export class WsfexService {

  // ==================== PUBLIC METHODS ====================

  /**
   * Authorize an export invoice (FEXAuthorize)
   */
  async authorize(
    env: 'homologacion' | 'produccion',
    input: WsfexAuthorizeInput
  ): Promise<WsfexAuthorizeResult> {
    const cleanCuit = input.cuit.replace(/-/g, '')

    // Build items XML
    const itemsXml = input.Items.map(item => `
      <Item>
        <Pro_codigo>${item.Item_Pro_codigo || ''}</Pro_codigo>
        <Pro_ds>${this.escapeXml(item.Item_Pro_ds)}</Pro_ds>
        <Pro_qty>${item.Item_Pro_qty}</Pro_qty>
        <Pro_umed>${item.Item_Pro_umed}</Pro_umed>
        <Pro_precio_uni>${item.Item_Pro_precio_uni}</Pro_precio_uni>
        <Pro_total_item>${item.Item_Pro_total_item}</Pro_total_item>
      </Item>`
    ).join('')

    // Build associated vouchers XML (for NC/ND)
    let cbtesAsocXml = ''
    if (input.CbtesAsoc && input.CbtesAsoc.length > 0) {
      const asocItems = input.CbtesAsoc.map(asoc => `
        <Cbte_asoc>
          <Cbte_tipo>${asoc.Cbte_tipo}</Cbte_tipo>
          <Cbte_punto_vta>${asoc.Cbte_punto_vta}</Cbte_punto_vta>
          <Cbte_nro>${asoc.Cbte_nro}</Cbte_nro>
          <Cbte_cuit>${asoc.Cbte_cuit}</Cbte_cuit>
        </Cbte_asoc>`
      ).join('')
      cbtesAsocXml = `<Cmp_asoc>${asocItems}</Cmp_asoc>`
    }

    // Build permits XML
    let permisosXml = ''
    if (input.Permiso_existente === 'S' && input.Permisos && input.Permisos.length > 0) {
      const permItems = input.Permisos.map(p => `
        <Permiso>
          <Id_permiso>${p.Id_permiso}</Id_permiso>
          <Dst_merc>${p.Dst_merc}</Dst_merc>
        </Permiso>`
      ).join('')
      permisosXml = `<Permisos>${permItems}</Permisos>`
    }

    const soapBody = `<FEXAuthorize xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${input.token}</Token>
        <Sign>${input.sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
      <Cmp>
        <Id>${input.Id}</Id>
        <Fecha_cbte>${input.Fecha_cbte}</Fecha_cbte>
        <Cbte_Tipo>${input.Cbte_Tipo}</Cbte_Tipo>
        <Punto_vta>${input.Punto_vta}</Punto_vta>
        <Cbte_nro>${input.Cbte_nro}</Cbte_nro>
        <Tipo_expo>${input.Tipo_expo}</Tipo_expo>
        <Permiso_existente>${input.Permiso_existente}</Permiso_existente>
        ${permisosXml}
        <Dst_cmp>${input.Dst_cmp}</Dst_cmp>
        <Cliente>${this.escapeXml(input.Cliente)}</Cliente>
        <Cuit_pais_cliente>${input.Cuit_pais_cliente}</Cuit_pais_cliente>
        <Domicilio_cliente>${this.escapeXml(input.Domicilio_cliente)}</Domicilio_cliente>
        <Id_impositivo>${this.escapeXml(input.Id_impositivo)}</Id_impositivo>
        <Moneda_Id>${input.Moneda_Id}</Moneda_Id>
        <Moneda_ctz>${input.Moneda_ctz}</Moneda_ctz>
        <Obs_comerciales>${this.escapeXml(input.Obs_comerciales || '')}</Obs_comerciales>
        <Obs>${this.escapeXml(input.Obs || '')}</Obs>
        <Imp_total>${input.Imp_total}</Imp_total>
        <Idioma_cbte>${input.Idioma_cbte}</Idioma_cbte>
        ${input.Incoterms ? `<Incoterms>${input.Incoterms}</Incoterms>` : ''}
        ${input.Incoterms_Ds ? `<Incoterms_Ds>${this.escapeXml(input.Incoterms_Ds)}</Incoterms_Ds>` : ''}
        ${input.Forma_pago ? `<Forma_pago>${this.escapeXml(input.Forma_pago)}</Forma_pago>` : ''}
        <Items>${itemsXml}</Items>
        ${cbtesAsocXml}
      </Cmp>
    </FEXAuthorize>`

    const response = await this.callWsfex(env, 'FEXAuthorize', soapBody)
    const result = response?.FEXAuthorizeResult || response

    // Check for errors
    if (result?.FEXErr && result.FEXErr.ErrCode !== 0) {
      throw new Error(`WSFEX error ${result.FEXErr.ErrCode}: ${result.FEXErr.ErrMsg}`)
    }

    return result
  }

  /**
   * Get last authorized voucher number (FEXGetLast_CMP)
   */
  async getLastCmp(
    env: 'homologacion' | 'produccion',
    token: string,
    sign: string,
    cuit: string,
    puntoVenta: number,
    cbteTipo: number
  ): Promise<number> {
    const cleanCuit = cuit.replace(/-/g, '')

    const soapBody = `<FEXGetLast_CMP xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
      <Cmp>
        <Cbte_Tipo>${cbteTipo}</Cbte_Tipo>
        <Punto_vta>${puntoVenta}</Punto_vta>
      </Cmp>
    </FEXGetLast_CMP>`

    const response = await this.callWsfex(env, 'FEXGetLast_CMP', soapBody)
    const result = response?.FEXGetLast_CMPResult || response
    return result?.FEXResult_LastCMP?.Cbte_nro || 0
  }

  /**
   * Get last unique request ID (FEXGetLast_ID)
   */
  async getLastId(
    env: 'homologacion' | 'produccion',
    token: string,
    sign: string,
    cuit: string
  ): Promise<number> {
    const cleanCuit = cuit.replace(/-/g, '')

    const soapBody = `<FEXGetLast_ID xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
    </FEXGetLast_ID>`

    const response = await this.callWsfex(env, 'FEXGetLast_ID', soapBody)
    const result = response?.FEXGetLast_IDResult || response
    return result?.FEXResultGet?.Id || 0
  }

  /**
   * Get available currencies (FEXGetPARAM_MON)
   */
  async getMonedas(
    env: 'homologacion' | 'produccion',
    token: string,
    sign: string,
    cuit: string
  ): Promise<Array<{ Mon_Id: string; Mon_Ds: string; Mon_vig_desde: string; Mon_vig_hasta: string }>> {
    const cleanCuit = cuit.replace(/-/g, '')
    const soapBody = `<FEXGetPARAM_MON xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
    </FEXGetPARAM_MON>`

    const response = await this.callWsfex(env, 'FEXGetPARAM_MON', soapBody)
    const result = response?.FEXGetPARAM_MONResult || response
    const items = result?.FEXResultGet?.ClsFEXResponse_Mon
    return Array.isArray(items) ? items : items ? [items] : []
  }

  /**
   * Get available languages (FEXGetPARAM_Idiomas)
   */
  async getIdiomas(
    env: 'homologacion' | 'produccion',
    token: string,
    sign: string,
    cuit: string
  ): Promise<Array<{ Idi_Id: number; Idi_Ds: string }>> {
    const cleanCuit = cuit.replace(/-/g, '')
    const soapBody = `<FEXGetPARAM_Idiomas xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
    </FEXGetPARAM_Idiomas>`

    const response = await this.callWsfex(env, 'FEXGetPARAM_Idiomas', soapBody)
    const result = response?.FEXGetPARAM_IdiomasResult || response
    const items = result?.FEXResultGet?.ClsFEXResponse_Idi
    return Array.isArray(items) ? items : items ? [items] : []
  }

  /**
   * Get destination countries (FEXGetPARAM_DST_pais)
   */
  async getPaises(
    env: 'homologacion' | 'produccion',
    token: string,
    sign: string,
    cuit: string
  ): Promise<Array<{ DST_Codigo: number; DST_Ds: string }>> {
    const cleanCuit = cuit.replace(/-/g, '')
    const soapBody = `<FEXGetPARAM_DST_pais xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
    </FEXGetPARAM_DST_pais>`

    const response = await this.callWsfex(env, 'FEXGetPARAM_DST_pais', soapBody)
    const result = response?.FEXGetPARAM_DST_paisResult || response
    const items = result?.FEXResultGet?.ClsFEXResponse_DST_pais
    return Array.isArray(items) ? items : items ? [items] : []
  }

  /**
   * Get incoterms (FEXGetPARAM_Incoterms)
   */
  async getIncoterms(
    env: 'homologacion' | 'produccion',
    token: string,
    sign: string,
    cuit: string
  ): Promise<Array<{ Inc_Id: string; Inc_Ds: string }>> {
    const cleanCuit = cuit.replace(/-/g, '')
    const soapBody = `<FEXGetPARAM_Incoterms xmlns="${WSFEX_NAMESPACE}">
      <Auth>
        <Token>${token}</Token>
        <Sign>${sign}</Sign>
        <Cuit>${cleanCuit}</Cuit>
      </Auth>
    </FEXGetPARAM_Incoterms>`

    const response = await this.callWsfex(env, 'FEXGetPARAM_Incoterms', soapBody)
    const result = response?.FEXGetPARAM_IncotermsResult || response
    const items = result?.FEXResultGet?.ClsFEXResponse_Inc
    return Array.isArray(items) ? items : items ? [items] : []
  }

  // ==================== SOAP TRANSPORT ====================

  private async callWsfex(
    env: 'homologacion' | 'produccion',
    method: string,
    body: string
  ): Promise<any> {
    const url = WSFEX_URLS[env]

    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`

    const response = await axios.post(url, envelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `${WSFEX_NAMESPACE}${method}`,
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

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}

export const wsfexService = new WsfexService()
