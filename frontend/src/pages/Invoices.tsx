import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DateInput } from '@/components/ui/DateInput'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { InvoicePreviewModal } from '@/components/shared/InvoicePreviewModal'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { useInvoicePreview } from '@/hooks/useInvoicePreview'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { CurrencySelector } from '@/components/shared/CurrencySelector'

// ---- Types ----

interface InvoiceItem {
  product_id?: string
  product_name: string
  quantity: number
  unit_price: number
  vat_rate: number
  subtotal: number
  order_item_id?: string
}

interface Invoice {
  id: string
  invoice_type: string
  invoice_number: number
  invoice_date: string
  customer?: { id: string; name: string; cuit: string } | null
  enterprise?: { id: string; name: string } | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  order?: { id: string; order_number: number; title: string } | null
  subtotal: string
  vat_amount: string
  total_amount: string
  status: string
  cae: string | null
  punto_venta: number | null
  fiscal_type?: string
  payment_status?: string
  total_cobrado?: string
  currency?: string
  exchange_rate?: string
  amount_foreign?: string
}

interface Enterprise { id: string; name: string; cuit?: string | null }
interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null }
interface Product { id: string; sku: string; name: string; pricing?: { cost: string; final_price: string; vat_rate: string }; category?: string }
interface OrderWithoutInvoice { id: string; order_number: number; title: string; total_amount: string; customer_name: string; enterprise?: { id: string; name: string } | null }

// ---- Constants ----

const INVOICE_TYPES = ['A', 'B', 'C'] as const
const EXPORT_TYPES = ['E', 'NC_E', 'ND_E'] as const
const NC_ND_TYPES = ['NC_A', 'NC_B', 'NC_C', 'ND_A', 'ND_B', 'ND_C'] as const
const ALL_INVOICE_TYPES = [...INVOICE_TYPES, ...EXPORT_TYPES, ...NC_ND_TYPES] as const
type InvoiceType = typeof ALL_INVOICE_TYPES[number]

const INVOICE_TYPE_DESCRIPTIONS: Record<string, string> = {
  A: 'Resp. Inscripto a Resp. Inscripto',
  B: 'Resp. Inscripto a Consumidor Final',
  C: 'Monotributo',
  E: 'Factura de Exportacion',
  NC_E: 'Nota de Credito Exportacion',
  ND_E: 'Nota de Debito Exportacion',
  NC_A: 'Nota de Credito A',
  NC_B: 'Nota de Credito B',
  NC_C: 'Nota de Credito C',
  ND_A: 'Nota de Debito A',
  ND_B: 'Nota de Debito B',
  ND_C: 'Nota de Debito C',
}

const isNcNdType = (t: string) => t.startsWith('NC_') || t.startsWith('ND_')
const isExportType = (t: string) => t === 'E' || t === 'NC_E' || t === 'ND_E'

// Common AFIP destination country codes
const EXPORT_COUNTRIES = [
  { code: '203', name: 'Brasil' },
  { code: '205', name: 'Estados Unidos' },
  { code: '212', name: 'Reino Unido' },
  { code: '219', name: 'Francia' },
  { code: '220', name: 'Alemania' },
  { code: '224', name: 'Italia' },
  { code: '238', name: 'Espana' },
  { code: '249', name: 'Uruguay' },
  { code: '250', name: 'Chile' },
  { code: '221', name: 'Paraguay' },
  { code: '208', name: 'Colombia' },
  { code: '235', name: 'Peru' },
  { code: '232', name: 'Mexico' },
  { code: '209', name: 'China' },
  { code: '225', name: 'Japon' },
  { code: '218', name: 'Canada' },
  { code: '202', name: 'Australia' },
] as const

const INCOTERMS_OPTIONS = [
  { code: 'FOB', desc: 'Free On Board' },
  { code: 'CIF', desc: 'Cost Insurance Freight' },
  { code: 'EXW', desc: 'Ex Works' },
  { code: 'FCA', desc: 'Free Carrier' },
  { code: 'CFR', desc: 'Cost and Freight' },
  { code: 'CPT', desc: 'Carriage Paid To' },
  { code: 'CIP', desc: 'Carriage Insurance Paid' },
  { code: 'DAP', desc: 'Delivered at Place' },
  { code: 'DPU', desc: 'Delivered at Place Unloaded' },
  { code: 'DDP', desc: 'Delivered Duty Paid' },
  { code: 'FAS', desc: 'Free Alongside Ship' },
] as const

const EXPORT_LANGUAGES = [
  { code: 1, name: 'Espanol' },
  { code: 2, name: 'Ingles' },
  { code: 3, name: 'Portugues' },
] as const

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  authorized: { label: 'Autorizada', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  cancelled: { label: 'Anulada', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  emitido: { label: 'Emitido', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
}

const PAYMENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pagado: { label: 'Pagada', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  parcial: { label: 'Pago parcial', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  B: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  C: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  NC_A: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  NC_B: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  NC_C: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ND_A: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ND_B: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ND_C: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  E: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  NC_E: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ND_E: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
}

const VAT_RATES = [0, 10.5, 21, 27]

const EMPTY_FORM_ITEM = (): InvoiceItem => ({
  product_id: undefined,
  product_name: '',
  quantity: 1,
  unit_price: 0,
  vat_rate: 21,
  subtotal: 0,
})

// ---- Helpers ----

function formatInvoiceNumber(invoice: Pick<Invoice, 'punto_venta' | 'invoice_number' | 'fiscal_type'>): string {
  if (invoice.fiscal_type === 'interno') {
    return `CI-${String(invoice.invoice_number).padStart(6, '0')}`
  }
  if (invoice.fiscal_type === 'no_fiscal') {
    return `NF-${String(invoice.invoice_number).padStart(6, '0')}`
  }
  const nro = String(invoice.invoice_number).padStart(8, '0')
  if (invoice.punto_venta) {
    const pv = String(invoice.punto_venta).padStart(5, '0')
    return `${pv}-${nro}`
  }
  return nro
}

function calcItemSubtotal(unit_price: number, quantity: number): number {
  return unit_price * quantity
}

// Lazy-load purchase invoices tab content
const LazyPurchaseInvoices = lazy(() => import('@/pages/PurchaseInvoices').then(m => ({ default: m.PurchaseInvoices })))
const PurchaseInvoicesTab: React.FC = () => (
  <Suspense fallback={<div className="text-center py-8 text-gray-400">Cargando...</div>}>
    <LazyPurchaseInvoices />
  </Suspense>
)

// Inline component: import items from multiple orders
const OrderItemsImporter: React.FC<{
  enterpriseId?: string;
  onImport: (items: any[]) => void;
}> = ({ enterpriseId, onImport }) => {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [selectedQty, setSelectedQty] = useState<Record<string, string>>({})

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getAvailableOrderItemsForInvoicing(
        enterpriseId ? { enterprise_id: enterpriseId } : undefined
      )
      setOrderItems(data || [])
    } catch { setOrderItems([]) }
    finally { setLoading(false) }
  }, [enterpriseId])

  useEffect(() => { if (open) loadItems() }, [open, loadItems])

  const handleImport = () => {
    const items = orderItems
      .filter(oi => selectedQty[oi.order_item_id] && parseFloat(selectedQty[oi.order_item_id]) > 0)
      .map(oi => ({
        ...oi,
        qty_to_invoice: parseFloat(selectedQty[oi.order_item_id]),
      }))
    if (items.length === 0) return
    onImport(items)
    setOpen(false)
    setSelectedQty({})
  }

  // Group by order
  const grouped = useMemo(() => {
    const map = new Map<string, { order_id: string; order_number: number; order_title: string; enterprise_name: string; items: any[] }>()
    for (const oi of orderItems) {
      if (!map.has(oi.order_id)) {
        map.set(oi.order_id, { order_id: oi.order_id, order_number: oi.order_number, order_title: oi.order_title, enterprise_name: oi.enterprise_name, items: [] })
      }
      map.get(oi.order_id)!.items.push(oi)
    }
    return Array.from(map.values())
  }, [orderItems])

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-blue-600 hover:text-blue-800 font-medium mb-2">
        Importar items de pedidos
      </button>
    )
  }

  return (
    <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3 bg-blue-50/50 dark:bg-blue-950/20">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300">Seleccionar items de pedidos</h4>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cerrar</button>
      </div>

      {loading ? <p className="text-xs text-gray-400">Cargando...</p> : grouped.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No hay items de pedidos pendientes de facturar</p>
      ) : (
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {grouped.map(group => (
            <div key={group.order_id} className="border border-blue-100 dark:border-blue-900 rounded p-2">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Pedido #{String(group.order_number).padStart(4, '0')} — {group.enterprise_name || 'Sin empresa'}
              </p>
              <div className="space-y-1">
                {group.items.map((oi: any) => {
                  const remaining = parseFloat(oi.qty_remaining || '0')
                  return (
                    <div key={oi.order_item_id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 text-gray-700 dark:text-gray-300">{oi.product_name}</span>
                      <span className="text-gray-400">{parseFloat(oi.quantity)}x ${parseFloat(oi.unit_price).toLocaleString('es-AR')}</span>
                      <span className="text-orange-600">Disponible: {remaining}</span>
                      <input
                        type="number" min="0" max={remaining} step="0.01"
                        placeholder="0"
                        value={selectedQty[oi.order_item_id] || ''}
                        onChange={e => setSelectedQty(prev => ({ ...prev, [oi.order_item_id]: e.target.value }))}
                        className="w-16 px-1 py-0.5 border rounded text-right text-xs dark:bg-gray-700 dark:border-gray-600"
                      />
                      <button type="button" onClick={() => setSelectedQty(prev => ({ ...prev, [oi.order_item_id]: remaining.toString() }))}
                        className="text-blue-600 text-[10px] font-medium">Todo</button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end mt-2">
        <button type="button" onClick={handleImport}
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
          Importar seleccionados
        </button>
      </div>
    </div>
  )
}

// ---- Component ----

export const Invoices: React.FC = () => {
  const navigate = useNavigate()

  // Data
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [ordersWithoutInvoice, setOrdersWithoutInvoice] = useState<OrderWithoutInvoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [authorizing, setAuthorizing] = useState<string | null>(null)
  const [linkingInvoice, setLinkingInvoice] = useState<string | null>(null)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)

  // UI
  const [showForm, setShowForm] = useState(false)
  const [formStep, setFormStep] = useState<1 | 2>(1)

  // Vista mode: fiscal (AFIP) or no_fiscal
  const [vistaMode, setVistaMode] = useState<'venta_fiscal' | 'venta_no_fiscal' | 'compra'>('venta_fiscal')

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Form - Step 1
  const [formEnterpriseId, setFormEnterpriseId] = useState('')
  const [formCustomerId, setFormCustomerId] = useState('')
  const [formInvoiceType, setFormInvoiceType] = useState<InvoiceType>('C')
  const [formOrderId, setFormOrderId] = useState('')
  const [formRelatedInvoiceId, setFormRelatedInvoiceId] = useState('')
  const [authorizedInvoices, setAuthorizedInvoices] = useState<Invoice[]>([])
  const [formCurrency, setFormCurrency] = useState('ARS')
  const [formExchangeRate, setFormExchangeRate] = useState<number | null>(null)

  // Form - Export (Tipo E) fields
  const [exportCountry, setExportCountry] = useState('')
  const [exportClientName, setExportClientName] = useState('')
  const [exportClientAddress, setExportClientAddress] = useState('')
  const [exportClientTaxId, setExportClientTaxId] = useState('')
  const [exportIncoterms, setExportIncoterms] = useState('')
  const [exportLanguage, setExportLanguage] = useState(1)

  // Form - Step 2: Items
  const [formItems, setFormItems] = useState<InvoiceItem[]>([EMPTY_FORM_ITEM()])
  const [productSearch, setProductSearch] = useState('')
  const [productSearchIdx, setProductSearchIdx] = useState<number | null>(null)

  // Import modal
  const [showImportForm, setShowImportForm] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const [importData, setImportData] = useState({
    invoice_type: 'A' as InvoiceType,
    invoice_number_full: '',
    invoice_date: '',
    cae: '',
    cae_expiry_date: '',
    enterprise_id: '',
    customer_id: '',
    customer_cuit: '',
    observations: '',
  })
  const [importItems, setImportItems] = useState<InvoiceItem[]>([EMPTY_FORM_ITEM()])

  // Confirm dialog for unlink
  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState(false)

  // Link/Unlink order per invoice row
  const [linkDropdownInvoiceId, setLinkDropdownInvoiceId] = useState<string | null>(null)
  const [linkSelectedOrderId, setLinkSelectedOrderId] = useState('')

  // Invoice preview modal (PDF + authorize)
  const loadInvoicesRef = React.useRef<() => Promise<void>>(() => Promise.resolve())
  const invoicePreview = useInvoicePreview({
    onError: (msg) => toast.error(msg),
    onDataRefresh: async () => { await loadInvoicesRef.current() },
    loadInvoicingStatus: async () => {},
  })

  // ---- Data Loading ----

  const loadInvoices = async () => {
    try {
      setLoading(true)
      // Map vistaMode to backend fiscal_type
      const fiscalTypeMap: Record<string, string> = {
        venta_fiscal: 'fiscal',
        venta_no_fiscal: 'no_fiscal',
      }
      const filters: Record<string, string> = { fiscal_type: fiscalTypeMap[vistaMode] || 'fiscal' }
      if (filterEnterprise) filters.enterprise_id = filterEnterprise
      if (filterType) filters.invoice_type = filterType
      if (filterStatus) filters.status = filterStatus
      if (search) filters.search = search
      const [res, entRes] = await Promise.all([
        api.getInvoices(filters),
        enterprises.length === 0 ? api.getEnterprises().catch(() => []) : Promise.resolve(null),
      ])
      setInvoices(res.items || res || [])
      if (entRes) setEnterprises(entRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  loadInvoicesRef.current = loadInvoices

  const loadFormData = async () => {
    try {
      const [entRes, custRes, prodRes, ordersRes] = await Promise.all([
        api.getEnterprises().catch(() => []),
        api.getCustomers().catch(() => ({ items: [] })),
        api.getProducts().catch(() => ({ items: [] })),
        api.getOrdersWithoutInvoice().catch(() => []),
      ])
      setEnterprises(entRes || [])
      setCustomers(custRes.items || custRes || [])
      setProducts(prodRes.items || prodRes || [])
      setOrdersWithoutInvoice(Array.isArray(ordersRes) ? ordersRes : [])
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadInvoices()
  }, [filterEnterprise, filterType, filterStatus, vistaMode])

  useEffect(() => {
    setCurrentPage(1)
  }, [filterEnterprise, filterType, filterStatus, search, dateFrom, dateTo, pageSize, vistaMode])

  // ---- Form Handlers ----

  const openForm = async () => {
    setFormEnterpriseId('')
    setFormCustomerId('')
    setFormInvoiceType('C')
    setFormOrderId('')
    setFormItems([EMPTY_FORM_ITEM()])
    setProductSearch('')
    setProductSearchIdx(null)
    setFormCurrency('ARS')
    setFormExchangeRate(null)
    setFormStep(1)
    setShowForm(true)
    await loadFormData()
  }

  const closeForm = () => {
    setShowForm(false)
    setFormStep(1)
    setFormRelatedInvoiceId('')
    setAuthorizedInvoices([])
    setFormCurrency('ARS')
    setFormExchangeRate(null)
    // Reset export fields
    setExportCountry('')
    setExportClientName('')
    setExportClientAddress('')
    setExportClientTaxId('')
    setExportIncoterms('')
    setExportLanguage(1)
  }

  // Items management

  const handleAddItem = () => {
    setFormItems(prev => [...prev, EMPTY_FORM_ITEM()])
  }

  const handleRemoveItem = (idx: number) => {
    setFormItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleItemChange = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setFormItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: value }
      updated.subtotal = calcItemSubtotal(
        field === 'unit_price' ? Number(value) : updated.unit_price,
        field === 'quantity' ? Number(value) : updated.quantity,
      )
      return updated
    }))
  }

  const handleSelectProductForItem = (idx: number, product: Product) => {
    const price = product.pricing ? parseFloat(product.pricing.final_price) : 0
    const vatRate = product.pricing ? parseFloat(product.pricing.vat_rate) : 21
    setFormItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      return {
        ...item,
        product_id: product.id,
        product_name: product.name,
        unit_price: price,
        vat_rate: vatRate,
        subtotal: calcItemSubtotal(price, item.quantity),
      }
    }))
    setProductSearch('')
    setProductSearchIdx(null)
  }

  // Auto-fill items from order
  useEffect(() => {
    if (!formOrderId) return
    const loadOrderItems = async () => {
      try {
        const uninvoiced = await api.getOrderUninvoicedItems(formOrderId)
        if (uninvoiced && uninvoiced.length > 0) {
          const mapped: InvoiceItem[] = uninvoiced
            .filter((item: any) => parseFloat(item.pending_qty || '0') > 0)
            .map((item: any) => ({
              product_id: item.product_id || undefined,
              product_name: item.product_name || '',
              quantity: parseFloat(item.pending_qty || item.quantity || '1'),
              unit_price: parseFloat(item.unit_price || '0'),
              vat_rate: 21,
              subtotal: calcItemSubtotal(parseFloat(item.unit_price || '0'), parseFloat(item.pending_qty || item.quantity || '1')),
              order_item_id: item.id,
            }))
          if (mapped.length > 0) {
            setFormItems(prev => {
              const existingIds = new Set(prev.filter(i => i.order_item_id).map(i => i.order_item_id))
              const newOnly = mapped.filter(m => !existingIds.has(m.order_item_id))
              if (newOnly.length === 0) return prev
              const withContent = prev.filter(i => i.product_name.trim())
              return withContent.length > 0 ? [...withContent, ...newOnly] : newOnly
            })
          }
        }
      } catch (e) {
        console.warn('Could not load order items for invoice:', e)
      }
    }
    loadOrderItems()
  }, [formOrderId])

  // Load authorized invoices for NC/ND related invoice selector
  useEffect(() => {
    if (!isNcNdType(formInvoiceType) || !formEnterpriseId) {
      setAuthorizedInvoices([])
      setFormRelatedInvoiceId('')
      return
    }
    const loadAuthorized = async () => {
      try {
        const resp = await api.getInvoices({ enterprise_id: formEnterpriseId, status: 'authorized', fiscal_type: 'fiscal', limit: 200 })
        // Filter to only base invoice types (A, B, C, E) - not NC/ND
        const filtered = (resp.items || []).filter((inv: Invoice) => ['A', 'B', 'C', 'E'].includes(inv.invoice_type))
        setAuthorizedInvoices(filtered)
      } catch (e) {
        console.warn('Could not load authorized invoices:', e)
      }
    }
    loadAuthorized()
  }, [formInvoiceType, formEnterpriseId])

  // When selecting a related invoice for NC, auto-fill items
  useEffect(() => {
    if (!formRelatedInvoiceId || !isNcNdType(formInvoiceType)) return
    const loadRelatedItems = async () => {
      try {
        const inv = await api.getInvoice(formRelatedInvoiceId)
        if (inv?.items?.length > 0) {
          const mapped = inv.items.map((item: any) => ({
            product_id: item.product_id || undefined,
            product_name: item.product_name || '',
            quantity: parseFloat(item.quantity || '1'),
            unit_price: parseFloat(item.unit_price || '0'),
            vat_rate: parseFloat(item.vat_rate || '21'),
            subtotal: calcItemSubtotal(parseFloat(item.unit_price || '0'), parseFloat(item.quantity || '1')),
          }))
          setFormItems(mapped)
        }
      } catch (e) {
        console.warn('Could not load related invoice items:', e)
      }
    }
    loadRelatedItems()
  }, [formRelatedInvoiceId])

  // Totals

  const formTotals = useMemo(() => {
    const total = formItems.reduce((sum, item) => sum + item.subtotal, 0)
    const neto = formItems.reduce((sum, item) => sum + item.subtotal / (1 + item.vat_rate / 100), 0)
    const iva = total - neto
    return { neto, iva, total }
  }, [formItems])

  const isExportFormValid = !isExportType(formInvoiceType) || (!!exportCountry && !!exportClientName && !!exportClientAddress)
  const isFormStep1Valid = !!formEnterpriseId && (vistaMode !== 'venta_fiscal' || !isNcNdType(formInvoiceType) || !!formRelatedInvoiceId) && isExportFormValid
  const isFormStep2Valid = formItems.length > 0 && formItems.every(i => i.product_name.trim() && i.unit_price >= 0 && i.quantity > 0)

  const handleCreateInvoice = async () => {
    if (!isFormStep2Valid) return
    setSaving(true)
    setError(null)
    try {
      const baseLetter = formInvoiceType.replace(/^(NC_|ND_)/, '')
      const isExport = isExportType(formInvoiceType);
      await api.createInvoice({
        customer_id: formCustomerId || null,
        enterprise_id: formEnterpriseId || null,
        invoice_type: vistaMode === 'venta_fiscal' ? formInvoiceType : undefined,
        order_id: null, // Backend derives order_ids from items' order_item_id
        related_invoice_id: isNcNdType(formInvoiceType) ? (formRelatedInvoiceId || null) : null,
        fiscal_type: vistaMode === 'venta_fiscal' ? 'fiscal' : 'no_fiscal',
        currency: formCurrency,
        exchange_rate: formCurrency !== 'ARS' ? formExchangeRate : undefined,
        items: formItems.map(item => ({
          product_id: item.product_id || null,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: vistaMode !== 'venta_fiscal' ? 0 : (isExport ? 0 : (baseLetter === 'C' ? 0 : item.vat_rate)),
          order_item_id: item.order_item_id || null,
        })),
        ...(isExport ? {
          export_data: {
            destination_country: exportCountry,
            client_name: exportClientName,
            client_address: exportClientAddress,
            client_tax_id: exportClientTaxId,
            incoterms: exportIncoterms,
            language: exportLanguage,
            tipo_expo: '1',
          },
        } : {}),
      })
      const msgType = isNcNdType(formInvoiceType) ? 'Comprobante' : 'Factura'
      toast.success(vistaMode === 'venta_fiscal' ? `${msgType} creado/a correctamente` : 'Comprobante creado correctamente')
      closeForm()
      await loadInvoices()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ---- Invoice Actions ----

  const handleAuthorize = async (invoice: Invoice) => {
    await invoicePreview.openPreview(invoice.id, invoice.order?.id || '')
  }

  const handleDownloadPdf = async (invoice: Invoice) => {
    try {
      setDownloadingPdfId(invoice.id)
      const blob = await api.downloadInvoicePdf(invoice.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const pv = invoice.punto_venta ? String(invoice.punto_venta).padStart(5, '0') : '00000'
      const nro = String(invoice.invoice_number).padStart(8, '0')
      a.href = url
      a.download = invoice.fiscal_type === 'interno'
        ? `Comprobante_Interno_CI-${nro}.pdf`
        : `Factura_${invoice.invoice_type || 'NF'}_${pv}-${nro}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDownloadingPdfId(null)
    }
  }

  const handleGeneratePaymentLink = async (invoiceId: string) => {
    try {
      const result = await api.generatePaymentLink(invoiceId)
      toast.info(result.message || 'Link de pago generado')
    } catch (e: any) {
      toast.error(e.message || 'Error al generar link de pago')
    }
  }

  const handleLinkOrder = async (invoiceId: string) => {
    if (!linkSelectedOrderId) return
    setError(null)
    try {
      await api.linkOrderToInvoice(invoiceId, linkSelectedOrderId)
      setLinkDropdownInvoiceId(null)
      setLinkSelectedOrderId('')
      await Promise.all([loadInvoices(), loadFormData()])
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleUnlinkOrder = async () => {
    if (!unlinkTarget) return
    setUnlinking(true)
    setError(null)
    try {
      await api.unlinkOrderFromInvoice(unlinkTarget)
      toast.success('Pedido desvinculado correctamente')
      await Promise.all([loadInvoices(), loadFormData()])
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setUnlinking(false)
      setUnlinkTarget(null)
    }
  }

  // ---- Import Handlers ----

  const openImportForm = async () => {
    setImportData({
      invoice_type: 'A',
      invoice_number_full: '',
      invoice_date: '',
      cae: '',
      cae_expiry_date: '',
      enterprise_id: '',
      customer_id: '',
      customer_cuit: '',
      observations: '',
    })
    setImportItems([EMPTY_FORM_ITEM()])
    setShowImportForm(true)
    await loadFormData()
  }

  const closeImportForm = () => {
    setShowImportForm(false)
  }

  const handleImportItemChange = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setImportItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: value }
      updated.subtotal = calcItemSubtotal(
        field === 'unit_price' ? Number(value) : updated.unit_price,
        field === 'quantity' ? Number(value) : updated.quantity,
      )
      return updated
    }))
  }

  const importTotals = useMemo(() => {
    const total = importItems.reduce((sum, item) => sum + item.subtotal, 0)
    const neto = importItems.reduce((sum, item) => sum + item.subtotal / (1 + item.vat_rate / 100), 0)
    const iva = total - neto
    return { neto, iva, total }
  }, [importItems])

  const isImportValid = !!(
    importData.invoice_type &&
    /^\d{5}-\d{8}$/.test(importData.invoice_number_full) &&
    importData.invoice_date &&
    /^\d{14}$/.test(importData.cae) &&
    importData.cae_expiry_date &&
    importData.enterprise_id &&
    /^\d{11}$/.test(importData.customer_cuit.replace(/-/g, '')) &&
    importItems.length > 0 &&
    importItems.every(i => i.product_name.trim() && i.unit_price >= 0 && i.quantity > 0)
  )

  const handleImportInvoice = async () => {
    if (!isImportValid) return
    setImportSaving(true)
    setError(null)
    try {
      await api.importInvoice({
        ...importData,
        items: importItems.map(item => ({
          product_id: item.product_id || null,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
        })),
      })
      toast.success('Factura importada correctamente')
      closeImportForm()
      await loadInvoices()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setImportSaving(false)
    }
  }

  // ---- Filters ----

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterType('')
    setFilterStatus('')
    setSearch('')
    setDateFrom('')
    setDateTo('')
  }

  const handleChangeVistaMode = (mode: 'venta_fiscal' | 'venta_no_fiscal' | 'compra') => {
    setVistaMode(mode)
    clearFilters()
    setShowForm(false)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') loadInvoices()
  }

  // Client-side date filter + pagination

  const filteredInvoices = useMemo(() => {
    let result = invoices
    if (dateFrom) result = result.filter(inv => inv.invoice_date >= dateFrom)
    if (dateTo) result = result.filter(inv => inv.invoice_date <= dateTo)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(inv =>
        (inv.customer?.name || '').toLowerCase().includes(q) ||
        (inv.enterprise?.name || '').toLowerCase().includes(q) ||
        String(inv.invoice_number).includes(q) ||
        (inv.cae || '').includes(q)
      )
    }
    return result
  }, [invoices, dateFrom, dateTo, search])

  const totalPages = Math.ceil(filteredInvoices.length / pageSize)
  const paginatedInvoices = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = !!filterEnterprise || !!filterType || !!filterStatus || !!search || !!dateFrom || !!dateTo

  // ---- CSV Export ----

  const csvColumns = vistaMode !== 'venta_fiscal'
    ? [
        { key: 'invoice_number_fmt', label: 'N° Comprobante' },
        { key: 'invoice_date', label: 'Fecha', type: 'date' as const },
        { key: 'enterprise_name', label: 'Empresa' },
        { key: 'customer_name', label: 'Cliente' },
        { key: 'total_amount', label: 'Total', type: 'currency' as const },
        { key: 'total_cobrado', label: 'Cobrado', type: 'currency' as const },
        { key: 'payment_status_label', label: 'Estado Pago' },
        { key: 'status_label', label: 'Estado' },
      ]
    : [
        { key: 'invoice_type', label: 'Tipo' },
        { key: 'invoice_number_fmt', label: 'N° Comprobante' },
        { key: 'invoice_date', label: 'Fecha', type: 'date' as const },
        { key: 'enterprise_name', label: 'Empresa' },
        { key: 'customer_name', label: 'Cliente' },
        { key: 'order_ref', label: 'Pedido' },
        { key: 'total_amount', label: 'Total', type: 'currency' as const },
        { key: 'status_label', label: 'Estado' },
        { key: 'cae', label: 'CAE' },
      ]

  const csvData = filteredInvoices.map(inv => ({
    invoice_type: inv.invoice_type || '',
    invoice_number_fmt: formatInvoiceNumber(inv),
    invoice_date: inv.invoice_date,
    enterprise_name: inv.enterprise?.name || '',
    customer_name: inv.customer?.name || 'Consumidor Final',
    order_ref: inv.order ? `#${String(inv.order.order_number).padStart(4, '0')}` : '-',
    total_amount: inv.total_amount,
    total_cobrado: inv.total_cobrado || '0',
    payment_status_label: PAYMENT_STATUS_MAP[inv.payment_status || '']?.label || '',
    status_label: STATUS_MAP[inv.status]?.label || inv.status,
    cae: inv.cae || '',
  }))

  // Filtered orders for form link dropdown (only for selected enterprise)
  const filteredOrdersForForm = useMemo(() => {
    if (!formEnterpriseId) return ordersWithoutInvoice
    return ordersWithoutInvoice.filter(o => o.enterprise?.id === formEnterpriseId)
  }, [ordersWithoutInvoice, formEnterpriseId])

  // ---- Product search dropdown for form items ----

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return []
    const q = productSearch.toLowerCase()
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    ).slice(0, 10)
  }, [products, productSearch])

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Tabs: 4 categorias */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit flex-wrap">
        {([
          { key: 'venta_fiscal', label: 'Facturas Venta' },
          { key: 'venta_no_fiscal', label: 'No Fiscal Venta' },
          { key: 'compra', label: 'Facturas de Compra' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              vistaMode === tab.key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
            onClick={() => handleChangeVistaMode(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Purchase Invoices tab */}
      {vistaMode === 'compra' && <PurchaseInvoicesTab />}

      {/* Sales invoices content (hidden when compras tab active) */}
      {vistaMode !== 'compra' && <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {vistaMode === 'venta_no_fiscal' ? 'Comprobantes No Fiscales' : 'Facturas de Venta (AFIP)'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{filteredInvoices.length} comprobante{filteredInvoices.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={csvColumns} filename={vistaMode === 'venta_no_fiscal' ? 'comprobantes_no_fiscales' : 'facturas'} />
          <ExportExcelButton data={csvData} columns={csvColumns} filename={vistaMode === 'venta_no_fiscal' ? 'comprobantes_no_fiscales' : 'facturas'} />
          <PermissionGate module="invoices" action="create">
            {vistaMode === 'venta_fiscal' && !showForm && (
              <Button variant="outline" onClick={showImportForm ? closeImportForm : openImportForm}>
                {showImportForm ? 'Cancelar' : 'Importar factura ya emitida'}
              </Button>
            )}
            <Button variant={showForm ? 'danger' : 'primary'} onClick={showForm ? closeForm : openForm}>
              {showForm ? 'Cancelar' : vistaMode === 'venta_fiscal' ? '+ Nueva Factura' : '+ Nuevo Comprobante'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 font-bold text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Empresa</label>
              <select
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                value={filterEnterprise}
                onChange={e => setFilterEnterprise(e.target.value)}
              >
                <option value="">Todas</option>
                {enterprises.map(ent => (
                  <option key={ent.id} value={ent.id}>{ent.name}</option>
                ))}
              </select>
            </div>
            {vistaMode === 'venta_fiscal' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Tipo</label>
                <select
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                >
                  <option value="">Todos</option>
                  {INVOICE_TYPES.map(t => (
                    <option key={t} value={t}>Factura {t}</option>
                  ))}
                  {EXPORT_TYPES.map(t => (
                    <option key={t} value={t}>{t === 'E' ? 'Factura E (Export)' : t.replace('_', ' ')}</option>
                  ))}
                  {NC_ND_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Estado</label>
              <select
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">Todos</option>
                {vistaMode === 'venta_fiscal' ? (
                  <>
                    <option value="draft">Borrador</option>
                    <option value="authorized">Autorizada</option>
                    <option value="cancelled">Anulada</option>
                  </>
                ) : (
                  <option value="emitido">Emitido</option>
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Buscar</label>
              <div className="flex gap-1">
                <input
                  className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                  placeholder="Cliente, empresa, CAE..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                <button
                  onClick={() => loadInvoices()}
                  className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-sm"
                >
                  Ir
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1 lg:col-span-2">
              <DateRangeFilter
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onClear={() => { setDateFrom(''); setDateTo('') }}
                label="Fecha Factura"
              />
              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="mt-1 px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline self-start"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Creation Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{vistaMode === 'venta_fiscal' ? 'Nueva Factura' : 'Nuevo Comprobante No Fiscal'}</h3>
              <div className="flex items-center gap-2">
                <span className={`text-sm px-3 py-1 rounded-full font-medium ${formStep === 1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  1. Datos
                </span>
                <span className="text-gray-300">›</span>
                <span className={`text-sm px-3 py-1 rounded-full font-medium ${formStep === 2 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  2. Items
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {formStep === 1 && (
              <div className="space-y-5">
                {/* Enterprise + Customer */}
                <EnterpriseCustomerSelector
                  enterprises={enterprises}
                  customers={customers}
                  selectedEnterpriseId={formEnterpriseId}
                  selectedCustomerId={formCustomerId}
                  onEnterpriseChange={setFormEnterpriseId}
                  onCustomerChange={setFormCustomerId}
                  enterpriseRequired
                  enterpriseLabel="Empresa emisora"
                  customerLabel="Cliente / Contacto"
                />

                {/* Invoice type - only for fiscal invoices */}
                {vistaMode === 'venta_fiscal' && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                      Tipo de Comprobante <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {INVOICE_TYPES.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setFormInvoiceType(t); setFormRelatedInvoiceId('') }}
                          className={`text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                            formInvoiceType === t
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <span className="text-2xl font-bold mr-2">{t}</span>
                          <span className="text-xs text-gray-500">{INVOICE_TYPE_DESCRIPTIONS[t]}</span>
                        </button>
                      ))}
                    </div>
                    {/* Export (Tipo E) */}
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mt-4 mb-2">
                      Exportacion (Tipo E - WSFEX)
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {EXPORT_TYPES.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setFormInvoiceType(t); setFormRelatedInvoiceId('') }}
                          className={`text-left px-3 py-2 rounded-lg border-2 transition-colors ${
                            formInvoiceType === t
                              ? 'border-teal-500 bg-teal-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <span className="text-sm font-bold mr-1">{t.replace('_', ' ')}</span>
                          <span className="text-xs text-gray-500 block">{INVOICE_TYPE_DESCRIPTIONS[t]}</span>
                        </button>
                      ))}
                    </div>

                    {/* NC/ND options */}
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mt-4 mb-2">
                      Notas de Credito / Debito
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {NC_ND_TYPES.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setFormInvoiceType(t); setFormRelatedInvoiceId('') }}
                          className={`text-left px-3 py-2 rounded-lg border-2 transition-colors ${
                            formInvoiceType === t
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <span className="text-sm font-bold mr-1">{t.replace('_', ' ')}</span>
                          <span className="text-xs text-gray-500 block">{INVOICE_TYPE_DESCRIPTIONS[t]}</span>
                        </button>
                      ))}
                    </div>

                    {/* Related invoice selector for NC/ND */}
                    {isNcNdType(formInvoiceType) && (
                      <div className="mt-4">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                          Factura Original <span className="text-red-500">*</span>
                        </label>
                        <select
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                          value={formRelatedInvoiceId}
                          onChange={e => setFormRelatedInvoiceId(e.target.value)}
                        >
                          <option value="">Seleccionar factura original...</option>
                          {authorizedInvoices.map(inv => (
                            <option key={inv.id} value={inv.id}>
                              Factura {inv.invoice_type} {formatInvoiceNumber(inv)} - {formatCurrency(parseFloat(inv.total_amount))} {inv.customer?.name ? `(${inv.customer.name})` : ''}
                            </option>
                          ))}
                        </select>
                        {authorizedInvoices.length === 0 && formEnterpriseId && (
                          <p className="text-xs text-gray-500 mt-1">No hay facturas autorizadas para esta empresa.</p>
                        )}
                        {!formEnterpriseId && (
                          <p className="text-xs text-amber-600 mt-1">Seleccione una empresa primero.</p>
                        )}
                      </div>
                    )}

                    {/* Export data fields for Tipo E */}
                    {isExportType(formInvoiceType) && (
                      <div className="mt-4 p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg space-y-3">
                        <h4 className="text-sm font-semibold text-teal-800 dark:text-teal-300">Datos de Exportacion (WSFEX)</h4>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                              Pais destino <span className="text-red-500">*</span>
                            </label>
                            <select
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={exportCountry}
                              onChange={e => setExportCountry(e.target.value)}
                            >
                              <option value="">Seleccionar pais...</option>
                              {EXPORT_COUNTRIES.map(c => (
                                <option key={c.code} value={c.code}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                              Incoterms
                            </label>
                            <select
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={exportIncoterms}
                              onChange={e => setExportIncoterms(e.target.value)}
                            >
                              <option value="">Seleccionar...</option>
                              {INCOTERMS_OPTIONS.map(i => (
                                <option key={i.code} value={i.code}>{i.code} - {i.desc}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                            Nombre comprador <span className="text-red-500">*</span>
                          </label>
                          <input
                            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                            placeholder="Nombre o razon social del comprador extranjero"
                            value={exportClientName}
                            onChange={e => setExportClientName(e.target.value)}
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                            Direccion comprador <span className="text-red-500">*</span>
                          </label>
                          <input
                            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                            placeholder="Direccion completa del comprador"
                            value={exportClientAddress}
                            onChange={e => setExportClientAddress(e.target.value)}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                              Tax ID del comprador
                            </label>
                            <input
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              placeholder="Ej: US-EIN, CNPJ, VAT..."
                              value={exportClientTaxId}
                              onChange={e => setExportClientTaxId(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
                              Idioma comprobante
                            </label>
                            <select
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={exportLanguage}
                              onChange={e => setExportLanguage(Number(e.target.value))}
                            >
                              {EXPORT_LANGUAGES.map(l => (
                                <option key={l.code} value={l.code}>{l.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {vistaMode === 'venta_no_fiscal' && (
                  <div className="px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
                    Este comprobante no fiscal no se emitira en AFIP.
                  </div>
                )}

                {/* Link to order (optional) */}
                {ordersWithoutInvoice.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Asociar a Pedido <span className="text-xs text-gray-400">(opcional)</span>
                    </label>
                    <select
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                      value={formOrderId}
                      onChange={e => { setFormOrderId(e.target.value); if (!e.target.value) setFormItems([EMPTY_FORM_ITEM()]) }}
                    >
                      <option value="">Sin asociar</option>
                      {filteredOrdersForForm.map(o => (
                        <option key={o.id} value={o.id}>
                          #{String(o.order_number).padStart(4, '0')} - {o.title}
                          {o.customer_name ? ` | ${o.customer_name}` : ''}
                          {' '}— {formatCurrency(parseFloat(o.total_amount || '0'))}
                        </option>
                      ))}
                    </select>
                    {filteredOrdersForForm.length === 0 && formEnterpriseId && (
                      <p className="text-xs text-gray-400">No hay pedidos sin factura para esta empresa.</p>
                    )}
                  </div>
                )}

                {/* Currency selector */}
                <CurrencySelector
                  currency={formCurrency}
                  exchangeRate={formExchangeRate}
                  onCurrencyChange={setFormCurrency}
                  onExchangeRateChange={setFormExchangeRate}
                />

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={closeForm}>Cancelar</Button>
                  <Button
                    variant="primary"
                    disabled={!isFormStep1Valid || (formCurrency !== 'ARS' && !formExchangeRate)}
                    onClick={() => setFormStep(2)}
                  >
                    Siguiente: Items
                  </Button>
                </div>
              </div>
            )}

            {formStep === 2 && (
              <div className="space-y-5">
                {/* Summary of step 1 */}
                <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  {vistaMode === 'venta_fiscal' ? (
                    <span className={`text-xl font-bold px-2 py-0.5 rounded ${TYPE_BADGE_COLORS[formInvoiceType]}`}>
                      {formInvoiceType}
                    </span>
                  ) : (
                    <span className="text-sm font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-800 dark:text-gray-200">
                      NF
                    </span>
                  )}
                  <span className="text-blue-800 font-medium">
                    {enterprises.find(e => e.id === formEnterpriseId)?.name || formEnterpriseId}
                  </span>
                  {formCustomerId && (
                    <>
                      <span className="text-blue-400">›</span>
                      <span className="text-blue-700">
                        {customers.find(c => c.id === formCustomerId)?.name || ''}
                      </span>
                    </>
                  )}
                  {formOrderId && (
                    <>
                      <span className="text-blue-400">›</span>
                      <span className="text-blue-600 font-mono">
                        #{String(ordersWithoutInvoice.find(o => o.id === formOrderId)?.order_number || 0).padStart(4, '0')}
                      </span>
                    </>
                  )}
                  <button
                    className="ml-auto text-xs text-blue-600 hover:underline"
                    onClick={() => setFormStep(1)}
                  >
                    Editar
                  </button>
                </div>

                {formItems.some(i => i.order_item_id) && (
                  <div className="px-3 py-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                    Items cargados desde pedidos. Puede editarlos antes de facturar.
                  </div>
                )}

                {/* Import from orders button */}
                <OrderItemsImporter
                  enterpriseId={formEnterpriseId}
                  onImport={(importedItems) => {
                    const newItems = importedItems.map((oi: any) => {
                      const qty = parseFloat(oi.qty_to_invoice || oi.qty_remaining)
                      const price = parseFloat(oi.unit_price)
                      return {
                        product_id: oi.product_id || '',
                        product_name: oi.product_name || '',
                        quantity: qty,
                        unit_price: price,
                        vat_rate: 21,
                        subtotal: qty * price,
                        order_item_id: oi.order_item_id,
                      }
                    })
                    setFormItems([...formItems.filter(i => i.product_name), ...newItems])
                  }}
                />

                {/* Items table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 w-64">Producto / Servicio</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400 w-20">Cant.</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400 w-32">P. Unitario</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400 w-24">IVA %</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400 w-32">Subtotal</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formItems.map((item, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 relative">
                            <input
                              type="text"
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="Nombre del producto..."
                              value={item.product_name}
                              onChange={e => {
                                handleItemChange(idx, 'product_name', e.target.value)
                                setProductSearch(e.target.value)
                                setProductSearchIdx(idx)
                              }}
                              onFocus={() => setProductSearchIdx(idx)}
                            />
                            {/* Product search dropdown */}
                            {productSearchIdx === idx && filteredProducts.length > 0 && (
                              <div className="absolute z-20 left-3 right-3 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                {filteredProducts.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 flex justify-between items-center text-sm"
                                    onMouseDown={() => handleSelectProductForItem(idx, p)}
                                  >
                                    <span>
                                      <span className="font-mono text-xs text-gray-400 mr-2">{p.sku}</span>
                                      {p.name}
                                    </span>
                                    {p.pricing && (
                                      <span className="text-green-700 font-medium ml-2 shrink-0">
                                        {formatCurrency(parseFloat(p.pricing.final_price))}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="1"
                              className="w-full text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={item.quantity}
                              onChange={e => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full text-right px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={item.unit_price}
                              onChange={e => handleItemChange(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" step="0.01" placeholder="21"
                              list={`invoice-vat-list-${idx}`}
                              className="w-full text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={vistaMode !== 'venta_fiscal' || formInvoiceType === 'C' ? 0 : item.vat_rate}
                              onChange={e => handleItemChange(idx, 'vat_rate', parseFloat(e.target.value))}
                              disabled={vistaMode !== 'venta_fiscal' || formInvoiceType === 'C'}
                            />
                            <datalist id={`invoice-vat-list-${idx}`}>
                              {VAT_RATES.map(r => (
                                <option key={r} value={r}>{r}%</option>
                              ))}
                            </datalist>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-200">
                            {formatCurrency(item.subtotal)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              disabled={formItems.length === 1}
                              className="text-red-400 hover:text-red-700 font-bold text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={handleAddItem}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                >
                  + Agregar item
                </button>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-72 space-y-1 text-sm">
                    <div className="flex justify-between text-gray-600 dark:text-gray-400">
                      <span>Neto gravado:</span>
                      <span>{formatCurrency(formTotals.neto, formCurrency)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600 dark:text-gray-400">
                      <span>IVA:</span>
                      <span>{formatCurrency(formTotals.iva, formCurrency)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-2">
                      <span>Total:</span>
                      <span className="text-green-700">{formatCurrency(formTotals.total, formCurrency)}</span>
                    </div>
                    {formCurrency !== 'ARS' && formExchangeRate && (
                      <div className="flex justify-between text-xs text-blue-600 dark:text-blue-400 border-t border-gray-100 pt-1 mt-1">
                        <span>Total ARS (TC {formExchangeRate.toFixed(2)}):</span>
                        <span>{formatCurrency(formTotals.total * formExchangeRate, 'ARS')}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <Button variant="outline" onClick={() => setFormStep(1)}>Anterior</Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={closeForm}>Cancelar</Button>
                    <Button
                      variant="primary"
                      loading={saving}
                      disabled={!isFormStep2Valid || saving}
                      onClick={handleCreateInvoice}
                    >
                      {vistaMode === 'venta_fiscal' ? 'Crear Factura' : 'Crear Comprobante'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import Form */}
      {showImportForm && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <h3 className="text-lg font-semibold">Importar Factura Manual</h3>
            <p className="text-xs text-gray-500 mt-1">
              Importe una factura ya autorizada externamente en AFIP. Se creara con estado "Autorizada".
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {/* Row 1: Type + Number + Date */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Tipo de comprobante <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {INVOICE_TYPES.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setImportData(prev => ({ ...prev, invoice_type: t }))}
                        className={`px-3 py-2 rounded-lg border-2 text-center font-bold transition-colors ${
                          importData.invoice_type === t
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Numero de comprobante <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="00003-00000001"
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                    value={importData.invoice_number_full}
                    onChange={e => setImportData(prev => ({ ...prev, invoice_number_full: e.target.value }))}
                  />
                  {importData.invoice_number_full && !/^\d{5}-\d{8}$/.test(importData.invoice_number_full) && (
                    <p className="text-xs text-red-500">Formato: PV-Nro (ej: 00003-00000001)</p>
                  )}
                </div>
                <DateInput
                  label="Fecha de emision *"
                  value={importData.invoice_date}
                  onChange={val => setImportData(prev => ({ ...prev, invoice_date: val }))}
                />
              </div>

              {/* Row 2: CAE + CAE Expiry */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    CAE <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="14 digitos"
                    maxLength={14}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 font-mono"
                    value={importData.cae}
                    onChange={e => setImportData(prev => ({ ...prev, cae: e.target.value.replace(/\D/g, '').slice(0, 14) }))}
                  />
                  {importData.cae && importData.cae.length !== 14 && (
                    <p className="text-xs text-red-500">El CAE debe tener 14 digitos ({importData.cae.length}/14)</p>
                  )}
                </div>
                <DateInput
                  label="Fecha vencimiento CAE *"
                  value={importData.cae_expiry_date}
                  onChange={val => setImportData(prev => ({ ...prev, cae_expiry_date: val }))}
                />
              </div>

              {/* Row 3: Enterprise + Customer CUIT */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Cliente / Empresa <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                    value={importData.enterprise_id}
                    onChange={e => setImportData(prev => ({ ...prev, enterprise_id: e.target.value }))}
                  >
                    <option value="">Seleccionar...</option>
                    {enterprises.map(ent => (
                      <option key={ent.id} value={ent.id}>{ent.name}{ent.cuit ? ` (${ent.cuit})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    CUIT cliente <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="20123456789"
                    maxLength={13}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 font-mono"
                    value={importData.customer_cuit}
                    onChange={e => setImportData(prev => ({ ...prev, customer_cuit: e.target.value.replace(/[^\d-]/g, '') }))}
                  />
                </div>
              </div>

              {/* Items table */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Items <span className="text-red-500">*</span>
                </label>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 w-64">Producto / Servicio</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400 w-20">Cant.</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400 w-32">P. Unitario</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400 w-24">IVA %</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400 w-32">Subtotal</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {importItems.map((item, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              placeholder="Nombre del producto..."
                              value={item.product_name}
                              onChange={e => handleImportItemChange(idx, 'product_name', e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="1"
                              className="w-full text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={item.quantity}
                              onChange={e => handleImportItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0" step="0.01"
                              className="w-full text-right px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={item.unit_price}
                              onChange={e => handleImportItemChange(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" step="0.01"
                              list={`import-vat-list-${idx}`}
                              className="w-full text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                              value={item.vat_rate}
                              onChange={e => handleImportItemChange(idx, 'vat_rate', parseFloat(e.target.value))}
                            />
                            <datalist id={`import-vat-list-${idx}`}>
                              {VAT_RATES.map(r => (
                                <option key={r} value={r}>{r}%</option>
                              ))}
                            </datalist>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-200">
                            {formatCurrency(item.subtotal)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => setImportItems(prev => prev.filter((_, i) => i !== idx))}
                              disabled={importItems.length === 1}
                              className="text-red-400 hover:text-red-700 font-bold text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              x
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => setImportItems(prev => [...prev, EMPTY_FORM_ITEM()])}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 mt-2"
                >
                  + Agregar item
                </button>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>Neto gravado:</span>
                    <span>{formatCurrency(importTotals.neto)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 dark:text-gray-400">
                    <span>IVA:</span>
                    <span>{formatCurrency(importTotals.iva)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                    <span>Total:</span>
                    <span className="text-green-700 dark:text-green-400">{formatCurrency(importTotals.total)}</span>
                  </div>
                </div>
              </div>

              {/* Observations */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Observaciones <span className="text-xs text-gray-400">(opcional)</span>
                </label>
                <textarea
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                  rows={2}
                  placeholder="Notas adicionales..."
                  value={importData.observations}
                  onChange={e => setImportData(prev => ({ ...prev, observations: e.target.value }))}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeImportForm}>Cancelar</Button>
                <Button
                  variant="primary"
                  loading={importSaving}
                  disabled={!isImportValid || importSaving}
                  onClick={handleImportInvoice}
                >
                  Importar Factura
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card>
          <CardContent>
            <SkeletonTable rows={6} cols={vistaMode === 'venta_fiscal' ? 10 : 8} />
          </CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          title={isFiltered
            ? `No hay ${vistaMode === 'venta_fiscal' ? 'facturas' : 'comprobantes'} con estos filtros`
            : `No hay ${vistaMode === 'venta_fiscal' ? 'facturas registradas' : 'comprobantes registrados'}`
          }
          description={isFiltered ? undefined : vistaMode === 'venta_fiscal' ? 'Crea la primera factura para comenzar' : 'Crea el primer comprobante para comenzar'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : vistaMode === 'venta_fiscal' ? '+ Nueva Factura' : '+ Nuevo Comprobante'}
          onAction={isFiltered ? clearFilters : openForm}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
                  <th className="px-2 py-2">Comprobante</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Empresa / Cliente</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-center">Pago</th>
                  <th className="px-2 py-2 text-center">Estado</th>
                  <th className="px-2 py-2 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.map(invoice => {
                  const statusMeta = STATUS_MAP[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-800 dark:text-gray-200' }
                  const isLinkOpen = linkDropdownInvoiceId === invoice.id

                  return (
                    <tr key={invoice.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      {/* Comprobante: Tipo + Numero + CAE */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          {vistaMode === 'venta_fiscal' && (
                            <span className={`inline-block px-1.5 py-0.5 rounded font-bold text-xs ${TYPE_BADGE_COLORS[invoice.invoice_type] || 'bg-gray-100 text-gray-800 dark:text-gray-200'}`}>
                              {invoice.invoice_type}
                            </span>
                          )}
                          <span className="font-mono text-xs text-gray-800 dark:text-gray-200">
                            {formatInvoiceNumber(invoice)}
                          </span>
                        </div>
                        {invoice.cae && <p className="font-mono text-[10px] text-gray-400 mt-0.5">CAE: {invoice.cae}</p>}
                      </td>

                      {/* Fecha */}
                      <td className="px-2 py-2 text-gray-600 dark:text-gray-400 text-xs">
                        {formatDate(invoice.invoice_date)}
                      </td>

                      {/* Empresa + Cliente + Pedido combined */}
                      <td className="px-2 py-2 text-xs">
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-gray-800 dark:text-gray-200">{invoice.enterprise?.name || <span className="text-gray-400 italic">Sin empresa</span>}</span>
                          <TagBadges tags={invoice.enterprise_tags || []} size="sm" />
                        </div>
                        <p className="text-gray-500 dark:text-gray-400">{invoice.customer?.name || 'Consumidor Final'}</p>
                        {vistaMode === 'venta_fiscal' && invoice.order && (
                          <p className="text-[10px] mt-0.5">
                            <button onClick={(e) => { e.stopPropagation(); navigate('/orders') }} className="font-mono text-blue-600 hover:underline">
                              Pedido #{String(invoice.order.order_number).padStart(4, '0')}
                            </button>
                            <button onClick={() => setUnlinkTarget(invoice.id)} className="ml-1 text-red-400 hover:text-red-600">x</button>
                          </p>
                        )}
                        {vistaMode === 'venta_fiscal' && !invoice.order && (
                          <div className="relative mt-0.5">
                            <button
                              onClick={() => {
                                if (isLinkOpen) { setLinkDropdownInvoiceId(null); setLinkSelectedOrderId('') }
                                else {
                                  setLinkDropdownInvoiceId(invoice.id); setLinkSelectedOrderId('')
                                  if (ordersWithoutInvoice.length === 0) {
                                    api.getOrdersWithoutInvoice().catch(() => []).then(res => setOrdersWithoutInvoice(Array.isArray(res) ? res : []))
                                  }
                                }
                              }}
                              className="text-[10px] text-blue-600 hover:underline"
                            >Vincular Pedido</button>
                            {isLinkOpen && (
                              <div className="absolute z-10 left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 w-64">
                                <select className="w-full px-2 py-1 border rounded text-xs mb-1 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100" value={linkSelectedOrderId} onChange={e => setLinkSelectedOrderId(e.target.value)}>
                                  <option value="">Elegir pedido...</option>
                                  {ordersWithoutInvoice.map(o => <option key={o.id} value={o.id}>#{String(o.order_number).padStart(4, '0')} - {o.title}</option>)}
                                </select>
                                <div className="flex gap-1">
                                  <button onClick={() => handleLinkOrder(invoice.id)} disabled={!linkSelectedOrderId} className="flex-1 px-2 py-1 bg-blue-600 text-white text-[10px] rounded disabled:opacity-40">Vincular</button>
                                  <button onClick={() => { setLinkDropdownInvoiceId(null); setLinkSelectedOrderId('') }} className="px-2 py-1 border text-[10px] rounded">x</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Total */}
                      <td className="px-2 py-2 text-right font-bold text-green-700 dark:text-green-400 text-sm">
                        {formatCurrency(parseFloat(invoice.total_amount || '0'))}
                        {invoice.currency && invoice.currency !== 'ARS' && invoice.amount_foreign && (
                          <p className="text-[10px] font-normal text-blue-600 dark:text-blue-400">
                            {formatCurrency(parseFloat(invoice.amount_foreign), invoice.currency)}
                          </p>
                        )}
                      </td>

                      {/* Estado Pago */}
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const ps = invoice.payment_status || 'pendiente'
                          const meta = PAYMENT_STATUS_MAP[ps]
                          if (!meta) return <span className="text-gray-400">-</span>
                          const isPaid = ps === 'pagado'
                          const totalAmount = parseFloat(invoice.total_amount || '0')
                          const totalCobrado = parseFloat(invoice.total_cobrado || '0')
                          const remaining = Math.max(0, totalAmount - totalCobrado)
                          return isPaid ? (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${meta.color}`}>
                              {meta.label}
                            </span>
                          ) : (
                            <button
                              onClick={() => navigate(`/cobros?invoice_id=${invoice.id}&amount=${remaining.toFixed(2)}`)}
                              title="Click para registrar cobro"
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 hover:scale-105 ${meta.color}`}
                            >
                              {meta.label}
                            </button>
                          )
                        })()}
                      </td>

                      {/* Estado */}
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={invoice.status} label={statusMeta.label} />
                      </td>

                      {/* Acciones */}
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-2">
                          {vistaMode === 'venta_fiscal' && invoice.status === 'draft' && (
                            <PermissionGate module="invoices" action="authorize_afip">
                              <button
                                onClick={() => handleAuthorize(invoice)}
                                disabled={authorizing === invoice.id}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded transition-all ${
                                  authorizing === invoice.id
                                    ? 'bg-gray-400 cursor-not-allowed opacity-80 animate-pulse'
                                    : 'bg-green-600 hover:bg-green-700'
                                }`}
                              >
                                {authorizing === invoice.id ? (
                                  <>
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Autorizando...
                                  </>
                                ) : 'Autorizar'}
                              </button>
                            </PermissionGate>
                          )}
                          {(invoice.status === 'authorized' || invoice.status === 'emitido') && (
                            <button
                              onClick={() => handleDownloadPdf(invoice)}
                              disabled={downloadingPdfId === invoice.id}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {downloadingPdfId === invoice.id ? (
                                <>
                                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Generando...
                                </>
                              ) : (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                  </svg>
                                  PDF
                                </>
                              )}
                            </button>
                          )}
                          {invoice.status === 'authorized' && (
                            <button
                              onClick={() => handleGeneratePaymentLink(invoice.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 transition-colors"
                              title="Generar link de pago (MercadoPago)"
                            >
                              Link de pago
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredInvoices.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!unlinkTarget}
        title="Desvincular pedido"
        message="¿Desvincular el pedido de esta factura?"
        confirmLabel="Desvincular"
        variant="warning"
        loading={unlinking}
        onConfirm={handleUnlinkOrder}
        onCancel={() => setUnlinkTarget(null)}
      />

      {invoicePreview.previewInvoice && (
        <InvoicePreviewModal
          invoice={invoicePreview.previewInvoice}
          loading={invoicePreview.previewLoading}
          orderId={invoicePreview.previewOrderId}
          authorizing={invoicePreview.authorizingInvoice}
          authorizeProgress={invoicePreview.authorizeProgress}
          puntoVenta={invoicePreview.previewPuntoVenta}
          invoiceType={invoicePreview.previewInvoiceType}
          items={invoicePreview.previewItems}
          authorized={invoicePreview.invoiceAuthorized}
          authFailed={invoicePreview.authFailed}
          authErrorMsg={invoicePreview.authErrorMsg}
          onClose={invoicePreview.closePreview}
          onPuntoVentaChange={invoicePreview.setPreviewPuntoVenta}
          onInvoiceTypeChange={invoicePreview.setPreviewInvoiceType}
          onItemsChange={invoicePreview.setPreviewItems}
          onAuthorize={invoicePreview.saveAndAuthorize}
          onDeleteDraft={invoicePreview.deleteDraft}
          onDownloadPdf={invoicePreview.downloadPdf}
          downloadingPdf={invoicePreview.downloadingPdf}
          pdfBlobUrl={invoicePreview.pdfBlobUrl}
          condicionIva={invoicePreview.previewCondicionIva}
          onCondicionIvaChange={invoicePreview.setPreviewCondicionIva}
          concepto={invoicePreview.previewConcepto}
          onConceptoChange={invoicePreview.setPreviewConcepto}
          onFchServDesdeChange={invoicePreview.setPreviewFchServDesde}
          onFchServHastaChange={invoicePreview.setPreviewFchServHasta}
          onFchVtoPagoChange={invoicePreview.setPreviewFchVtoPago}
        />
      )}
      </>}
    </div>
  )
}
