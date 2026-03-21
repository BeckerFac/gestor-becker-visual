export interface ProductType {
  id: string
  name: string
  description: string | null
  sort_order: number
}

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  product_type: string | null
  category_id: string | null
  category_name?: string | null
  active: boolean
  controls_stock?: boolean
  low_stock_threshold?: string | number
  stock_quantity?: number | string
  stock_min_level?: number | string
  pricing?: { cost: string; margin_percent: string; vat_rate: string; final_price: string }
}

export interface Category {
  id: string
  name: string
  parent_id: string | null
  description: string | null
  product_count: number
  child_product_count?: number
  default_vat_rate: string | null
  default_margin_percent: string | null
  default_supplier_id: string | null
  sort_order: number
  color: string | null
}

export interface PriceListRule {
  id: string
  price_list_id: string
  product_id: string | null
  category_id: string | null
  rule_type: 'percentage' | 'fixed' | 'formula'
  value: string
  min_quantity: number
  priority: number
  active: boolean
  product_name?: string
  product_sku?: string
  category_name?: string
}

export interface PriceResolution {
  resolved_price: number
  base_price: number
  discount_percent: number
  rule_applied: string | null
  price_list_name: string | null
}

export interface StockMovement {
  id: string
  product_id: string
  product?: { id: string; name: string; sku: string }
  warehouse?: { id: string; name: string }
  movement_type: string
  quantity: string
  notes: string | null
  created_at: string
  reference_type?: string | null
  reference_id?: string | null
}

export interface BulkPreviewItem {
  product_id: string
  sku: string
  name: string
  old_cost: string
  margin_percent: string
  vat_rate: string
  old_final_price: string
  new_cost: string
  new_final_price: string
}

export const DEFAULT_TYPES = [
  'portabanner', 'bandera', 'ploteo', 'carteleria', 'vinilo',
  'lona', 'backing', 'senaletica', 'vehicular', 'textil', 'otro',
]

export const VAT_OPTIONS = [
  { value: '0', label: '0%' },
  { value: '10.5', label: '10.5%' },
  { value: '21', label: '21%' },
  { value: '27', label: '27%' },
]

export const emptyForm = {
  sku: '', name: '', description: '', barcode: '', product_type: 'otro',
  cost: '', margin_percent: '30', vat_rate: '21', final_price: '',
  controls_stock: false, low_stock_threshold: '0',
}

export type ProductForm = typeof emptyForm
