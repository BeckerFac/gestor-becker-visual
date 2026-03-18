import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PermissionGate } from '@/components/shared/PermissionGate'

interface Pago {
  id: string
  enterprise_name: string | null
  enterprise_id: string | null
  purchase_id: string | null
  purchase_number: number | null
  amount: string
  payment_method: string
  bank_name: string | null
  reference: string | null
  payment_date: string
  enterprise_tags?: { id: string; name: string; color: string }[]
  notes: string | null
}

interface Enterprise { id: string; name: string }
interface Purchase {
  id: string
  purchase_number: number
  total_amount: string
  enterprise_name: string | null
  enterprise_id?: string
  payment_status?: string
  date?: string
}
interface Bank { id: string; bank_name: string }

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
}

const DISMISSED_PENDING_KEY = 'gestia_dismissed_pending_pagos'

function getDismissedPending(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_PENDING_KEY) || '[]')
  } catch {
    return []
  }
}

function dismissPending(purchaseId: string) {
  const dismissed = getDismissedPending()
  if (!dismissed.includes(purchaseId)) {
    localStorage.setItem(DISMISSED_PENDING_KEY, JSON.stringify([...dismissed, purchaseId]))
  }
}

function restorePending() {
  localStorage.removeItem(DISMISSED_PENDING_KEY)
}

export const Pagos: React.FC = () => {
  const [pagos, setPagos] = useState<Pago[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [deleteTarget, setDeleteTarget] = useState<Pago | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dismissedPending, setDismissedPending] = useState<string[]>(getDismissedPending())
  const [pendingCollapsed, setPendingCollapsed] = useState(false)

  const [form, setForm] = useState({
    enterprise_id: '', purchase_id: '',
    amount: '', payment_method: 'transferencia', bank_id: '',
    reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '',
  })

  const loadData = async () => {
    try {
      setLoading(true)
      const [pagosRes, entRes, purchRes, bankRes] = await Promise.all([
        api.getPagos(filterEnterprise ? { enterprise_id: filterEnterprise } : undefined).catch((err: any) => {
          setError(`Error cargando pagos: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getEnterprises().catch(() => []),
        api.getPurchases().catch(() => []),
        api.getBanks().catch(() => []),
      ])
      setPagos(pagosRes || [])
      setEnterprises(entRes || [])
      setPurchases(purchRes || [])
      setBanks(bankRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterEnterprise])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterMethod, dateFrom, dateTo, pageSize])

  // Calculate paid amounts per purchase from pagos data
  const paidByPurchase = useMemo(() => {
    const map = new Map<string, number>()
    for (const pago of pagos) {
      if (pago.purchase_id) {
        const current = map.get(pago.purchase_id) || 0
        map.set(pago.purchase_id, current + Number(pago.amount || 0))
      }
    }
    return map
  }, [pagos])

  // Pending purchases (pendiente or parcial, not dismissed)
  const pendingPurchases = useMemo(() => {
    const allPurchases = Array.isArray(purchases) ? purchases : []
    return allPurchases
      .filter(p => p.payment_status === 'pendiente' || p.payment_status === 'parcial')
      .filter(p => !dismissedPending.includes(p.id))
      .map(p => {
        const total = parseFloat(p.total_amount || '0')
        const paid = paidByPurchase.get(p.id) || 0
        const remaining = Math.max(0, total - paid)
        return { ...p, paid, remaining }
      })
  }, [purchases, paidByPurchase, dismissedPending])

  const totalPendingAmount = pendingPurchases.reduce((sum, p) => sum + p.remaining, 0)
  const hasDismissedPending = dismissedPending.length > 0

  const handleDismissPending = (purchaseId: string) => {
    dismissPending(purchaseId)
    setDismissedPending([...dismissedPending, purchaseId])
  }

  const handleRestorePending = () => {
    restorePending()
    setDismissedPending([])
  }

  const handlePayFromPurchase = useCallback((purchase: typeof pendingPurchases[0]) => {
    setForm({
      enterprise_id: purchase.enterprise_id || '',
      purchase_id: purchase.id,
      amount: purchase.remaining.toFixed(2),
      payment_method: 'transferencia',
      bank_id: '',
      reference: '',
      payment_date: new Date().toISOString().split('T')[0],
      notes: `Pago compra #${String(purchase.purchase_number).padStart(4, '0')}`,
    })
    setShowForm(true)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('El monto debe ser mayor a 0')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.createPago({
        enterprise_id: form.enterprise_id || null,
        purchase_id: form.purchase_id || null,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        bank_id: form.bank_id || null,
        reference: form.reference || null,
        payment_date: form.payment_date,
        notes: form.notes || null,
      })
      setShowForm(false)
      setForm({ enterprise_id: '', purchase_id: '', amount: '', payment_method: 'transferencia', bank_id: '', reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '' })
      toast.success('Pago registrado correctamente')
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deletePago(deleteTarget.id)
      toast.success('Pago eliminado')
      setDeleteTarget(null)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const fmt = (n: any) => formatCurrency(n)
  const fmtDate = (d: string) => formatDate(d)
  const showBankSelector = form.payment_method === 'transferencia' || form.payment_method === 'cheque'

  const filteredPagos = useMemo(() => {
    let result = pagos
    if (filterMethod) result = result.filter(p => p.payment_method === filterMethod)
    if (dateFrom) result = result.filter(p => {
      const d = p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : ''
      return d >= dateFrom
    })
    if (dateTo) result = result.filter(p => {
      const d = p.payment_date ? new Date(p.payment_date).toISOString().split('T')[0] : ''
      return d <= dateTo
    })
    return result
  }, [pagos, filterMethod, dateFrom, dateTo])

  const totalPagado = filteredPagos.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const totalPages = Math.ceil(filteredPagos.length / pageSize)
  const paginatedPagos = filteredPagos.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = !!filterEnterprise || !!filterMethod || !!dateFrom || !!dateTo

  const filteredPurchases = form.enterprise_id
    ? purchases.filter(p => (p as any).enterprise_id === form.enterprise_id)
    : purchases

  const csvColumns = [
    { key: 'payment_date', label: 'Fecha' },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'purchase_number', label: 'Compra N°' },
    { key: 'amount', label: 'Monto' },
    { key: 'payment_method', label: 'Método' },
    { key: 'bank_name', label: 'Banco' },
    { key: 'reference', label: 'Referencia' },
    { key: 'notes', label: 'Notas' },
  ]

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterMethod('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pagos</h1>
          <p className="text-sm text-gray-500 mt-1">Pagos realizados a empresas</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={filteredPagos} columns={csvColumns} filename="pagos" />
          <ExportExcelButton data={filteredPagos} columns={csvColumns} filename="pagos" />
          <PermissionGate module="pagos" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancelar' : '+ Registrar Pago'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-red-200 bg-red-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700">Total Pagado</p>
            <p className="text-xl font-bold text-red-800">{fmt(totalPagado)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700">Registros</p>
            <p className="text-xl font-bold text-blue-800">{filteredPagos.length}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 bg-purple-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700">Empresas</p>
            <p className="text-xl font-bold text-purple-800">{new Set(filteredPagos.map(p => p.enterprise_id).filter(Boolean)).size}</p>
          </CardContent>
        </Card>
        <Card className="border border-yellow-200 bg-yellow-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-yellow-700">Deuda Pendiente</p>
            <p className="text-xl font-bold text-yellow-800">{fmt(totalPendingAmount)}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg animate-fadeIn">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Pendientes de Pago Section */}
      {!loading && pendingPurchases.length > 0 && (
        <Card className="border border-yellow-300 bg-yellow-50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-yellow-900">
                  Pendientes de Pago
                </h3>
                <span className="text-xs font-medium bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
                  {pendingPurchases.length}
                </span>
              </div>
              <button
                onClick={() => setPendingCollapsed(!pendingCollapsed)}
                className="text-yellow-700 hover:text-yellow-900 text-sm font-medium transition-colors flex items-center gap-1"
              >
                {pendingCollapsed ? 'Expandir' : 'Colapsar'}
                <span className="text-xs">{pendingCollapsed ? '▼' : '▲'}</span>
              </button>
            </div>
          </CardHeader>
          {!pendingCollapsed && (
            <CardContent className="pt-0">
              <div className="space-y-2">
                {pendingPurchases.map(purchase => (
                  <div
                    key={purchase.id}
                    className="bg-white border border-yellow-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="font-mono font-bold text-orange-700 text-sm whitespace-nowrap">
                        #{String(purchase.purchase_number).padStart(4, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {purchase.enterprise_name || 'Sin empresa'}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                          <span>Total: {fmt(purchase.total_amount)}</span>
                          {purchase.paid > 0 && (
                            <span className="text-green-600">Pagado: {fmt(purchase.paid)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="text-sm font-bold text-red-700">{fmt(purchase.remaining)}</p>
                        <p className="text-xs text-gray-400">restante</p>
                      </div>
                      <span className={`text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${
                        purchase.payment_status === 'parcial'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {purchase.payment_status === 'parcial' ? 'Parcial' : 'Pendiente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PermissionGate module="pagos" action="create">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handlePayFromPurchase(purchase)}
                        >
                          Pagar
                        </Button>
                      </PermissionGate>
                      <button
                        onClick={() => handleDismissPending(purchase.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        title="Ocultar temporalmente"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {hasDismissedPending && (
                <button
                  onClick={handleRestorePending}
                  className="text-xs text-gray-400 hover:text-yellow-600 transition-colors mt-3"
                >
                  Mostrar ocultos ({dismissedPending.length})
                </button>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Restore dismissed when all are hidden */}
      {!loading && pendingPurchases.length === 0 && hasDismissedPending && (
        <button
          onClick={handleRestorePending}
          className="text-xs text-gray-400 hover:text-yellow-600 transition-colors"
        >
          Mostrar compras pendientes ocultas ({dismissedPending.length})
        </button>
      )}

      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">Registrar Pago</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Empresa</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value, purchase_id: '' })}>
                  <option value="">Seleccionar...</option>
                  {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Compra asociada</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.purchase_id} onChange={e => setForm({ ...form, purchase_id: e.target.value })}>
                  <option value="">Sin compra</option>
                  {filteredPurchases.map(p => <option key={p.id} value={p.id}>#{String(p.purchase_number).padStart(4, '0')} ({fmt(p.total_amount)})</option>)}
                </select>
              </div>
              <Input label="Monto *" type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Metodo de Pago *</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                  <option value="efectivo">Efectivo</option>
                  <option value="mercado_pago">Mercado Pago</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
              {showBankSelector && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Banco *</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })}>
                    <option value="">Seleccionar banco...</option>
                    {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name}</option>)}
                  </select>
                </div>
              )}
              <Input label="Referencia" placeholder="N° transferencia, cheque, etc." value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
              <Input label="Fecha" type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">Registrar Pago</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Empresa</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todas las empresas</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Metodo de Pago</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
                <option value="">Todos</option>
                <option value="efectivo">Efectivo</option>
                <option value="mercado_pago">Mercado Pago</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-2">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onClear={() => { setDateFrom(''); setDateTo('') }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : filteredPagos.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay pagos con estos filtros' : 'No hay pagos registrados'}
          description={isFiltered ? undefined : 'Registra el primer pago para empezar a llevar el control'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Registrar Pago'}
          onAction={isFiltered ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Compra</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Metodo</th>
                  <th className="px-4 py-3">Banco</th>
                  <th className="px-4 py-3">Referencia</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedPagos.map(pago => (
                  <tr key={pago.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(pago.payment_date)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-gray-900">{pago.enterprise_name || <span className="text-gray-400">-</span>}</p>
                        <TagBadges tags={pago.enterprise_tags || []} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {pago.purchase_number ? (
                        <span className="font-mono text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">#{String(pago.purchase_number).padStart(4, '0')}</span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right"><span className="font-bold text-red-600">{fmt(pago.amount)}</span></td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[pago.payment_method] || pago.payment_method}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{pago.bank_name || '-'}</td>
                    <td className="px-4 py-3">{pago.reference ? <span className="font-mono text-xs">{pago.reference}</span> : '-'}</td>
                    <td className="px-4 py-3">
                      <PermissionGate module="pagos" action="delete">
                        <button onClick={() => setDeleteTarget(pago)} className="text-red-500 hover:text-red-700 text-sm transition-colors">Eliminar</button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredPagos.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar pago"
        message="¿Eliminar este pago? Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
