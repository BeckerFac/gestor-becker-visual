// Types shared across all Reportes sub-components

export interface IVAVentasRow {
  invoice_date: string
  comprobante: string
  customer_name: string
  customer_cuit: string
  neto_gravado: number
  neto_no_gravado: number
  iva_27: number
  iva_21: number
  iva_10_5: number
  iva_5: number
  iva_2_5: number
  iva_0: number
  total_iva: number
  total: number
}

export interface IVAComprasRow {
  date: string
  comprobante: string
  enterprise_name: string
  enterprise_cuit: string
  neto_gravado: number
  iva: number
  total: number
}

export interface PosicionIVARow {
  periodo: string
  periodo_label: string
  debito_fiscal: number
  credito_fiscal: number
  saldo: number
}

export interface FlujoCajaRow {
  periodo: string
  periodo_label: string
  ingresos: number
  egresos: number
  neto: number
  acumulado: number
}

export type TabKey = 'ventas' | 'compras' | 'posicion' | 'flujo'

export type DatePreset = 'este_mes' | 'mes_anterior' | 'trimestre' | 'anio'
