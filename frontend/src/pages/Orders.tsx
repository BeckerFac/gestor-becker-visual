import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { InvoicePreviewModal } from '@/components/shared/InvoicePreviewModal'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { useInvoicePreview } from '@/hooks/useInvoicePreview'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'

interface Order {
  id: string
  order_number: number
  title: string
  description: string | null
  product_type: string
  status: string
  priority: string
  quantity: number
  unit_price: string
  total_amount: string
  vat_rate: string
  estimated_profit: string
  estimated_delivery: string | null
  actual_delivery: string | null
  has_invoice: boolean
  payment_method: string | null
  payment_status: string
  notes: string | null
  customer?: { id: string; name: string; cuit: string }
  enterprise?: { id: string; name: string } | null
  invoice?: { id: string; invoice_number: number; invoice_type: string; status: string; punto_venta?: number; cae?: string } | null
  bank?: { id: string; bank_name: string } | null
  created_at: string
}

interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null }
interface Product { id: string; name: string; sku: string; pricing?: { cost: string; final_price: string; vat_rate: string }; category?: string }
interface Enterprise { id: string; name: string; cuit?: string | null }
interface Bank { id: string; bank_name: string }

interface FormItem {
  product_id: string
  product_name: string
  description: string
  quantity: number
  unit_price: number
  cost: number
  product_type: string
}

interface InvoicingStatusData {
  invoicing_status: 'sin_facturar' | 'parcial' | 'facturado'
  invoices: Array<{
    id: string
    invoice_number: number
    invoice_type: string
    status: string
    punto_venta?: number
    cae?: string
    total_amount: string
  }>
  items: Array<{
    id: string
    product_name: string
    quantity: number
    invoiced_qty: number
    pending_qty: number
    unit_price: string
    vat_rate?: string
  }>
}

const PRODUCT_TYPES = [
  { value: 'todos', label: 'Todos los tipos' },
  { value: 'portabanner', label: 'Portabanner' },
  { value: 'bandera', label: 'Bandera' },
  { value: 'ploteo', label: 'Ploteo' },
  { value: 'carteleria', label: 'Carteleria' },
  { value: 'vinilo', label: 'Vinilo' },
  { value: 'lona', label: 'Lona' },
  { value: 'backing', label: 'Backing' },
  { value: 'senaletica', label: 'Senaletica' },
  { value: 'vehicular', label: 'Vehicular' },
  { value: 'textil', label: 'Textil' },
  { value: 'otro', label: 'Otro' },
  { value: 'mixto', label: 'Mixto' },
]

const STATUS_OPTIONS = [
  { value: 'todos', label: 'Todos', color: '' },
  { value: 'pendiente', label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'en_produccion', label: 'En Produccion', color: 'bg-blue-100 text-blue-800' },
  { value: 'en_pausa', label: 'En Pausa', color: 'bg-gray-100 text-gray-800' },
  { value: 'terminado', label: 'Terminado', color: 'bg-green-100 text-green-800' },
  { value: 'entregado', label: 'Entregado', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'cancelado', label: 'Cancelado', color: 'bg-red-100 text-red-800' },
]

const PAYMENT_METHODS = [
  { value: '', label: 'Sin especificar' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
]

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  baja: { label: 'Baja', color: 'text-gray-500' },
  normal: { label: 'Normal', color: 'text-blue-600' },
  alta: { label: 'Alta', color: 'text-orange-600' },
  urgente: { label: 'Urgente', color: 'text-red-600 font-bold' },
}

const INVOICE_TYPES = ['A', 'B', 'C']

const emptyFormItem = (): FormItem => ({
  product_id: '',
  product_name: '',
  description: '',
  quantity: 1,
  unit_price: 0,
  cost: 0,
  product_type: 'otro',
})

const ORDER_DRAFT_KEY = 'bv_order_draft'

export const Orders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<any>({})
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)

  // Invoicing state per order
  const [invoicingStatus, setInvoicingStatus] = useState<Record<string, InvoicingStatusData>>({})
  const [invoicingLoading, setInvoicingLoading] = useState<Record<string, boolean>>({})
  const [showInvoiceForm, setShowInvoiceForm] = useState<Record<string, boolean>>({})
  const [invoiceType, setInvoiceType] = useState<Record<string, string>>({})
  const [invoiceQtys, setInvoiceQtys] = useState<Record<string, Record<string, number>>>({})
  const [creatingInvoice, setCreatingInvoice] = useState<Record<string, boolean>>({})

  // Filters
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterType, setFilterType] = useState<string[]>([])
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterInvoice, setFilterInvoice] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [summaryPeriod, setSummaryPeriod] = useState('mes')

  // Form
  const [formEnterpriseId, setFormEnterpriseId] = useState('')
  const [form, setForm] = useState({
    description: '', customer_id: '',
    vat_rate: '21', estimated_delivery: '',
    priority: 'normal', notes: '', payment_method: '', bank_id: '',
  })
  const [formItems, setFormItems] = useState<FormItem[]>([emptyFormItem()])
  const [hasDraft, setHasDraft] = useState(false)

  // Persist form draft to localStorage
  useEffect(() => {
    if (showForm) {
      const draft = JSON.stringify({ form, formItems, formEnterpriseId })
      localStorage.setItem(ORDER_DRAFT_KEY, draft)
      setHasDraft(true)
    }
  }, [showForm, form, formItems, formEnterpriseId])

  // Restore draft when opening form
  useEffect(() => {
    if (showForm) {
      const saved = localStorage.getItem(ORDER_DRAFT_KEY)
      if (saved) {
        try {
          const draft = JSON.parse(saved)
          if (draft.form) setForm(draft.form)
          if (draft.formItems?.length) setFormItems(draft.formItems)
          if (draft.formEnterpriseId) setFormEnterpriseId(draft.formEnterpriseId)
          setHasDraft(true)
        } catch { /* ignore corrupt data */ }
      }
    }
  }, [showForm])

  // Check if draft exists on mount
  useEffect(() => {
    setHasDraft(!!localStorage.getItem(ORDER_DRAFT_KEY))
  }, [])

  const clearDraft = () => {
    localStorage.removeItem(ORDER_DRAFT_KEY)
    setHasDraft(false)
    setForm({ description: '', customer_id: '', vat_rate: '21', estimated_delivery: '', priority: 'normal', notes: '', payment_method: '', bank_id: '' })
    setFormItems([emptyFormItem()])
    setFormEnterpriseId('')
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [ordersRes, custRes, prodRes, entRes, banksRes] = await Promise.all([
        api.getOrders({
          status: filterStatus.length === 1 ? filterStatus[0] : undefined,
          product_type: filterType.length === 1 ? filterType[0] : undefined,
          enterprise_id: filterEnterprise || undefined,
          has_invoice: filterInvoice || undefined,
          search: search || undefined,
        }).catch(() => ({ items: [], summary: {} })),
        api.getCustomers().catch(() => ({ items: [] })),
        api.getProducts().catch(() => ({ items: [] })),
        api.getEnterprises().catch(() => []),
        api.getBanks().catch(() => []),
      ])
      setOrders(ordersRes.items || [])
      setSummary(ordersRes.summary || {})
      setCustomers(custRes.items || custRes || [])
      setProducts(prodRes.items || prodRes || [])
      setEnterprises(entRes || [])
      setBanks(banksRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterStatus, filterType, filterEnterprise, filterInvoice])

  const handleSearch = () => loadData()

  // --- Form items management ---

  const addFormItem = () => {
    setFormItems(prev => [...prev, emptyFormItem()])
  }

  const updateFormItem = (idx: number, field: keyof FormItem, value: string | number) => {
    setFormItems(prev => {
      const updated = [...prev]
      const item = { ...updated[idx] }

      if (field === 'product_id') {
        const productId = value as string
        item.product_id = productId
        if (productId && productId !== 'custom') {
          const product = products.find(p => p.id === productId)
          if (product) {
            item.product_name = product.name
            item.unit_price = parseFloat(product.pricing?.final_price || '0') || 0
            item.cost = parseFloat(product.pricing?.cost || '0') || 0
            item.product_type = (product as any).product_type || 'otro'
          }
        } else if (productId === 'custom') {
          item.product_name = ''
          item.unit_price = 0
          item.cost = 0
        }
      } else if (field === 'quantity' || field === 'unit_price' || field === 'cost') {
        (item as any)[field] = typeof value === 'string' ? parseFloat(value) || 0 : value
      } else {
        (item as any)[field] = value
      }

      updated[idx] = item
      return updated
    })
  }

  const removeFormItem = (idx: number) => {
    setFormItems(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
  }

  const getFormItemSubtotal = (item: FormItem) => item.quantity * item.unit_price

  const getFormTotals = () => {
    const subtotal = formItems.reduce((sum, item) => sum + getFormItemSubtotal(item), 0)
    const vat = subtotal * (parseFloat(form.vat_rate) || 0) / 100
    return { subtotal, vat, total: subtotal + vat }
  }

  // --- Order creation ---

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formItems.length === 0 || formItems.every(i => !i.product_name)) {
      setError('Agrega al menos un item con nombre al pedido')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const totals = getFormTotals()
      // Derive order-level product_type from items
      const itemTypes = new Set(formItems.map(i => i.product_type || 'otro'))
      const orderProductType = itemTypes.size === 1 ? formItems[0]?.product_type || 'otro' : 'mixto'
      const payload = {
        title: formItems[0]?.product_name || 'Pedido',
        description: form.description || null,
        product_type: orderProductType,
        customer_id: form.customer_id || null,
        enterprise_id: formEnterpriseId || null,
        bank_id: form.bank_id || null,
        quantity: formItems.reduce((sum, i) => sum + i.quantity, 0),
        unit_price: formItems[0]?.unit_price || 0,
        vat_rate: parseFloat(form.vat_rate),
        total_amount: totals.total,
        estimated_delivery: form.estimated_delivery || null,
        priority: form.priority,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
        items: formItems.map(item => ({
          product_id: item.product_id && item.product_id !== 'custom' ? item.product_id : null,
          product_name: item.product_name,
          description: item.description || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          cost: item.cost || 0,
          product_type: item.product_type || 'otro',
        })),
      }
      if (editingOrderId) {
        await api.updateOrder(editingOrderId, payload)
      } else {
        await api.createOrder(payload)
      }
      setShowForm(false)
      setEditingOrderId(null)
      localStorage.removeItem(ORDER_DRAFT_KEY)
      setHasDraft(false)
      setFormEnterpriseId('')
      setForm({ description: '', customer_id: '', vat_rate: '21', estimated_delivery: '', priority: 'normal', notes: '', payment_method: '', bank_id: '' })
      setFormItems([emptyFormItem()])
      await loadData()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEditOrder = (order: Order) => {
    const status = invoicingStatus[order.id]
    const orderItems: FormItem[] = (status?.items || []).map((item: any) => ({
      product_id: item.product_id || 'custom',
      product_name: item.product_name || '',
      description: item.description || '',
      quantity: Number(item.quantity) || 1,
      unit_price: parseFloat(item.unit_price?.toString() || '0'),
      cost: parseFloat(item.cost?.toString() || '0'),
      product_type: item.product_type || 'otro',
    }))

    setEditingOrderId(order.id)
    setForm({
      description: order.description || '',
      customer_id: order.customer?.id || '',
      vat_rate: order.vat_rate?.toString() || '21',
      estimated_delivery: order.estimated_delivery || '',
      priority: order.priority || 'normal',
      notes: order.notes || '',
      payment_method: order.payment_method || '',
      bank_id: order.bank?.id || '',
    })
    setFormEnterpriseId(order.enterprise?.id || '')
    setFormItems(orderItems.length > 0 ? orderItems : [emptyFormItem()])
    setShowForm(true)
  }

  // --- Status / payment handlers ---

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      await api.updateOrderStatus(orderId, { status: newStatus })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handlePaymentMethodChange = async (orderId: string, method: string) => {
    try {
      await api.updateOrder(orderId, { payment_method: method || null })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handlePaymentStatusChange = async (orderId: string, newStatus: string) => {
    try {
      await api.updateOrder(orderId, { payment_status: newStatus })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm('Estas seguro de eliminar este pedido? Esta accion no se puede deshacer.')) return
    try {
      await api.deleteOrder(orderId)
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  // --- Expand / invoicing ---

  const loadInvoicingStatus = async (orderId: string) => {
    setInvoicingLoading(prev => ({ ...prev, [orderId]: true }))
    try {
      const data = await api.getOrderInvoicingStatus(orderId)
      setInvoicingStatus(prev => ({ ...prev, [orderId]: data }))
      // Initialize invoice qtys from pending quantities
      const qtys: Record<string, number> = {}
      for (const item of (data.items || [])) {
        qtys[item.id] = item.pending_qty
      }
      setInvoiceQtys(prev => ({ ...prev, [orderId]: qtys }))
      if (!invoiceType[orderId]) {
        setInvoiceType(prev => ({ ...prev, [orderId]: 'B' }))
      }
    } catch {
      // Silently fail - invoicing status not critical
    } finally {
      setInvoicingLoading(prev => ({ ...prev, [orderId]: false }))
    }
  }

  const toggleExpand = (orderId: string) => {
    const willExpand = expandedOrder !== orderId
    setExpandedOrder(prev => prev === orderId ? null : orderId)
    if (willExpand) {
      loadInvoicingStatus(orderId)
    }
  }

  const handleShowInvoiceForm = (orderId: string) => {
    setShowInvoiceForm(prev => ({ ...prev, [orderId]: !prev[orderId] }))
  }

  const handleInvoiceQtyChange = (orderId: string, itemId: string, qty: number, max: number) => {
    const clamped = Math.max(0, Math.min(qty, max))
    setInvoiceQtys(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || {}), [itemId]: clamped },
    }))
  }

  const [invoiceProgress, setInvoiceProgress] = useState<Record<string, string>>({})

  // Invoice preview hook
  const invoicePreview = useInvoicePreview({
    onError: (msg) => setError(msg),
    onDataRefresh: useCallback(async () => { await loadData() }, []),
    loadInvoicingStatus,
  })

  const handleCreateInvoice = async (orderId: string) => {
    const status = invoicingStatus[orderId]
    if (!status) return
    if (creatingInvoice[orderId]) return
    const qtys = invoiceQtys[orderId] || {}
    const selectedItems = (status.items || [])
      .filter(item => (qtys[item.id] || 0) > 0)
      .map(item => ({
        order_item_id: item.id,
        quantity: qtys[item.id] || 0,
        product_name: item.product_name || '',
        unit_price: item.unit_price?.toString() || '0',
        vat_rate: item.vat_rate?.toString() || '21',
      }))
    if (selectedItems.length === 0) {
      setError('Selecciona al menos un item con cantidad mayor a 0 para facturar')
      return
    }
    setCreatingInvoice(prev => ({ ...prev, [orderId]: true }))
    setInvoiceProgress(prev => ({ ...prev, [orderId]: 'Creando borrador...' }))
    setError(null)
    try {
      const invoice = await api.createInvoice({
        order_id: orderId,
        invoice_type: invoiceType[orderId] || 'B',
        items: selectedItems,
      })
      setShowInvoiceForm(prev => ({ ...prev, [orderId]: false }))
      await loadInvoicingStatus(orderId)
      await invoicePreview.openPreview(invoice.id, orderId)
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setCreatingInvoice(prev => ({ ...prev, [orderId]: false }))
      setInvoiceProgress(prev => ({ ...prev, [orderId]: '' }))
    }
  }

  const getStatusBadge = (status: string) => {
    const s = STATUS_OPTIONS.find(o => o.value === status)
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s?.color || 'bg-gray-100 text-gray-800'}`}>{s?.label || status}</span>
  }

  const showBankSelector = form.payment_method === 'transferencia' || form.payment_method === 'cheque'

  useEffect(() => { setCurrentPage(1) }, [filterStatus, filterType, filterEnterprise, filterInvoice, dateFrom, dateTo, pageSize])

  // Client-side date filter + pagination
  const filteredOrders = useMemo(() => {
    let result = orders
    if (filterStatus.length > 0) result = result.filter(o => filterStatus.includes(o.status))
    if (filterType.length > 0) result = result.filter(o => filterType.includes(o.product_type))
    if (dateFrom) result = result.filter(o => o.created_at >= dateFrom)
    if (dateTo) result = result.filter(o => o.created_at <= dateTo + 'T23:59:59')
    return result
  }, [orders, filterStatus, filterType, dateFrom, dateTo])

  const periodSummary = useMemo(() => {
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    let pFrom = '', pTo = today
    if (summaryPeriod === 'hoy') { pFrom = today }
    else if (summaryPeriod === 'semana') { const d = new Date(now); d.setDate(now.getDate() - now.getDay() + 1); pFrom = d.toISOString().split('T')[0] }
    else if (summaryPeriod === 'mes') { pFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0] }
    else if (summaryPeriod === '3meses') { pFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0] }
    else if (summaryPeriod === 'anual') { pFrom = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0] }

    const filtered = pFrom ? orders.filter(o => o.created_at >= pFrom) : orders
    return {
      pendientes: filtered.filter(o => o.status === 'pendiente').length,
      en_produccion: filtered.filter(o => o.status === 'en_produccion').length,
      terminados: filtered.filter(o => o.status === 'terminado').length,
      entregados: filtered.filter(o => o.status === 'entregado').length,
      total_facturado: filtered.reduce((s, o) => s + (parseFloat(o.total_amount?.toString() || '0')), 0),
      total: filtered.length,
    }
  }, [orders, summaryPeriod])

  const totalPages = Math.ceil(filteredOrders.length / pageSize)
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = filterStatus.length > 0 || filterType.length > 0 || !!filterEnterprise || !!filterInvoice || !!search || !!dateFrom || !!dateTo

  const csvColumns = [
    { key: 'order_number', label: 'N Pedido' },
    { key: 'created_at', label: 'Fecha' },
    { key: 'title', label: 'Producto' },
    { key: 'total_amount', label: 'Total' },
    { key: 'payment_status', label: 'Estado Pago' },
    { key: 'status', label: 'Estado' },
    { key: 'payment_method', label: 'Metodo Pago' },
  ]
  const csvData = filteredOrders.map(o => ({
    ...o,
    order_number: `#${String(o.order_number).padStart(4, '0')}`,
    total_amount: o.total_amount,
    enterprise_name: o.enterprise?.name || '',
  }))

  const clearFilters = () => {
    setFilterStatus([])
    setFilterType([])
    setFilterEnterprise('')
    setFilterInvoice('')
    setSearch('')
    setDateFrom('')
    setDateTo('')
  }

  const formTotals = getFormTotals()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos / Ventas</h1>
          <p className="text-sm text-gray-500 mt-1">{summary.total || 0} pedidos registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={csvColumns} filename="pedidos" />
          {hasDraft && !showForm && (
            <button onClick={() => { setShowForm(true) }} className="text-sm text-blue-600 hover:underline">
              Continuar borrador
            </button>
          )}
          {showForm && hasDraft && (
            <button onClick={clearDraft} className="text-sm text-red-600 hover:underline">
              Limpiar borrador
            </button>
          )}
          <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setShowForm(!showForm); if (showForm) setEditingOrderId(null) }}>
            {showForm ? 'Cancelar' : '+ Nuevo Pedido'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Period Selector + Summary Cards */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">Resumen:</span>
        <PeriodSelector selected={summaryPeriod} onChange={p => setSummaryPeriod(p.value)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="border border-yellow-200 bg-yellow-50">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-yellow-700 truncate">Pendientes</p>
            <p className="text-lg md:text-xl font-bold text-yellow-800 truncate">{periodSummary.pendientes}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-blue-700 truncate">En Produccion</p>
            <p className="text-lg md:text-xl font-bold text-blue-800 truncate">{periodSummary.en_produccion}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-green-700 truncate">Terminados</p>
            <p className="text-lg md:text-xl font-bold text-green-800 truncate">{periodSummary.terminados}</p>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200 bg-emerald-50">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-emerald-700 truncate">Entregados</p>
            <p className="text-lg md:text-xl font-bold text-emerald-800 truncate">{periodSummary.entregados}</p>
          </CardContent>
        </Card>
        <Card className="border border-indigo-200 bg-indigo-50">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-indigo-700 truncate">Facturado</p>
            <p className="text-lg md:text-xl font-bold text-indigo-800 truncate">{formatCurrency(periodSummary.total_facturado)}</p>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200 bg-emerald-50">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-emerald-700 truncate">Ganancia Total</p>
            <p className="text-lg md:text-xl font-bold text-emerald-800 truncate">{formatCurrency(summary.ganancia_total || 0)} <span className="text-xs font-normal">(total)</span></p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MultiSelectFilter
              label="Estado"
              options={STATUS_OPTIONS.filter(s => s.value !== 'todos').map(s => ({ value: s.value, label: s.label }))}
              selected={filterStatus}
              onChange={setFilterStatus}
              placeholder="Todos"
            />
            <MultiSelectFilter
              label="Tipo"
              options={PRODUCT_TYPES.filter(t => t.value !== 'todos' && t.value !== 'mixto').map(t => ({ value: t.value, label: t.label }))}
              selected={filterType}
              onChange={setFilterType}
              placeholder="Todos"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Empresa</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todas</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Factura</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterInvoice} onChange={e => setFilterInvoice(e.target.value)}>
                <option value="">Todos</option>
                <option value="si">Con factura</option>
                <option value="no">Sin factura</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Buscar</label>
              <div className="flex gap-1">
                <input className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="Producto, cliente..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
                <button onClick={handleSearch} className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Ir</button>
              </div>
            </div>
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onClear={() => { setDateFrom(''); setDateTo('') }} label="Fecha Creacion" />
          </div>
        </CardContent>
      </Card>

      {/* Create Order Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">{editingOrderId ? 'Editar Pedido' : 'Nuevo Pedido'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleCreateOrder} className="space-y-4">

              {/* Enterprise + Customer selector */}
              <EnterpriseCustomerSelector
                enterprises={enterprises}
                customers={customers}
                selectedEnterpriseId={formEnterpriseId}
                selectedCustomerId={form.customer_id}
                onEnterpriseChange={id => setFormEnterpriseId(id)}
                onCustomerChange={id => setForm(f => ({ ...f, customer_id: id }))}
                enterpriseLabel="Empresa"
                customerLabel="Cliente / Contacto"
              />

              {/* Description */}
              <div className="grid grid-cols-1 gap-4">
                <Input label="Descripcion general" placeholder="Detalles del trabajo..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>

              {/* Items section */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">Items del Pedido</h4>
                  <button type="button" onClick={addFormItem} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
                    + Agregar Item
                  </button>
                </div>

                <div className="space-y-3">
                  {formItems.map((item, idx) => (
                    <div key={idx} className="bg-white border border-gray-200 rounded-lg p-3">
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                        {/* Product type */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Tipo</label>
                          <input
                            list={`product-type-list-${idx}`}
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={item.product_type}
                            onChange={e => updateFormItem(idx, 'product_type', e.target.value)}
                            placeholder="Tipo..."
                          />
                          <datalist id={`product-type-list-${idx}`}>
                            {PRODUCT_TYPES.filter(t => t.value !== 'todos' && t.value !== 'mixto').map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </datalist>
                        </div>
                        {/* Product selector */}
                        <div className="md:col-span-2 flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Producto</label>
                          <select
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={item.product_id}
                            onChange={e => updateFormItem(idx, 'product_id', e.target.value)}
                          >
                            <option value="">Seleccionar producto...</option>
                            {products.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name}{p.pricing?.final_price ? ` (${formatCurrency(parseFloat(p.pricing.final_price))})` : ''}
                              </option>
                            ))}
                            <option value="custom">Producto personalizado...</option>
                          </select>
                          {(!item.product_id || item.product_id === 'custom') && (
                            <input
                              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Nombre del producto/servicio"
                              value={item.product_name}
                              onChange={e => updateFormItem(idx, 'product_name', e.target.value)}
                              required
                            />
                          )}
                        </div>
                        {/* Quantity */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Cantidad</label>
                          <input
                            type="number" min="1"
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={item.quantity}
                            onChange={e => updateFormItem(idx, 'quantity', e.target.value)}
                            required
                          />
                        </div>
                        {/* Unit price */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Precio Unitario</label>
                          <input
                            type="number" step="0.01" min="0"
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0.00"
                            value={item.unit_price || ''}
                            onChange={e => updateFormItem(idx, 'unit_price', e.target.value)}
                            required
                          />
                        </div>
                        {/* Cost tracked internally from product pricing, not shown to user */}
                        {/* Subtotal + remove */}
                        <div className="flex items-end gap-2">
                          <div className="flex-1 flex flex-col gap-1">
                            <label className="text-xs font-medium text-gray-500">Subtotal</label>
                            <div className="px-2 py-1.5 bg-green-50 border border-green-300 rounded-lg text-sm font-bold text-green-800">
                              {formatCurrency(getFormItemSubtotal(item))}
                            </div>
                          </div>
                          {formItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeFormItem(idx)}
                              className="px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors"
                              title="Eliminar item"
                            >
                              x
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Description */}
                      <div className="mt-2">
                        <input
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Descripcion adicional del item (opcional)"
                          value={item.description}
                          onChange={e => updateFormItem(idx, 'description', e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="mt-4 flex justify-end">
                  <div className="w-72 space-y-1">
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className="text-sm text-gray-600">% IVA:</span>
                      <input
                        type="number" step="0.01" placeholder="21"
                        list="order-vat-rate-list"
                        className="px-2 py-1 border border-gray-300 rounded text-sm w-20"
                        value={form.vat_rate}
                        onChange={e => setForm({ ...form, vat_rate: e.target.value })}
                      />
                      <datalist id="order-vat-rate-list">
                        <option value="0">0%</option>
                        <option value="10.5">10.5%</option>
                        <option value="21">21%</option>
                        <option value="27">27%</option>
                      </datalist>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal Neto:</span>
                      <span className="font-medium">{formatCurrency(formTotals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>IVA ({form.vat_rate}%):</span>
                      <span className="font-medium">{formatCurrency(formTotals.vat)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold text-green-800 pt-2 border-t border-gray-300">
                      <span>TOTAL:</span>
                      <span>{formatCurrency(formTotals.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment + delivery + priority */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Forma de Pago</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                {showBankSelector && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Banco</label>
                    <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })}>
                      <option value="">Seleccionar banco...</option>
                      {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name}</option>)}
                    </select>
                  </div>
                )}
                <Input label="Fecha Estimada de Entrega" type="date" value={form.estimated_delivery} onChange={e => setForm({ ...form, estimated_delivery: e.target.value })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Prioridad</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                    <option value="baja">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </div>
                <Input label="Notas" placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              <Button type="submit" variant="success" loading={saving}>{editingOrderId ? 'Guardar Cambios' : 'Crear Pedido'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Orders Table with expandable rows */}
      {loading ? (
        <Card><CardContent><p className="text-center py-8 text-gray-500">Cargando pedidos...</p></CardContent></Card>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay pedidos con estos filtros' : 'No hay pedidos registrados'}
          description={isFiltered ? undefined : 'Crea el primer pedido para empezar'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Nuevo Pedido'}
          onAction={isFiltered ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-3">N</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Pago</th>
                  <th className="px-4 py-3 text-center">Estado / Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.map(order => (
                  <React.Fragment key={order.id}>
                    {/* Compact row */}
                    <tr
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${expandedOrder === order.id ? 'bg-blue-50 border-b-0' : 'border-b'}`}
                      onClick={() => toggleExpand(order.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-blue-700">#{String(order.order_number || 0).padStart(4, '0')}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(order.created_at)}</td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{order.enterprise?.name || '-'}</p>
                          {order.customer?.name && <p className="text-xs text-gray-500">{order.customer.name}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-sm">{order.title}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                            {PRODUCT_TYPES.find(t => t.value === order.product_type)?.label || order.product_type}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-green-700">{formatCurrency(parseFloat(order.total_amount || '0'))}</span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer appearance-none text-center ${
                            order.payment_status === 'pagado'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                          value={order.payment_status}
                          onChange={e => { e.stopPropagation(); handlePaymentStatusChange(order.id, e.target.value) }}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="pendiente">No pagado</option>
                          <option value="pagado">Pagado</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <select
                            className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer appearance-none text-center ${
                              STATUS_OPTIONS.find(s => s.value === order.status)?.color || 'bg-gray-100 text-gray-800'
                            }`}
                            value={order.status}
                            onChange={e => { e.stopPropagation(); handleStatusChange(order.id, e.target.value) }}
                            onClick={e => e.stopPropagation()}
                          >
                            {STATUS_OPTIONS.filter(s => s.value !== 'todos').map(s => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={e => { e.stopPropagation(); handleEditOrder(order) }}
                            className="text-blue-500 hover:text-blue-700 text-xs font-medium"
                            title="Editar pedido"
                          >
                            Editar
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleDeleteOrder(order.id) }}
                            className="w-6 h-6 flex items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-700 transition-colors text-sm"
                            title="Eliminar pedido"
                          >
                            x
                          </button>
                          <span className="text-gray-400 text-xs">{expandedOrder === order.id ? 'v' : 'v'}</span>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedOrder === order.id && (
                      <tr>
                        <td colSpan={7} className="px-0 py-0 border-b-2 border-blue-300">
                          <div className="mx-3 my-3 bg-blue-50 border border-blue-200 rounded-lg shadow-sm overflow-hidden animate-slideDown">
                            <div className="border-l-4 border-blue-500 px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                                {/* Column 1: Product & Items details */}
                                <div className="space-y-2 min-w-0 overflow-hidden">
                                  <h4 className="text-sm font-semibold text-blue-800 border-b border-blue-200 pb-1">Detalle del Pedido</h4>
                                  {order.description && (
                                    <div>
                                      <p className="text-xs text-gray-500">Descripcion</p>
                                      <p className="text-sm text-gray-800 break-words whitespace-pre-wrap">{order.description}</p>
                                    </div>
                                  )}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <p className="text-xs text-gray-500">Precio Unitario</p>
                                      <p className="text-sm font-medium">{formatCurrency(parseFloat(order.unit_price || '0'))}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">Cantidad</p>
                                      <p className="text-sm font-medium">{order.quantity}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">IVA</p>
                                      <p className="text-sm font-medium">{order.vat_rate}%</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">Ganancia Est.</p>
                                      <p className="text-sm font-medium text-green-700">{formatCurrency(parseFloat(order.estimated_profit || '0'))}</p>
                                    </div>
                                  </div>
                                  {order.notes && (
                                    <div>
                                      <p className="text-xs text-gray-500">Notas</p>
                                      <p className="text-sm text-gray-700 bg-yellow-50 px-2 py-1 rounded break-words whitespace-pre-wrap">{order.notes}</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-500">Prioridad</p>
                                    <p className={`text-sm font-medium ${PRIORITY_LABELS[order.priority]?.color || ''}`}>
                                      {PRIORITY_LABELS[order.priority]?.label || order.priority}
                                    </p>
                                  </div>
                                </div>

                                {/* Column 2: Delivery & Dates */}
                                <div className="space-y-2 min-w-0 overflow-hidden">
                                  <h4 className="text-sm font-semibold text-blue-800 border-b border-blue-200 pb-1">Entrega y Fechas</h4>
                                  <div>
                                    <p className="text-xs text-gray-500">Fecha de Creacion</p>
                                    <p className="text-sm text-gray-800">{formatDate(order.created_at)}</p>
                                  </div>
                                  {order.estimated_delivery && (
                                    <div>
                                      <p className="text-xs text-gray-500">Entrega Estimada</p>
                                      <p className="text-sm text-gray-800">{formatDate(order.estimated_delivery)}</p>
                                    </div>
                                  )}
                                  {order.actual_delivery && (
                                    <div>
                                      <p className="text-xs text-gray-500">Entrega Real</p>
                                      <p className="text-sm text-green-700 font-medium">{formatDate(order.actual_delivery)}</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-500">Cliente</p>
                                    <p className="text-sm text-gray-800">{order.customer?.name || 'Sin cliente'}</p>
                                    {order.customer?.cuit && <p className="text-xs text-gray-500 font-mono">{order.customer.cuit}</p>}
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">Empresa</p>
                                    <p className="text-sm text-gray-800">{order.enterprise?.name || 'Sin empresa'}</p>
                                  </div>
                                </div>

                                {/* Column 3: Invoicing & Payment */}
                                <div className="space-y-2 min-w-0 overflow-hidden">
                                  <h4 className="text-sm font-semibold text-blue-800 border-b border-blue-200 pb-1">Facturacion y Pago</h4>

                                  {/* Payment method */}
                                  <div>
                                    <p className="text-xs text-gray-500">Forma de Pago</p>
                                    <select
                                      className="text-sm border rounded px-2 py-1 w-full"
                                      value={order.payment_method || ''}
                                      onChange={e => handlePaymentMethodChange(order.id, e.target.value)}
                                    >
                                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                  </div>
                                  {order.bank && (
                                    <div>
                                      <p className="text-xs text-gray-500">Banco</p>
                                      <p className="text-sm text-gray-800">{order.bank.bank_name}</p>
                                    </div>
                                  )}

                                  {/* Payment status */}
                                  <div>
                                    <p className="text-xs text-gray-500">Estado de Pago</p>
                                    <select
                                      className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${
                                        order.payment_status === 'pagado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                      }`}
                                      value={order.payment_status}
                                      onChange={e => handlePaymentStatusChange(order.id, e.target.value)}
                                    >
                                      <option value="pendiente">No pagado</option>
                                      <option value="pagado">Pagado</option>
                                    </select>
                                  </div>

                                  {/* Invoicing section */}
                                  <div className="pt-1 border-t border-blue-200">
                                    <p className="text-xs text-gray-500 mb-1.5">Facturacion AFIP</p>
                                    {invoicingLoading[order.id] ? (
                                      <p className="text-xs text-gray-400 italic">Cargando estado...</p>
                                    ) : (() => {
                                      const status = invoicingStatus[order.id]
                                      if (!status) return null

                                      return (
                                        <div className="space-y-2">
                                          {/* Status indicator + action button */}
                                          {status.invoicing_status === 'sin_facturar' && (
                                            <button
                                              onClick={() => handleShowInvoiceForm(order.id)}
                                              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                                            >
                                              Facturar
                                            </button>
                                          )}
                                          {status.invoicing_status === 'parcial' && (
                                            <div className="space-y-1">
                                              <button
                                                onClick={() => handleShowInvoiceForm(order.id)}
                                                className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-medium hover:bg-yellow-600 transition-colors"
                                              >
                                                Facturar Restante
                                              </button>
                                              <p className="text-xs text-yellow-700 font-medium">Parcialmente facturado</p>
                                            </div>
                                          )}
                                          {status.invoicing_status === 'facturado' && (
                                            <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                                              Facturado
                                            </span>
                                          )}

                                          {/* List of existing invoices */}
                                          {(status.invoices || []).length > 0 && (
                                            <div className="space-y-1">
                                              {status.invoices.map(inv => (
                                                <div key={inv.id} className="flex items-center gap-2 bg-white border border-indigo-200 rounded px-2 py-1.5">
                                                  <span className="font-mono text-xs font-semibold text-indigo-800">
                                                    {inv.invoice_type} {inv.punto_venta ? `${String(inv.punto_venta).padStart(5, '0')}-` : ''}{String(inv.invoice_number).padStart(8, '0')}
                                                  </span>
                                                  <span className="text-xs text-gray-500">{formatCurrency(parseFloat(inv.total_amount || '0'))}</span>
                                                  {inv.status === 'draft' ? (
                                                    <>
                                                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded font-medium">Borrador</span>
                                                      <button
                                                        onClick={() => invoicePreview.openPreview(inv.id, order.id)}
                                                        className="ml-auto text-xs bg-green-600 text-white px-2 py-0.5 rounded hover:bg-green-700 transition-colors"
                                                      >
                                                        Ver / Autorizar
                                                      </button>
                                                      <button
                                                        onClick={() => invoicePreview.deleteDraft(inv.id, order.id)}
                                                        className="text-xs text-red-500 hover:text-red-700 px-1"
                                                        title="Eliminar borrador"
                                                      >
                                                        x
                                                      </button>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-800 rounded font-medium">
                                                        {inv.cae ? 'AFIP' : 'Autorizada'}
                                                      </span>
                                                      <button
                                                        onClick={() => invoicePreview.openPreview(inv.id, order.id)}
                                                        className="ml-auto text-xs bg-gray-500 text-white px-2 py-0.5 rounded hover:bg-gray-600 transition-colors"
                                                      >
                                                        Ver
                                                      </button>
                                                      <button
                                                        onClick={() => invoicePreview.downloadPdf(inv.id, inv)}
                                                        className="text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded hover:bg-indigo-700 transition-colors"
                                                        title="Descargar PDF"
                                                      >
                                                        PDF
                                                      </button>
                                                    </>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {/* Inline invoice creation form */}
                                          {showInvoiceForm[order.id] && status.invoicing_status !== 'facturado' && (
                                            <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                                              <div className="flex items-center justify-between">
                                                <p className="text-xs font-semibold text-gray-700">Crear Factura</p>
                                                <button
                                                  onClick={() => handleShowInvoiceForm(order.id)}
                                                  className="text-gray-400 hover:text-gray-600 text-xs"
                                                >
                                                  Cerrar
                                                </button>
                                              </div>

                                              {/* Invoice type selector */}
                                              <div className="flex items-center gap-2">
                                                <label className="text-xs text-gray-500">Tipo:</label>
                                                <select
                                                  className="px-2 py-1 border border-gray-300 rounded text-xs"
                                                  value={invoiceType[order.id] || 'B'}
                                                  onChange={e => setInvoiceType(prev => ({ ...prev, [order.id]: e.target.value }))}
                                                >
                                                  {INVOICE_TYPES.map(t => <option key={t} value={t}>Factura {t}</option>)}
                                                </select>
                                              </div>

                                              {/* Items table */}
                                              {(status.items || []).length > 0 ? (
                                                <div className="overflow-x-auto">
                                                  <table className="w-full text-xs">
                                                    <thead>
                                                      <tr className="bg-gray-50 text-gray-500">
                                                        <th className="px-2 py-1 text-left">Producto</th>
                                                        <th className="px-2 py-1 text-center">Total</th>
                                                        <th className="px-2 py-1 text-center">Facturado</th>
                                                        <th className="px-2 py-1 text-center">Pendiente</th>
                                                        <th className="px-2 py-1 text-center">A facturar</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {status.items.map(item => {
                                                        const qtyToInvoice = invoiceQtys[order.id]?.[item.id] ?? item.pending_qty
                                                        const subtotal = qtyToInvoice * parseFloat(item.unit_price || '0')
                                                        return (
                                                          <tr key={item.id} className="border-t border-gray-100">
                                                            <td className="px-2 py-1">{item.product_name}</td>
                                                            <td className="px-2 py-1 text-center">{item.quantity}</td>
                                                            <td className="px-2 py-1 text-center text-green-700">{item.invoiced_qty}</td>
                                                            <td className="px-2 py-1 text-center text-orange-600">{item.pending_qty}</td>
                                                            <td className="px-2 py-1 text-center">
                                                              <input
                                                                type="number"
                                                                min="0"
                                                                max={item.pending_qty}
                                                                value={qtyToInvoice}
                                                                onChange={e => handleInvoiceQtyChange(order.id, item.id, parseInt(e.target.value) || 0, item.pending_qty)}
                                                                className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs text-center"
                                                                disabled={item.pending_qty === 0}
                                                              />
                                                            </td>
                                                          </tr>
                                                        )
                                                      })}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              ) : (
                                                <p className="text-xs text-gray-400 italic">No hay items pendientes</p>
                                              )}

                                              {/* Create invoice button */}
                                              {creatingInvoice[order.id] ? (
                                                <div className="w-full px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                                                  <div className="flex items-center justify-center gap-2">
                                                    <svg className="animate-spin h-4 w-4 text-indigo-600" viewBox="0 0 24 24">
                                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                                    </svg>
                                                    <span className="text-xs font-medium text-indigo-700">
                                                      {invoiceProgress[order.id] || 'Procesando...'}
                                                    </span>
                                                  </div>
                                                  <p className="text-[10px] text-indigo-500 mt-1">No cierres esta ventana</p>
                                                </div>
                                              ) : (
                                                <button
                                                  onClick={() => handleCreateInvoice(order.id)}
                                                  disabled={creatingInvoice[order.id]}
                                                  className="w-full px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                  Crear Borrador de Factura
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                </div>

                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredOrders.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      {/* Invoice Preview / Authorize Modal */}
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
        />
      )}
    </div>
  )
}
