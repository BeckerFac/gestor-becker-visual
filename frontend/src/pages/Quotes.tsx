import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { QuotePreviewModal } from '@/components/shared/QuotePreviewModal'
import { HelpTip } from '@/components/shared/HelpTip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteItem {
  product_name: string
  description: string
  quantity: number
  unit_price: number
  vat_rate: number
  subtotal: number
}

interface Quote {
  id: string
  quote_number: number
  title: string
  status: string
  subtotal: string
  vat_amount: string
  total_amount: string
  valid_until: string | null
  notes: string | null
  customer?: { id: string; name: string; cuit: string }
  enterprise?: { id: string; name: string } | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  items?: QuoteItem[]
  created_at: string
}

interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null }
interface Enterprise { id: string; name: string; cuit?: string | null }
interface Product { id: string; name: string; sku: string; pricing?: { cost: string; final_price: string; vat_rate: string } }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  accepted: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  expired: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Borrador' },
  { value: 'sent', label: 'Enviada' },
  { value: 'accepted', label: 'Aceptada' },
  { value: 'rejected', label: 'Rechazada' },
]

const PAGE_SIZE = 15

const CSV_COLUMNS = [
  { key: 'quote_number', label: 'N° Cotizacion' },
  { key: 'title', label: 'Titulo' },
  { key: 'customer', label: 'Cliente' },
  { key: 'enterprise', label: 'Empresa' },
  { key: 'date', label: 'Fecha' },
  { key: 'valid_until', label: 'Valida hasta' },
  { key: 'total', label: 'Total' },
  { key: 'status', label: 'Estado' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasActiveFilters(filters: {
  enterprise_id: string; status: string; search: string; date_from: string; date_to: string
}) {
  return !!(filters.enterprise_id || filters.status || filters.search || filters.date_from || filters.date_to)
}

// ─── Component ────────────────────────────────────────────────────────────────

export const Quotes: React.FC = () => {
  // Data
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [total, setTotal] = useState(0)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  // Preview modal state
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null)

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Form state
  const [form, setForm] = useState({
    title: '',
    customer_id: '',
    valid_until: '',
    notes: '',
  })
  const [formEnterpriseId, setFormEnterpriseId] = useState<string>('')
  const [items, setItems] = useState<{
    product_id: string
    product_name: string
    description: string
    quantity: string
    unit_price: string
    vat_rate: string
  }[]>([])

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadQuotes = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const filters: Record<string, any> = {
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }
      if (filterEnterprise) filters.enterprise_id = filterEnterprise
      if (filterStatus) filters.status = filterStatus
      if (filterSearch) filters.search = filterSearch
      if (filterDateFrom) filters.date_from = filterDateFrom
      if (filterDateTo) filters.date_to = filterDateTo

      const res = await api.getQuotes(filters).catch(() => ({ items: [], total: 0 }))
      setQuotes(res.items ?? [])
      setTotal(res.total ?? 0)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise, filterStatus, filterSearch, filterDateFrom, filterDateTo])

  const loadStaticData = useCallback(async () => {
    const [custRes, prodRes, entRes] = await Promise.all([
      api.getCustomers().catch(() => ({ items: [] })),
      api.getProducts().catch(() => ({ items: [] })),
      api.getEnterprises().catch(() => []),
    ])
    setCustomers(custRes.items || custRes || [])
    setProducts(prodRes.items || prodRes || [])
    setEnterprises(Array.isArray(entRes) ? entRes : (entRes.items || []))
  }, [])

  useEffect(() => {
    loadStaticData()
  }, [loadStaticData])

  useEffect(() => {
    setCurrentPage(1)
    loadQuotes(1)
  }, [loadQuotes])

  // ── Filter helpers ─────────────────────────────────────────────────────────

  const activeFilters = hasActiveFilters({
    enterprise_id: filterEnterprise,
    status: filterStatus,
    search: filterSearch,
    date_from: filterDateFrom,
    date_to: filterDateTo,
  })

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterStatus('')
    setFilterSearch('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  // ── Form handlers ─────────────────────────────────────────────────────────

  const addItem = () => {
    setItems([...items, { product_id: '', product_name: '', description: '', quantity: '1', unit_price: '', vat_rate: '21' }])
  }

  const updateItem = (idx: number, field: string, value: string) => {
    const updated = [...items]
    updated[idx] = { ...updated[idx], [field]: value }

    if (field === 'product_id' && value) {
      const prod = products.find(p => p.id === value)
      if (prod) {
        updated[idx].product_name = prod.name
        if (prod.pricing?.final_price) updated[idx].unit_price = prod.pricing.final_price
        if (prod.pricing?.vat_rate) updated[idx].vat_rate = prod.pricing.vat_rate
      }
    }

    setItems(updated)
  }

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const getItemSubtotal = (item: typeof items[0]) => {
    return (parseFloat(item.unit_price) || 0) * (parseInt(item.quantity) || 0)
  }

  const getTotals = () => {
    let subtotal = 0
    let vatAmount = 0
    for (const item of items) {
      const sub = getItemSubtotal(item)
      subtotal += sub
      vatAmount += sub * (parseFloat(item.vat_rate) || 21) / 100
    }
    return { subtotal, vatAmount, total: subtotal + vatAmount }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (items.length === 0) {
      setError('Agrega al menos un item a la cotizacion')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.createQuote({
        title: form.title || 'Cotizacion',
        customer_id: form.customer_id || null,
        enterprise_id: formEnterpriseId || undefined,
        valid_until: form.valid_until || null,
        notes: form.notes || null,
        items: items.map(item => ({
          product_id: item.product_id || null,
          product_name: item.product_name,
          description: item.description || null,
          quantity: parseInt(item.quantity) || 1,
          unit_price: parseFloat(item.unit_price) || 0,
          vat_rate: parseFloat(item.vat_rate) || 21,
        })),
      })
      toast.success('Cotizacion creada correctamente')
      setShowForm(false)
      setForm({ title: '', customer_id: '', valid_until: '', notes: '' })
      setFormEnterpriseId('')
      setItems([])
      await loadQuotes(currentPage)
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const openPreviewModal = (quoteId: string) => {
    setPreviewQuoteId(quoteId)
  }

  const closePreviewModal = () => {
    setPreviewQuoteId(null)
  }

  const handlePreviewSaved = () => {
    loadQuotes(currentPage)
  }

  const handleStatusChange = async (quoteId: string, newStatus: string) => {
    try {
      setUpdatingStatusId(quoteId)
      setError(null)
      setStatusMessage(null)
      const result = await api.updateQuoteStatus(quoteId, newStatus)
      if (result.order) {
        toast.success(`Pedido #${String(result.order.order_number).padStart(4, '0')} creado automaticamente`)
        setStatusMessage(`Pedido #${String(result.order.order_number).padStart(4, '0')} creado automaticamente`)
        setTimeout(() => setStatusMessage(null), 5000)
      } else {
        toast.success('Estado actualizado')
      }
      await loadQuotes(currentPage)
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setUpdatingStatusId(null)
    }
  }

  // ── CSV data ───────────────────────────────────────────────────────────────

  const csvData = quotes.map(q => ({
    quote_number: `#${String(q.quote_number || 0).padStart(4, '0')}`,
    title: q.title || '-',
    customer: q.customer?.name ?? '-',
    enterprise: q.enterprise?.name ?? '-',
    date: formatDate(q.created_at),
    valid_until: q.valid_until ? formatDate(q.valid_until) : '-',
    total: formatCurrency(parseFloat(q.total_amount || '0')),
    status: STATUS_LABELS[q.status] ?? q.status,
  }))

  // ── Pagination ─────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const totals = getTotals()

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    loadQuotes(page)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cotizaciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} cotizacion{total !== 1 ? 'es' : ''} registrada{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={CSV_COLUMNS} filename="cotizaciones" />
          <ExportExcelButton data={csvData} columns={CSV_COLUMNS} filename="cotizaciones" />
          <PermissionGate module="quotes" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setShowForm(!showForm); if (!showForm && items.length === 0) addItem() }}>
              {showForm ? 'Cancelar' : '+ Nueva Cotizacion'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 font-bold text-red-500 hover:text-red-700">x</button>
        </div>
      )}

      {/* Status message */}
      {statusMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="ml-3 font-bold text-green-500 hover:text-green-700">x</button>
        </div>
      )}

      {/* Filters card */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {/* Enterprise filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Empresa</label>
              <select
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={filterEnterprise}
                onChange={e => setFilterEnterprise(e.target.value)}
              >
                <option value="">Todas las empresas</option>
                {enterprises.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>

            {/* Status filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Estado</label>
              <select
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">Todos los estados</option>
                {STATUS_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Buscar</label>
              <input
                type="text"
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Cliente, titulo, numero..."
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
              />
            </div>

            {/* Date range */}
            <div className="sm:col-span-2 lg:col-span-2">
              <DateRangeFilter
                dateFrom={filterDateFrom}
                dateTo={filterDateTo}
                onDateFromChange={setFilterDateFrom}
                onDateToChange={setFilterDateTo}
                onClear={() => { setFilterDateFrom(''); setFilterDateTo('') }}
                label="Rango de fechas"
              />
            </div>

            {/* Clear filters */}
            {activeFilters && (
              <div className="flex items-end">
                <button
                  onClick={clearFilters}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Creation form */}
      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">Nueva Cotizacion</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Basic info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Titulo" placeholder="Ej: Cotizacion Banners Evento" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Valida hasta<HelpTip text="Cantidad de dias que la cotizacion es valida. Despues de este plazo, se marca como vencida." /></label>
                    <Input type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} />
                  </div>
                  <Input label="Notas / Observaciones" placeholder="Tiempo de produccion, condiciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              {/* Enterprise and Customer selector */}
              <EnterpriseCustomerSelector
                enterprises={enterprises}
                customers={customers}
                selectedEnterpriseId={formEnterpriseId}
                selectedCustomerId={form.customer_id}
                onEnterpriseChange={id => setFormEnterpriseId(id)}
                onCustomerChange={id => setForm({ ...form, customer_id: id })}
              />

              {/* Items section */}
              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Items de la Cotizacion</h4>
                  <button type="button" onClick={addItem} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
                    + Agregar Item
                  </button>
                </div>

                {items.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No hay items. Hace click en "+ Agregar Item" para comenzar.</p>
                ) : (
                  <div className="space-y-3">
                    {items.map((item, idx) => (
                      <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                          {/* Product selector or custom name */}
                          <div className="md:col-span-2 flex flex-col gap-1">
                            <label className="text-xs font-medium text-gray-500">Producto</label>
                            <select
                              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={item.product_id}
                              onChange={e => updateItem(idx, 'product_id', e.target.value)}
                            >
                              <option value="">Producto personalizado...</option>
                              {products.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name} {p.pricing?.final_price ? `(${formatCurrency(parseFloat(p.pricing.final_price))})` : ''}
                                </option>
                              ))}
                            </select>
                            {!item.product_id && (
                              <input
                                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Nombre del producto/servicio"
                                value={item.product_name}
                                onChange={e => updateItem(idx, 'product_name', e.target.value)}
                                required
                              />
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-gray-500">Cantidad</label>
                            <input type="number" min="1" className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} required />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-gray-500">Precio Unitario</label>
                            <input type="number" step="0.01" className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} required />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-gray-500">IVA %</label>
                            <input
                              type="number" step="0.01" placeholder="21"
                              list={`quote-vat-list-${idx}`}
                              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 w-20"
                              value={item.vat_rate}
                              onChange={e => updateItem(idx, 'vat_rate', e.target.value)}
                            />
                            <datalist id={`quote-vat-list-${idx}`}>
                              <option value="0">0%</option>
                              <option value="10.5">10.5%</option>
                              <option value="21">21%</option>
                              <option value="27">27%</option>
                            </datalist>
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1 flex flex-col gap-1">
                              <label className="text-xs font-medium text-gray-500">Subtotal</label>
                              <div className="px-2 py-1.5 bg-green-50 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg text-sm font-bold text-green-800 dark:text-green-300">
                                {formatCurrency(getItemSubtotal(item))}
                              </div>
                            </div>
                            <button type="button" onClick={() => removeItem(idx)} className="px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors" title="Eliminar item">
                              x
                            </button>
                          </div>
                        </div>
                        {/* Description */}
                        <div className="mt-2">
                          <input className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Descripcion adicional (opcional)" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Totals */}
                {items.length > 0 && (
                  <div className="mt-4 flex justify-end">
                    <div className="w-72 space-y-1">
                      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>Subtotal Neto:</span>
                        <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>IVA:</span>
                        <span className="font-medium">{formatCurrency(totals.vatAmount)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold text-green-800 dark:text-green-400 pt-2 border-t border-gray-300 dark:border-gray-600">
                        <span>TOTAL:</span>
                        <span>{formatCurrency(totals.total)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button type="submit" variant="success" loading={saving}>Crear Cotizacion</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Quotes table */}
      {loading ? (
        <Card>
          <CardContent>
            <SkeletonTable rows={6} cols={9} />
          </CardContent>
        </Card>
      ) : quotes.length === 0 ? (
        <EmptyState
          icon="📋"
          title={activeFilters ? 'No se encontraron cotizaciones' : 'Sin cotizaciones registradas'}
          description={
            activeFilters
              ? undefined
              : 'Crea la primera cotizacion usando el boton "+ Nueva Cotizacion".'
          }
          variant={activeFilters ? 'filtered' : 'empty'}
          actionLabel={activeFilters ? 'Limpiar filtros' : '+ Nueva Cotizacion'}
          onAction={activeFilters ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">N°</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Titulo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Empresa</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Valida hasta</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {quotes.map(quote => (
                  <tr key={quote.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-blue-700 text-sm">
                        #{String(quote.quote_number || 0).padStart(4, '0')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{quote.title || '-'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {quote.customer?.name ?? <span className="text-gray-400">Sin cliente</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      <div className="flex items-center gap-1.5">
                        {quote.enterprise?.name ?? <span className="text-gray-400">-</span>}
                        <TagBadges tags={quote.enterprise_tags || []} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatDate(quote.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {quote.valid_until ? formatDate(quote.valid_until) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-green-700 dark:text-green-400">{formatCurrency(parseFloat(quote.total_amount || '0'))}</span>
                    </td>
                    <td className="px-4 py-3">
                      <PermissionGate module="quotes" action="edit">
                        <select
                          className={`px-2 py-1 rounded-lg text-xs font-medium border cursor-pointer ${STATUS_COLORS[quote.status] || 'bg-gray-100 text-gray-800'}`}
                          value={quote.status}
                          onChange={e => handleStatusChange(quote.id, e.target.value)}
                          disabled={updatingStatusId === quote.id}
                        >
                          <option value="draft">Borrador</option>
                          <option value="sent">Enviada</option>
                          <option value="accepted">Aceptada</option>
                          <option value="rejected">Rechazada</option>
                        </select>
                      </PermissionGate>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openPreviewModal(quote.id)}
                        className="px-2 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
          />
        </Card>
      )}

      {/* Quote Preview Modal */}
      {previewQuoteId && (
        <QuotePreviewModal
          quoteId={previewQuoteId}
          customers={customers}
          enterprises={enterprises}
          onClose={closePreviewModal}
          onSaved={handlePreviewSaved}
        />
      )}
    </div>
  )
}
