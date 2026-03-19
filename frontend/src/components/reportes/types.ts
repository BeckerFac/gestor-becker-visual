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

// Accounting tabs
export type AccountingTabKey = 'iva_ventas' | 'iva_compras' | 'posicion' | 'flujo'

// Business tabs
export type BusinessTabKey = 'biz_ventas' | 'biz_rentabilidad' | 'biz_clientes' | 'biz_cobranzas' | 'biz_inventario' | 'biz_conversion'

export type TabKey = AccountingTabKey | BusinessTabKey

export type DatePreset = 'este_mes' | 'mes_anterior' | 'trimestre' | 'anio'

// -- Business Report types --

export interface VentasSummary {
  total_facturado: number
  total_facturado_delta: number | null
  cantidad_pedidos: number
  cantidad_pedidos_delta: number | null
  ticket_promedio: number
  ticket_promedio_delta: number | null
}

export interface VentasMesRow {
  periodo: string
  total: number
  cantidad: number
}

export interface TopProductoRow {
  nombre: string
  unidades: number
  revenue: number
}

export interface VentasDiaRow {
  dia: string
  total: number
  cantidad: number
}

export interface VentasReportData {
  summary: VentasSummary
  ventas_por_mes: VentasMesRow[]
  ventas_prev_mes: { periodo: string; total: number }[]
  top_productos: TopProductoRow[]
  ventas_por_dia: VentasDiaRow[]
}

export interface RentabilidadProducto {
  nombre: string
  product_id: string | null
  unidades: number
  revenue: number
  costo_total: number
  margen: number
  margen_pct: number
  sin_costo: boolean
}

export interface RentabilidadSummary {
  margen_total: number
  margen_total_delta: number | null
  margen_promedio_pct: number
  margen_promedio_pct_delta: number | null
  productos_margen_bajo: number
  productos_margen_negativo: number
}

export interface RentabilidadReportData {
  summary: RentabilidadSummary
  top_por_margen: RentabilidadProducto[]
  productos: RentabilidadProducto[]
}

export interface ClienteRow {
  nombre: string
  enterprise_id: string | null
  customer_id: string | null
  cantidad_compras: number
  revenue: number
  ticket_promedio: number
  ultima_compra: string
}

export interface ClienteInactivo {
  nombre: string
  ultima_compra: string
  total_historico: number
}

export interface ClientesSummary {
  clientes_activos: number
  clientes_nuevos: number
  clientes_nuevos_delta: number | null
  clientes_recurrentes: number
  concentracion_top5: number
}

export interface ClientesReportData {
  summary: ClientesSummary
  top_clientes: ClienteRow[]
  clientes_inactivos: ClienteInactivo[]
}

export interface AgingBucket {
  bucket: string
  label: string
  color: string
  cantidad: number
  monto: number
}

export interface MorosoRow {
  nombre: string
  monto_pendiente: number
  pedidos_pendientes: number
  dias_max_atraso: number
}

export interface CobranzasSummary {
  total_pendiente: number
  dso_promedio: number
  dso_promedio_delta: number | null
  facturas_vencidas: number
  monto_vencido: number
  cobranzas_periodo: number
  cobranzas_periodo_delta: number | null
}

export interface CobranzasReportData {
  summary: CobranzasSummary
  aging: AgingBucket[]
  morosos: MorosoRow[]
}

export interface StockItem {
  nombre: string
  sku: string
  product_id: string
  stock_actual: number
  costo_unitario: number
  valor_stock: number
  stock_minimo: number
  controls_stock: boolean
}

export interface DeadStockItem {
  nombre: string
  sku: string
  stock_actual: number
  ultima_venta: string | null
  dias_sin_venta: number
  valor_inmovilizado: number
}

export interface InventarioSummary {
  valor_total: number
  productos_bajo_minimo: number
  productos_sin_movimiento: number
}

export interface InventarioReportData {
  summary: InventarioSummary
  stock_items: StockItem[]
  dead_stock: DeadStockItem[]
  low_stock: StockItem[]
}

export interface FunnelStep {
  etapa: string
  cantidad: number
  valor: number
}

export interface CotizacionAbierta {
  id: string
  cliente: string
  titulo: string
  fecha: string
  monto: number
  dias_abierto: number
  status: string
}

export interface ConversionSummary {
  tasa_conversion: number
  tasa_conversion_delta: number | null
  valor_pipeline: number
  valor_promedio_perdido: number
  tiempo_promedio_dias: number
  total_cotizaciones: number
}

export interface ConversionReportData {
  summary: ConversionSummary
  funnel: FunnelStep[]
  cotizaciones_abiertas: CotizacionAbierta[]
}
