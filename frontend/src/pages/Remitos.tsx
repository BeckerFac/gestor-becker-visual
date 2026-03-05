import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { formatDate } from '@/lib/utils'
import { api } from '@/services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RemitoItem {
  product_name: string
  description: string
  quantity: number
  unit: string
}

interface Remito {
  id: string
  remito_number: number
  date: string
  delivery_address: string | null
  receiver_name: string | null
  transport: string | null
  notes: string | null
  tipo: 'entrega' | 'recepcion'
  status: 'pendiente' | 'entregado' | 'firmado'
  enterprise?: { id: string; name: string } | null
  customer?: { id: string; name: string; cuit: string } | null
  order?: { id: string; order_number: number; title: string } | null
  item_count: number
  created_at: string
}

interface Enterprise { id: string; name: string; cuit?: string | null }
interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null; address?: string }
interface Order { id: string; order_number: number; title: string; customer_id?: string; enterprise_id?: string; items?: any[] }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'pendiente', label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'entregado', label: 'Entregado', color: 'bg-blue-100 text-blue-800' },
  { value: 'firmado',   label: 'Firmado',   color: 'bg-green-100 text-green-800' },
] as const

const TIPO_OPTIONS = [
  { value: 'entrega',   label: 'Entrega',   color: 'bg-blue-100 text-blue-700' },
  { value: 'recepcion', label: 'Recepcion', color: 'bg-green-100 text-green-700' },
] as const

const UNIT_OPTIONS = ['unidades', 'metros', 'm2', 'kg', 'rollos', 'paquetes', 'cajas'] as const

const PAGE_SIZE = 15

const EMPTY_FORM = {
  enterprise_id: '',
  customer_id: '',
  order_id: '',
  delivery_address: '',
  receiver_name: '',
  transport: '',
  notes: '',
  date: new Date().toISOString().split('T')[0],
  tipo: 'entrega' as 'entrega' | 'recepcion',
}

const EMPTY_ITEM: RemitoItem = { product_name: '', description: '', quantity: 1, unit: 'unidades' }

const CSV_COLUMNS = [
  { key: 'remito_number', label: 'N° Remito' },
  { key: 'date',          label: 'Fecha' },
  { key: 'tipo',          label: 'Tipo' },
  { key: 'enterprise',    label: 'Empresa' },
  { key: 'customer',      label: 'Cliente' },
  { key: 'order',         label: 'Pedido' },
  { key: 'item_count',    label: 'Items' },
  { key: 'status',        label: 'Estado' },
  { key: 'receiver_name', label: 'Receptor' },
  { key: 'transport',     label: 'Transporte' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusBadge(status: string) {
  const found = STATUS_OPTIONS.find(o => o.value === status)
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${found?.color ?? 'bg-gray-100 text-gray-700'}`}>
      {found?.label ?? status}
    </span>
  )
}

function getTipoBadge(tipo: string) {
  const found = TIPO_OPTIONS.find(o => o.value === tipo)
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${found?.color ?? 'bg-gray-100 text-gray-700'}`}>
      {found?.label ?? tipo}
    </span>
  )
}

function fmtRemitoNumber(n: number) {
  return `#${String(n || 0).padStart(6, '0')}`
}

function hasActiveFilters(filters: {
  enterprise_id: string
  status: string
  tipo: string
  search: string
  date_from: string
  date_to: string
}) {
  return !!(filters.enterprise_id || filters.status || filters.tipo || filters.search || filters.date_from || filters.date_to)
}

// ─── Component ────────────────────────────────────────────────────────────────

export const Remitos: React.FC = () => {
  // Data
  const [remitos, setRemitos]       = useState<Remito[]>([])
  const [total, setTotal]           = useState(0)
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [customers, setCustomers]   = useState<Customer[]>([])
  const [orders, setOrders]         = useState<Order[]>([])

  // UI state
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterStatus, setFilterStatus]         = useState('')
  const [filterTipo, setFilterTipo]             = useState('')
  const [filterSearch, setFilterSearch]         = useState('')
  const [filterDateFrom, setFilterDateFrom]     = useState('')
  const [filterDateTo, setFilterDateTo]         = useState('')

  // Form
  const [form, setForm]   = useState(EMPTY_FORM)
  const [items, setItems] = useState<RemitoItem[]>([{ ...EMPTY_ITEM }])

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadRemitos = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const filters: Record<string, any> = { page, page_size: PAGE_SIZE }
      if (filterEnterprise) filters.enterprise_id = filterEnterprise
      if (filterStatus)     filters.status        = filterStatus
      if (filterTipo)       filters.tipo          = filterTipo
      if (filterSearch)     filters.search        = filterSearch
      if (filterDateFrom)   filters.date_from     = filterDateFrom
      if (filterDateTo)     filters.date_to       = filterDateTo

      const res = await api.getRemitos(filters).catch(() => ({ items: [], total: 0 }))
      setRemitos(res.items ?? [])
      setTotal(res.total ?? 0)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise, filterStatus, filterTipo, filterSearch, filterDateFrom, filterDateTo])

  const loadStaticData = useCallback(async () => {
    const [entRes, custRes, ordRes] = await Promise.all([
      api.getEnterprises().catch(() => ({ items: [] })),
      api.getCustomers().catch(() => ({ items: [] })),
      api.getOrders({ status: undefined }).catch(() => ({ items: [] })),
    ])
    setEnterprises(entRes.items ?? entRes ?? [])
    setCustomers(custRes.items ?? custRes ?? [])
    setOrders(ordRes.items ?? ordRes ?? [])
  }, [])

  useEffect(() => {
    loadStaticData()
  }, [loadStaticData])

  useEffect(() => {
    setCurrentPage(1)
    loadRemitos(1)
  }, [filterEnterprise, filterStatus, filterTipo, filterSearch, filterDateFrom, filterDateTo])

  // ── Filter helpers ─────────────────────────────────────────────────────────

  const activeFilters = hasActiveFilters({
    enterprise_id: filterEnterprise,
    status: filterStatus,
    tipo: filterTipo,
    search: filterSearch,
    date_from: filterDateFrom,
    date_to: filterDateTo,
  })

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterStatus('')
    setFilterTipo('')
    setFilterSearch('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  // ── Orders filtered by enterprise ─────────────────────────────────────────

  const filteredOrders = form.enterprise_id
    ? orders.filter(o => (o as any).enterprise_id === form.enterprise_id)
    : orders

  // ── Order selection: auto-fill items and customer ──────────────────────────

  const handleOrderSelect = async (orderId: string) => {
    setForm(prev => ({ ...prev, order_id: orderId }))
    if (!orderId) return
    try {
      const detail = await (api as any).getOrder(orderId).catch(() => null)
      if (detail?.items?.length) {
        setItems(
          detail.items.map((it: any) => ({
            product_name: it.product_name ?? '',
            description:  it.description  ?? '',
            quantity:     Number(it.quantity) || 1,
            unit:         'unidades',
          }))
        )
      }
      if (detail?.customer_id) {
        setForm(prev => ({ ...prev, customer_id: detail.customer_id }))
      }
    } catch {
      // ignore
    }
  }

  // ── Item helpers ───────────────────────────────────────────────────────────

  const handleAddItem = () => {
    setItems(prev => [...prev, { ...EMPTY_ITEM }])
  }

  const handleRemoveItem = (idx: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleItemChange = (idx: number, field: keyof RemitoItem, value: string | number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  // ── Create remito ──────────────────────────────────────────────────────────

  const handleCreateRemito = async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = items.filter(it => it.product_name.trim())
    if (validItems.length === 0) {
      setError('Agrega al menos un item con nombre de producto.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.createRemito({
        customer_id:      form.customer_id      || null,
        enterprise_id:    form.enterprise_id    || null,
        order_id:         form.order_id         || null,
        delivery_address: form.delivery_address || null,
        receiver_name:    form.receiver_name    || null,
        transport:        form.transport        || null,
        notes:            form.notes            || null,
        date:             form.date             || null,
        tipo:             form.tipo,
        items:            validItems,
      })
      setShowForm(false)
      setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] })
      setItems([{ ...EMPTY_ITEM }])
      await loadRemitos(currentPage)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Status change ──────────────────────────────────────────────────────────

  const handleStatusChange = async (remitoId: string, newStatus: string) => {
    try {
      await api.updateRemitoStatus(remitoId, newStatus)
      await loadRemitos(currentPage)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDeleteRemito = async (remitoId: string) => {
    if (!confirm('¿Eliminar este remito? Esta accion no se puede deshacer.')) return
    try {
      await api.deleteRemito(remitoId)
      await loadRemitos(currentPage)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── PDF download ───────────────────────────────────────────────────────────

  const handleDownloadPdf = async (remitoId: string, remitoNumber: number) => {
    try {
      const blob = await api.getRemitoPdf(remitoId)
      const url  = window.URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `Remito_${String(remitoNumber).padStart(6, '0')}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── CSV data ───────────────────────────────────────────────────────────────

  const csvData = remitos.map(r => ({
    remito_number: fmtRemitoNumber(r.remito_number),
    date:          formatDate(r.date),
    tipo:          r.tipo === 'recepcion' ? 'Recepcion' : 'Entrega',
    enterprise:    r.enterprise?.name ?? '-',
    customer:      r.customer?.name   ?? '-',
    order:         r.order ? `#${String(r.order.order_number).padStart(4, '0')}` : '-',
    item_count:    r.item_count,
    status:        STATUS_OPTIONS.find(s => s.value === r.status)?.label ?? r.status,
    receiver_name: r.receiver_name ?? '-',
    transport:     r.transport     ?? '-',
  }))

  // ── Pagination helpers ─────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    loadRemitos(page)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Remitos</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} remito{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={CSV_COLUMNS} filename="remitos" />
          <Button variant="primary" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancelar' : '+ Nuevo Remito'}
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 font-bold text-red-500 hover:text-red-700">×</button>
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
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">Todos los estados</option>
                {STATUS_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Tipo filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Tipo</label>
              <select
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={filterTipo}
                onChange={e => setFilterTipo(e.target.value)}
              >
                <option value="">Todos los tipos</option>
                {TIPO_OPTIONS.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Buscar</label>
              <input
                type="text"
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Receptor, transporte..."
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
                  className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
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
        <Card className="animate-fadeIn">
          <CardHeader>
            <h3 className="text-lg font-semibold text-gray-900">Nuevo Remito</h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateRemito} className="space-y-5">
              {/* Tipo selector */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, tipo: 'entrega' }))}
                  className={`flex-1 px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                    form.tipo === 'entrega'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-sm">Entrega al cliente</div>
                  <div className="text-xs text-gray-500 mt-0.5">PDF con campos de firma y aclaracion para el receptor</div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, tipo: 'recepcion' }))}
                  className={`flex-1 px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                    form.tipo === 'recepcion'
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-sm">Recepcion propia</div>
                  <div className="text-xs text-gray-500 mt-0.5">PDF con sello de "Productos Recibidos" sin firma</div>
                </button>
              </div>

              {/* Enterprise + Customer */}
              <EnterpriseCustomerSelector
                enterprises={enterprises}
                customers={customers}
                selectedEnterpriseId={form.enterprise_id}
                selectedCustomerId={form.customer_id}
                onEnterpriseChange={id => setForm(prev => ({ ...prev, enterprise_id: id, order_id: '' }))}
                onCustomerChange={id => setForm(prev => ({ ...prev, customer_id: id }))}
                enterpriseLabel="Empresa"
                customerLabel={form.tipo === 'recepcion' ? 'Proveedor / Remitente' : 'Cliente / Destinatario'}
              />

              {/* Order + Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Pedido asociado (opcional)</label>
                  <select
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={form.order_id}
                    onChange={e => handleOrderSelect(e.target.value)}
                  >
                    <option value="">Ninguno</option>
                    {filteredOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        #{String(o.order_number).padStart(4, '0')} — {o.title}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Fecha"
                  type="date"
                  value={form.date}
                  onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>

              {/* Delivery details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Input
                  label="Direccion de entrega"
                  placeholder="Av. Corrientes 1234, CABA"
                  value={form.delivery_address}
                  onChange={e => setForm(prev => ({ ...prev, delivery_address: e.target.value }))}
                />
                <Input
                  label="Nombre del receptor"
                  placeholder="Juan Perez"
                  value={form.receiver_name}
                  onChange={e => setForm(prev => ({ ...prev, receiver_name: e.target.value }))}
                />
                <Input
                  label="Transporte"
                  placeholder="Ej: Andreani, OCA, propio"
                  value={form.transport}
                  onChange={e => setForm(prev => ({ ...prev, transport: e.target.value }))}
                />
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Items a {form.tipo === 'recepcion' ? 'recepcionar' : 'entregar'}
                  </label>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Agregar item
                  </button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-gray-50 p-3 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <input
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                          placeholder="Nombre del producto *"
                          value={item.product_name}
                          onChange={e => handleItemChange(idx, 'product_name', e.target.value)}
                          required
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <input
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                          placeholder="Descripcion (opcional)"
                          value={item.description}
                          onChange={e => handleItemChange(idx, 'description', e.target.value)}
                        />
                      </div>
                      <div className="w-20 shrink-0">
                        <input
                          type="number"
                          min="1"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:ring-1 focus:ring-blue-500"
                          placeholder="Cant."
                          value={item.quantity}
                          onChange={e => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="w-28 shrink-0">
                        <select
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500"
                          value={item.unit}
                          onChange={e => handleItemChange(idx, 'unit', e.target.value)}
                        >
                          {UNIT_OPTIONS.map(u => (
                            <option key={u} value={u}>
                              {u.charAt(0).toUpperCase() + u.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        disabled={items.length <= 1}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Quitar item"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <Input
                label="Observaciones"
                placeholder="Notas adicionales..."
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              />

              {/* Submit */}
              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" loading={saving}>
                  Crear Remito
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] })
                    setItems([{ ...EMPTY_ITEM }])
                    setError(null)
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card>
          <CardContent>
            <p className="text-center py-10 text-gray-500 text-sm">Cargando remitos...</p>
          </CardContent>
        </Card>
      ) : remitos.length === 0 ? (
        <EmptyState
          icon="📄"
          title={activeFilters ? 'No se encontraron remitos' : 'Sin remitos registrados'}
          description={
            activeFilters
              ? undefined
              : 'Crea el primer remito usando el boton "Nuevo Remito".'
          }
          variant={activeFilters ? 'filtered' : 'empty'}
          actionLabel={activeFilters ? 'Limpiar filtros' : '+ Nuevo Remito'}
          onAction={activeFilters ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">N°</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Empresa</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Pedido</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Items</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {remitos.map(remito => (
                  <tr key={remito.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-blue-700 text-sm">
                        {fmtRemitoNumber(remito.remito_number)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {formatDate(remito.date)}
                    </td>
                    <td className="px-4 py-3">
                      {getTipoBadge(remito.tipo)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {remito.enterprise?.name ?? <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {remito.customer?.name ?? <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {remito.order ? (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                          #{String(remito.order.order_number).padStart(4, '0')}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {remito.item_count} item{remito.item_count !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {getStatusBadge(remito.status)}
                        <select
                          className="text-xs border border-gray-300 rounded px-1 py-0.5 focus:ring-1 focus:ring-blue-500"
                          value={remito.status}
                          onChange={e => handleStatusChange(remito.id, e.target.value)}
                          title="Cambiar estado"
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownloadPdf(remito.id, remito.remito_number)}
                          className="px-2 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors"
                          title="Descargar PDF"
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => handleDeleteRemito(remito.id)}
                          className="w-7 h-7 flex items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-700 transition-colors text-base font-bold"
                          title="Eliminar remito"
                        >
                          ×
                        </button>
                      </div>
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
    </div>
  )
}
