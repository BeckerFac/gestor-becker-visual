import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'

interface PurchaseInvoice {
  id: string
  enterprise_name: string
  enterprise_cuit: string | null
  enterprise_id: string
  purchase_id: string | null
  purchase_number: number | null
  business_unit_name: string | null
  invoice_type: string
  punto_venta: string | null
  invoice_number: string
  invoice_date: string
  cae: string | null
  subtotal: string
  vat_amount: string
  other_taxes: string | null
  total_amount: string
  payment_status: string
  status: string
  remaining_balance: string | null
  notes: string | null
  created_at: string
}

interface Enterprise { id: string; name: string }
interface Purchase { id: string; purchase_number: number; total_amount: string; enterprise_name: string | null; enterprise_id?: string }

const PAYMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  parcial: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  pagado: { label: 'Pagado', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
}

export const PurchaseInvoices: React.FC = () => {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [deleteTarget, setDeleteTarget] = useState<PurchaseInvoice | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedPagos, setExpandedPagos] = useState<any[]>([])

  const [form, setForm] = useState({
    enterprise_id: '', purchase_id: '',
    invoice_type: 'A', punto_venta: '', invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    cae: '', subtotal: '', vat_amount: '', other_taxes: '', total_amount: '',
    notes: '',
  })

  // Retenciones previstas (estimated withholdings)
  const [retPrevistas, setRetPrevistas] = useState([
    { type: 'iibb', label: 'IIBB', enabled: false, rate: 3.0 },
    { type: 'ganancias', label: 'Ganancias', enabled: false, rate: 2.0 },
    { type: 'iva', label: 'IVA', enabled: false, rate: 0 },
    { type: 'suss', label: 'SUSS', enabled: false, rate: 0 },
  ])

  const retPrevistasEstimated = retPrevistas
    .filter(r => r.enabled && r.rate > 0)
    .map(r => ({
      type: r.type,
      rate: r.rate,
      estimated_amount: Math.round(parseFloat(form.total_amount || '0') * r.rate) / 100,
    }))

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [piRes, entRes, purchRes] = await Promise.all([
        api.getPurchaseInvoices({
          enterprise_id: filterEnterprise || undefined,
          payment_status: filterPaymentStatus || undefined,
        }).catch((err: any) => {
          setError(`Error cargando facturas: ${err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getEnterprises().catch(() => []),
        api.getPurchases().catch(() => []),
      ])
      setInvoices(piRes || [])
      setEnterprises(entRes || [])
      setPurchases(purchRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise, filterPaymentStatus])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterPaymentStatus, filterType, dateFrom, dateTo, pageSize])

  const loadPagosForInvoice = useCallback(async (piId: string) => {
    try {
      const data = await api.getPurchaseInvoicePagos(piId)
      setExpandedPagos(data || [])
    } catch { setExpandedPagos([]) }
  }, [])

  const handleToggleExpand = useCallback((piId: string) => {
    if (expandedId === piId) {
      setExpandedId(null)
      setExpandedPagos([])
    } else {
      setExpandedId(piId)
      loadPagosForInvoice(piId)
    }
  }, [expandedId, loadPagosForInvoice])

  const filteredPurchasesForForm = form.enterprise_id
    ? purchases.filter(p => (p as any).enterprise_id === form.enterprise_id)
    : purchases

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.invoice_number) { setError('Numero de factura requerido'); return }
    if (!form.total_amount || parseFloat(form.total_amount) <= 0) { setError('Monto total requerido'); return }
    if (!form.enterprise_id) { setError('Proveedor requerido'); return }

    setSaving(true)
    setError(null)
    try {
      const buId = localStorage.getItem('gestia_active_business_unit_id') || undefined
      await api.createPurchaseInvoice({
        business_unit_id: buId,
        enterprise_id: form.enterprise_id,
        purchase_id: form.purchase_id || undefined,
        invoice_type: form.invoice_type,
        punto_venta: form.punto_venta || undefined,
        invoice_number: form.invoice_number,
        invoice_date: form.invoice_date,
        cae: form.cae || undefined,
        subtotal: parseFloat(form.subtotal) || 0,
        vat_amount: parseFloat(form.vat_amount) || 0,
        other_taxes: parseFloat(form.other_taxes) || 0,
        total_amount: parseFloat(form.total_amount),
        notes: form.notes || undefined,
        retenciones_previstas: retPrevistasEstimated.length > 0 ? retPrevistasEstimated : undefined,
      } as any)
      toast.success('Factura de compra registrada')
      setShowForm(false)
      setForm({ enterprise_id: '', purchase_id: '', invoice_type: 'A', punto_venta: '', invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], cae: '', subtotal: '', vat_amount: '', other_taxes: '', total_amount: '', notes: '' })
      setRetPrevistas(prev => prev.map(r => ({ ...r, enabled: false, rate: r.type === 'iibb' ? 3.0 : r.type === 'ganancias' ? 2.0 : 0 })))
      await loadData()
    } catch (e: any) {
      toast.error(e.message || 'Error al crear factura de compra')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deletePurchaseInvoice(deleteTarget.id)
      toast.success('Factura de compra eliminada')
      setDeleteTarget(null)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const filteredInvoices = useMemo(() => {
    let result = invoices
    if (filterType) result = result.filter(i => i.invoice_type === filterType)
    if (dateFrom) result = result.filter(i => {
      const d = i.invoice_date ? new Date(i.invoice_date).toISOString().split('T')[0] : ''
      return d >= dateFrom
    })
    if (dateTo) result = result.filter(i => {
      const d = i.invoice_date ? new Date(i.invoice_date).toISOString().split('T')[0] : ''
      return d <= dateTo
    })
    return result
  }, [invoices, filterType, dateFrom, dateTo])

  const totalAmount = filteredInvoices.reduce((sum, i) => sum + parseFloat(i.total_amount || '0'), 0)
  const pendingCount = filteredInvoices.filter(i => i.payment_status === 'pendiente').length
  const paidCount = filteredInvoices.filter(i => i.payment_status === 'pagado').length
  const totalPages = Math.ceil(filteredInvoices.length / pageSize)
  const paginated = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = !!filterEnterprise || !!filterPaymentStatus || !!filterType || !!dateFrom || !!dateTo
  const clearFilters = () => { setFilterEnterprise(''); setFilterPaymentStatus(''); setFilterType(''); setDateFrom(''); setDateTo('') }

  const csvColumns = [
    { key: 'invoice_date', label: 'Fecha', type: 'date' as const },
    { key: 'invoice_type', label: 'Tipo' },
    { key: 'invoice_number', label: 'Numero' },
    { key: 'enterprise_name', label: 'Proveedor' },
    { key: 'total_amount', label: 'Total', type: 'currency' as const },
    { key: 'payment_status', label: 'Estado Pago' },
    { key: 'cae', label: 'CAE' },
    { key: 'notes', label: 'Notas' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Facturas de Compra</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Comprobantes recibidos de proveedores</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={filteredInvoices} columns={csvColumns} filename="facturas_compra" />
          <ExportExcelButton data={filteredInvoices} columns={csvColumns} filename="facturas_compra" />
          <PermissionGate module="purchases" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancelar' : '+ Cargar Factura'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700 dark:text-purple-400">Total Facturado</p>
            <p className="text-xl font-bold text-purple-800 dark:text-purple-300">{formatCurrency(totalAmount)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700 dark:text-blue-400">Comprobantes</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{filteredInvoices.length}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700 dark:text-red-400">Pendientes de Pago</p>
            <p className="text-xl font-bold text-red-800 dark:text-red-300">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700 dark:text-green-400">Pagadas</p>
            <p className="text-xl font-bold text-green-800 dark:text-green-300">{paidCount}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">Cargar Factura de Compra</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Proveedor *</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value, purchase_id: '' })} required>
                  <option value="">Seleccionar proveedor...</option>
                  {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Compra asociada</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.purchase_id} onChange={e => setForm({ ...form, purchase_id: e.target.value })}>
                  <option value="">Sin compra (gasto independiente)</option>
                  {filteredPurchasesForForm.map(p => <option key={p.id} value={p.id}>#{String(p.purchase_number).padStart(4, '0')} ({formatCurrency(p.total_amount)})</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo *</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                  <option value="A">Factura A</option>
                  <option value="B">Factura B</option>
                  <option value="C">Factura C</option>
                </select>
              </div>
              <Input label="Punto de Venta" placeholder="0001" value={form.punto_venta} onChange={e => setForm({ ...form, punto_venta: e.target.value })} />
              <Input label="Numero de Factura *" placeholder="00012345" value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} required />
              <DateInput label="Fecha *" value={form.invoice_date} onChange={val => setForm({ ...form, invoice_date: val })} required />
              <Input label="CAE" placeholder="14 digitos" value={form.cae} onChange={e => setForm({ ...form, cae: e.target.value })} />
              <Input label="Subtotal (Neto)" type="number" step="0.01" min="0" placeholder="0.00" value={form.subtotal} onChange={e => setForm({ ...form, subtotal: e.target.value })} />
              <Input label="IVA" type="number" step="0.01" min="0" placeholder="0.00" value={form.vat_amount} onChange={e => setForm({ ...form, vat_amount: e.target.value })} />
              <Input label="Otros impuestos" type="number" step="0.01" min="0" placeholder="0.00" value={form.other_taxes} onChange={e => setForm({ ...form, other_taxes: e.target.value })} />
              <Input label="Total *" type="number" step="0.01" min="0.01" placeholder="0.00" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })} required />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              {/* Retenciones previstas */}
              <div className="col-span-full border border-amber-200 dark:border-amber-800 rounded-lg p-4 bg-amber-50/50 dark:bg-amber-950/20">
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">Retenciones previstas (estimado)</h4>
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">Selecciona las retenciones que se aplicaran al momento de pagar. Son informativas.</p>
                <div className="space-y-2">
                  {retPrevistas.map((ret, idx) => {
                    const estimated = ret.enabled && ret.rate > 0
                      ? Math.round(parseFloat(form.total_amount || '0') * ret.rate) / 100
                      : 0
                    return (
                      <div key={ret.type} className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={ret.enabled}
                          onChange={() => setRetPrevistas(prev => prev.map((r, i) => i !== idx ? r : { ...r, enabled: !r.enabled }))}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-medium w-24">{ret.label}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={ret.rate}
                            onChange={e => setRetPrevistas(prev => prev.map((r, i) => i !== idx ? r : { ...r, rate: parseFloat(e.target.value) || 0 }))}
                            disabled={!ret.enabled}
                            className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm text-right bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                        {ret.enabled && estimated > 0 && (
                          <span className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                            ~ {formatCurrency(estimated)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                {retPrevistasEstimated.length > 0 && parseFloat(form.total_amount || '0') > 0 && (
                  <div className="mt-3 pt-2 border-t border-amber-200 dark:border-amber-700 flex justify-between text-sm">
                    <span className="text-amber-700 dark:text-amber-400">Total retenciones estimadas:</span>
                    <span className="font-semibold text-amber-800 dark:text-amber-300">
                      {formatCurrency(retPrevistasEstimated.reduce((sum, r) => sum + r.estimated_amount, 0))}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">Registrar Factura</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Proveedor</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todos</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Tipo</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterType} onChange={e => setFilterType(e.target.value)}>
                <option value="">Todos</option>
                <option value="A">Factura A</option>
                <option value="B">Factura B</option>
                <option value="C">Factura C</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Estado de Pago</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterPaymentStatus} onChange={e => setFilterPaymentStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="parcial">Parcial</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
            <div className="col-span-2">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onClear={() => { setDateFrom(''); setDateTo('') }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay facturas con estos filtros' : 'No hay facturas de compra'}
          description={isFiltered ? undefined : 'Carga la primera factura de proveedor para empezar'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Cargar Factura'}
          onAction={isFiltered ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Numero</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Compra</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Restante</th>
                  <th className="px-4 py-3">Estado Pago</th>
                  <th className="px-4 py-3">CAE</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(pi => {
                  const remaining = parseFloat(pi.remaining_balance || '0')
                  const statusInfo = PAYMENT_STATUS_LABELS[pi.payment_status] || PAYMENT_STATUS_LABELS.pendiente
                  const isExpanded = expandedId === pi.id
                  return (
                    <React.Fragment key={pi.id}>
                      <tr
                        className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                        onClick={() => handleToggleExpand(pi.id)}
                      >
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 font-bold text-sm">
                            {pi.invoice_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {pi.punto_venta ? `${pi.punto_venta}-` : ''}{pi.invoice_number}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{formatDate(pi.invoice_date)}</td>
                        <td className="px-4 py-3 text-sm font-medium">{pi.enterprise_name}</td>
                        <td className="px-4 py-3 text-sm">
                          {pi.purchase_number ? (
                            <span className="font-mono text-orange-700">#{String(pi.purchase_number).padStart(4, '0')}</span>
                          ) : (
                            <span className="text-gray-400 italic text-xs">Gasto directo</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(pi.total_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          {remaining > 0 ? (
                            <span className="text-red-600 font-medium">{formatCurrency(remaining)}</span>
                          ) : (
                            <span className="text-green-600 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium rounded-full px-2 py-1 ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{pi.cae || '-'}</td>
                        <td className="px-4 py-3">
                          <PermissionGate module="purchases" action="delete">
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(pi) }}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Eliminar"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </PermissionGate>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-purple-50/50 dark:bg-purple-950/20">
                          <td colSpan={10} className="px-6 py-4">
                            <div className="space-y-3">
                              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Pagos vinculados</h4>
                              {expandedPagos.length > 0 ? (
                                <div className="space-y-1">
                                  {expandedPagos.map((pago: any) => (
                                    <div key={pago.id} className="flex items-center justify-between text-sm bg-white dark:bg-gray-800 rounded px-3 py-2 border border-gray-200 dark:border-gray-700">
                                      <span className="text-gray-500">{formatDate(pago.payment_date || pago.applied_at)}</span>
                                      <span>{pago.payment_method}</span>
                                      {pago.bank_name && <span className="text-gray-400">({pago.bank_name})</span>}
                                      <span className="font-medium text-green-600">+{formatCurrency(pago.amount_applied)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-400 italic">Sin pagos vinculados. Registra un pago en la seccion de Pagos.</p>
                              )}
                              {pi.notes && (
                                <div>
                                  <p className="text-xs text-gray-500">Notas</p>
                                  <p className="text-sm text-gray-700 dark:text-gray-300">{pi.notes}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
        open={!!deleteTarget}
        title="Eliminar Factura de Compra"
        message={`Eliminar factura ${deleteTarget?.invoice_type} ${deleteTarget?.invoice_number}?`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
