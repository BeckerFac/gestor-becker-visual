import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { InvoicePreviewModal } from '@/components/shared/InvoicePreviewModal'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { TagBadges } from '@/components/shared/TagBadges'
import { useInvoicePreview } from '@/hooks/useInvoicePreview'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { PermissionGate } from '@/components/shared/PermissionGate'

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
}

interface Enterprise { id: string; name: string; cuit?: string | null }
interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null }
interface Product { id: string; sku: string; name: string; pricing?: { cost: string; final_price: string; vat_rate: string }; category?: string }
interface OrderWithoutInvoice { id: string; order_number: number; title: string; total_amount: string; customer_name: string; enterprise?: { id: string; name: string } | null }

// ---- Constants ----

const INVOICE_TYPES = ['A', 'B', 'C'] as const
type InvoiceType = typeof INVOICE_TYPES[number]

const INVOICE_TYPE_DESCRIPTIONS: Record<InvoiceType, string> = {
  A: 'Resp. Inscripto a Resp. Inscripto',
  B: 'Resp. Inscripto a Consumidor Final',
  C: 'Monotributo',
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-800' },
  authorized: { label: 'Autorizada', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Anulada', color: 'bg-red-100 text-red-800' },
  emitido: { label: 'Emitido', color: 'bg-blue-100 text-blue-800' },
}

const PAYMENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pagado: { label: 'Pagado', color: 'bg-green-100 text-green-800' },
  parcial: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-800' },
  pendiente: { label: 'Pendiente', color: 'bg-red-100 text-red-800' },
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-indigo-100 text-indigo-800',
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

// ---- Component ----

export const Invoices: React.FC = () => {
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

  // UI
  const [showForm, setShowForm] = useState(false)
  const [formStep, setFormStep] = useState<1 | 2>(1)

  // Vista mode: fiscal (AFIP) or interno (sin AFIP)
  const [vistaMode, setVistaMode] = useState<'fiscal' | 'interno'>('fiscal')

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

  // Form - Step 2: Items
  const [formItems, setFormItems] = useState<InvoiceItem[]>([EMPTY_FORM_ITEM()])
  const [productSearch, setProductSearch] = useState('')
  const [productSearchIdx, setProductSearchIdx] = useState<number | null>(null)

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
      const filters: Record<string, string> = { fiscal_type: vistaMode }
      if (filterEnterprise) filters.enterprise_id = filterEnterprise
      if (filterType) filters.invoice_type = filterType
      if (filterStatus) filters.status = filterStatus
      if (search) filters.search = search
      const res = await api.getInvoices(filters)
      setInvoices(res.items || res || [])
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
    setFormStep(1)
    setShowForm(true)
    await loadFormData()
  }

  const closeForm = () => {
    setShowForm(false)
    setFormStep(1)
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
          if (mapped.length > 0) setFormItems(mapped)
        }
      } catch (e) {
        console.warn('Could not load order items for invoice:', e)
      }
    }
    loadOrderItems()
  }, [formOrderId])

  // Totals

  const formTotals = useMemo(() => {
    const total = formItems.reduce((sum, item) => sum + item.subtotal, 0)
    const neto = formItems.reduce((sum, item) => sum + item.subtotal / (1 + item.vat_rate / 100), 0)
    const iva = total - neto
    return { neto, iva, total }
  }, [formItems])

  const isFormStep1Valid = !!formEnterpriseId
  const isFormStep2Valid = formItems.length > 0 && formItems.every(i => i.product_name.trim() && i.unit_price >= 0 && i.quantity > 0)

  const handleCreateInvoice = async () => {
    if (!isFormStep2Valid) return
    setSaving(true)
    setError(null)
    try {
      await api.createInvoice({
        customer_id: formCustomerId || null,
        enterprise_id: formEnterpriseId || null,
        invoice_type: vistaMode === 'interno' ? undefined : formInvoiceType,
        order_id: formOrderId || null,
        fiscal_type: vistaMode,
        items: formItems.map(item => ({
          product_id: item.product_id || null,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: vistaMode === 'interno' ? 0 : (formInvoiceType === 'C' ? 0 : item.vat_rate),
          order_item_id: item.order_item_id || null,
        })),
      })
      toast.success(vistaMode === 'interno' ? 'Comprobante interno creado' : 'Factura creada correctamente')
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
      const blob = await api.downloadInvoicePdf(invoice.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const pv = invoice.punto_venta ? String(invoice.punto_venta).padStart(5, '0') : '00000'
      const nro = String(invoice.invoice_number).padStart(8, '0')
      a.href = url
      a.download = invoice.fiscal_type === 'interno'
        ? `Comprobante_Interno_CI-${nro}.pdf`
        : `Factura_${invoice.invoice_type}_${pv}-${nro}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
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

  // ---- Filters ----

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterType('')
    setFilterStatus('')
    setSearch('')
    setDateFrom('')
    setDateTo('')
  }

  const handleChangeVistaMode = (mode: 'fiscal' | 'interno') => {
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

  const csvColumns = vistaMode === 'interno'
    ? [
        { key: 'invoice_number_fmt', label: 'N° Comprobante' },
        { key: 'invoice_date_fmt', label: 'Fecha' },
        { key: 'enterprise_name', label: 'Empresa' },
        { key: 'customer_name', label: 'Cliente' },
        { key: 'total_amount', label: 'Total' },
        { key: 'total_cobrado', label: 'Cobrado' },
        { key: 'payment_status_label', label: 'Estado Pago' },
        { key: 'status_label', label: 'Estado' },
      ]
    : [
        { key: 'invoice_type', label: 'Tipo' },
        { key: 'invoice_number_fmt', label: 'N° Comprobante' },
        { key: 'invoice_date_fmt', label: 'Fecha' },
        { key: 'enterprise_name', label: 'Empresa' },
        { key: 'customer_name', label: 'Cliente' },
        { key: 'order_ref', label: 'Pedido' },
        { key: 'total_amount', label: 'Total' },
        { key: 'status_label', label: 'Estado' },
        { key: 'cae', label: 'CAE' },
      ]

  const csvData = filteredInvoices.map(inv => ({
    invoice_type: inv.invoice_type || '',
    invoice_number_fmt: formatInvoiceNumber(inv),
    invoice_date_fmt: formatDate(inv.invoice_date),
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
      {/* Tabs: Fiscal / Interno */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            vistaMode === 'fiscal'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => handleChangeVistaMode('fiscal')}
        >
          Facturas AFIP
        </button>
        <button
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            vistaMode === 'interno'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => handleChangeVistaMode('interno')}
        >
          Comprobantes Internos
        </button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {vistaMode === 'interno' ? 'Comprobantes Internos' : 'Facturas'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{filteredInvoices.length} comprobante{filteredInvoices.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={csvColumns} filename={vistaMode === 'interno' ? 'comprobantes_internos' : 'facturas'} />
          <PermissionGate module="invoices" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={showForm ? closeForm : openForm}>
              {showForm ? 'Cancelar' : vistaMode === 'interno' ? '+ Nuevo Comprobante' : '+ Nueva Factura'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start justify-between">
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
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                value={filterEnterprise}
                onChange={e => setFilterEnterprise(e.target.value)}
              >
                <option value="">Todas</option>
                {enterprises.map(ent => (
                  <option key={ent.id} value={ent.id}>{ent.name}</option>
                ))}
              </select>
            </div>
            {vistaMode === 'fiscal' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Tipo</label>
                <select
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                >
                  <option value="">Todos</option>
                  {INVOICE_TYPES.map(t => (
                    <option key={t} value={t}>Factura {t}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Estado</label>
              <select
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">Todos</option>
                {vistaMode === 'fiscal' ? (
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
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
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
            <DateRangeFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              onClear={() => { setDateFrom(''); setDateTo('') }}
              label="Fecha Factura"
            />
            <div className="flex flex-col gap-1 justify-end">
              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
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
              <h3 className="text-lg font-semibold">{vistaMode === 'interno' ? 'Nuevo Comprobante Interno' : 'Nueva Factura'}</h3>
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
                {vistaMode === 'fiscal' && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">
                      Tipo de Comprobante <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {INVOICE_TYPES.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFormInvoiceType(t)}
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
                  </div>
                )}

                {vistaMode === 'interno' && (
                  <div className="px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
                    Este comprobante es interno y no se emitira en AFIP. No tiene valor fiscal.
                  </div>
                )}

                {/* Link to order (optional) */}
                {ordersWithoutInvoice.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">
                      Asociar a Pedido <span className="text-xs text-gray-400">(opcional)</span>
                    </label>
                    <select
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
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

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={closeForm}>Cancelar</Button>
                  <Button
                    variant="primary"
                    disabled={!isFormStep1Valid}
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
                  {vistaMode === 'fiscal' ? (
                    <span className={`text-xl font-bold px-2 py-0.5 rounded ${TYPE_BADGE_COLORS[formInvoiceType]}`}>
                      {formInvoiceType}
                    </span>
                  ) : (
                    <span className="text-sm font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800">
                      CI
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

                {formOrderId && formItems.some(i => i.order_item_id) && (
                  <div className="px-3 py-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                    Items cargados desde el pedido. Puede editarlos antes de facturar.
                  </div>
                )}

                {/* Items table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-semibold text-gray-600 w-64">Producto / Servicio</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 w-20">Cant.</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 w-32">P. Unitario</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 w-24">IVA %</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 w-32">Subtotal</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formItems.map((item, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 relative">
                            <input
                              type="text"
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
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
                              className="w-full text-center px-2 py-1.5 border border-gray-300 rounded text-sm"
                              value={item.quantity}
                              onChange={e => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full text-right px-2 py-1.5 border border-gray-300 rounded text-sm"
                              value={item.unit_price}
                              onChange={e => handleItemChange(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" step="0.01" placeholder="21"
                              list={`invoice-vat-list-${idx}`}
                              className="w-full text-center px-2 py-1.5 border border-gray-300 rounded text-sm"
                              value={formInvoiceType === 'C' ? 0 : item.vat_rate}
                              onChange={e => handleItemChange(idx, 'vat_rate', parseFloat(e.target.value))}
                              disabled={formInvoiceType === 'C'}
                            />
                            <datalist id={`invoice-vat-list-${idx}`}>
                              {VAT_RATES.map(r => (
                                <option key={r} value={r}>{r}%</option>
                              ))}
                            </datalist>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">
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
                  <div className="w-64 space-y-1 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Neto gravado:</span>
                      <span>{formatCurrency(formTotals.neto)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>IVA:</span>
                      <span>{formatCurrency(formTotals.iva)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-2">
                      <span>Total:</span>
                      <span className="text-green-700">{formatCurrency(formTotals.total)}</span>
                    </div>
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
                      {vistaMode === 'interno' ? 'Crear Comprobante' : 'Crear Factura'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card>
          <CardContent>
            <SkeletonTable rows={6} cols={vistaMode === 'fiscal' ? 9 : 8} />
          </CardContent>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          title={isFiltered
            ? `No hay ${vistaMode === 'interno' ? 'comprobantes internos' : 'facturas'} con estos filtros`
            : `No hay ${vistaMode === 'interno' ? 'comprobantes internos' : 'facturas'} registrad${vistaMode === 'interno' ? 'os' : 'as'}`
          }
          description={isFiltered ? undefined : vistaMode === 'interno' ? 'Crea el primer comprobante interno para comenzar' : 'Crea la primera factura para comenzar'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : vistaMode === 'interno' ? '+ Nuevo Comprobante' : '+ Nueva Factura'}
          onAction={isFiltered ? clearFilters : openForm}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  {vistaMode === 'fiscal' && <th className="px-4 py-3">Tipo</th>}
                  <th className="px-4 py-3">N° Comprobante</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Cliente</th>
                  {vistaMode === 'fiscal' && <th className="px-4 py-3">Pedido</th>}
                  <th className="px-4 py-3 text-right">Total</th>
                  {vistaMode === 'interno' && <th className="px-4 py-3 text-right">Cobrado</th>}
                  {vistaMode === 'interno' && <th className="px-4 py-3 text-center">Estado Pago</th>}
                  <th className="px-4 py-3 text-center">Estado</th>
                  {vistaMode === 'fiscal' && <th className="px-4 py-3">CAE</th>}
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.map(invoice => {
                  const statusMeta = STATUS_MAP[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-800' }
                  const isLinkOpen = linkDropdownInvoiceId === invoice.id

                  return (
                    <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      {/* Tipo - only fiscal */}
                      {vistaMode === 'fiscal' && (
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-1 rounded font-bold text-base ${TYPE_BADGE_COLORS[invoice.invoice_type] || 'bg-gray-100 text-gray-800'}`}>
                            {invoice.invoice_type}
                          </span>
                        </td>
                      )}

                      {/* N° Comprobante */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-gray-800">
                          {formatInvoiceNumber(invoice)}
                        </span>
                      </td>

                      {/* Fecha */}
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(invoice.invoice_date)}
                      </td>

                      {/* Empresa */}
                      <td className="px-4 py-3 font-medium text-gray-800">
                        <div className="flex items-center gap-1.5">
                          {invoice.enterprise?.name || <span className="text-gray-400 italic">Sin empresa</span>}
                          <TagBadges tags={invoice.enterprise_tags || []} size="sm" />
                        </div>
                      </td>

                      {/* Cliente */}
                      <td className="px-4 py-3 text-gray-700">
                        {invoice.customer?.name || <span className="text-gray-400">Consumidor Final</span>}
                      </td>

                      {/* Pedido - only fiscal */}
                      {vistaMode === 'fiscal' && (
                        <td className="px-4 py-3">
                          {invoice.order ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-blue-700 font-semibold">
                                #{String(invoice.order.order_number).padStart(4, '0')}
                              </span>
                              <button
                                onClick={() => setUnlinkTarget(invoice.id)}
                                className="text-xs text-red-500 hover:text-red-700 hover:underline"
                                title="Desvincular pedido"
                              >
                                Desvincular
                              </button>
                            </div>
                          ) : (
                            <div className="relative">
                              <button
                                onClick={() => {
                                  if (isLinkOpen) {
                                    setLinkDropdownInvoiceId(null)
                                    setLinkSelectedOrderId('')
                                  } else {
                                    setLinkDropdownInvoiceId(invoice.id)
                                    setLinkSelectedOrderId('')
                                    if (ordersWithoutInvoice.length === 0) {
                                      api.getOrdersWithoutInvoice().catch(() => []).then(res => {
                                        setOrdersWithoutInvoice(Array.isArray(res) ? res : [])
                                      })
                                    }
                                  }
                                }}
                                className="text-xs text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                              >
                                Vincular Pedido
                              </button>
                              {isLinkOpen && (
                                <div className="absolute z-10 left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-72">
                                  <p className="text-xs font-medium text-gray-600 mb-2">Seleccionar pedido</p>
                                  <select
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs mb-2"
                                    value={linkSelectedOrderId}
                                    onChange={e => setLinkSelectedOrderId(e.target.value)}
                                  >
                                    <option value="">Elegir pedido...</option>
                                    {ordersWithoutInvoice.map(o => (
                                      <option key={o.id} value={o.id}>
                                        #{String(o.order_number).padStart(4, '0')} - {o.title}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleLinkOrder(invoice.id)}
                                      disabled={!linkSelectedOrderId}
                                      className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded disabled:opacity-40 hover:bg-blue-700 transition-colors"
                                    >
                                      Vincular
                                    </button>
                                    <button
                                      onClick={() => { setLinkDropdownInvoiceId(null); setLinkSelectedOrderId('') }}
                                      className="px-2 py-1 border border-gray-300 text-xs rounded hover:bg-gray-50 transition-colors"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Total */}
                      <td className="px-4 py-3 text-right font-bold text-green-700">
                        {formatCurrency(parseFloat(invoice.total_amount || '0'))}
                      </td>

                      {/* Cobrado - only interno */}
                      {vistaMode === 'interno' && (
                        <td className="px-4 py-3 text-right font-medium text-gray-700">
                          {formatCurrency(parseFloat(invoice.total_cobrado || '0'))}
                        </td>
                      )}

                      {/* Estado Pago - only interno */}
                      {vistaMode === 'interno' && (
                        <td className="px-4 py-3 text-center">
                          <StatusBadge
                            status={invoice.payment_status || ''}
                            label={PAYMENT_STATUS_MAP[invoice.payment_status || '']?.label || invoice.payment_status || '-'}
                          />
                        </td>
                      )}

                      {/* Estado */}
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={invoice.status} label={statusMeta.label} />
                      </td>

                      {/* CAE - only fiscal */}
                      {vistaMode === 'fiscal' && (
                        <td className="px-4 py-3">
                          {invoice.cae
                            ? <span className="font-mono text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{invoice.cae}</span>
                            : <span className="text-gray-300">-</span>
                          }
                        </td>
                      )}

                      {/* Acciones */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          {vistaMode === 'fiscal' && invoice.status === 'draft' && (
                            <PermissionGate module="invoices" action="edit">
                              <button
                                onClick={() => handleAuthorize(invoice)}
                                disabled={authorizing === invoice.id}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors disabled:opacity-60"
                              >
                                {authorizing === invoice.id ? 'Autorizando...' : 'Autorizar'}
                              </button>
                            </PermissionGate>
                          )}
                          {(invoice.status === 'authorized' || invoice.status === 'emitido') && (
                            <button
                              onClick={() => handleDownloadPdf(invoice)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                              PDF
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
          pdfBlobUrl={invoicePreview.pdfBlobUrl}
        />
      )}
    </div>
  )
}
