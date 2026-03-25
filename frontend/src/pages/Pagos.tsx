import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { BankSelector } from '@/components/ui/BankSelector'
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
import { PagoInvoiceLinker } from '@/components/pagos/PagoInvoiceLinker'
import { CurrencySelector } from '@/components/shared/CurrencySelector'

interface Pago {
  id: string
  enterprise_name: string | null
  enterprise_id: string | null
  purchase_id: string | null
  purchase_number: number | null
  amount: string
  total_amount?: string
  payment_method: string
  bank_name: string | null
  reference: string | null
  payment_date: string
  enterprise_tags?: { id: string; name: string; color: string }[]
  retenciones?: Array<{ id: string; type: string; rate: string; amount: string; regime: string | null }>
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
interface ChequeDisponible {
  id: string
  number: string
  bank: string
  drawer: string
  amount: string
  due_date: string
  customer_name: string | null
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
}

const RETENCION_LABELS: Record<string, string> = {
  iibb: 'IIBB',
  ganancias: 'Ganancias',
  iva: 'IVA',
  suss: 'SUSS',
}

interface RetencionRow {
  type: string
  enabled: boolean
  base_amount: number
  rate: number
  amount: number
  regime: string
}

const INITIAL_RETENCIONES: RetencionRow[] = [
  { type: 'iibb', enabled: false, base_amount: 0, rate: 3.0, amount: 0, regime: '' },
  { type: 'ganancias', enabled: false, base_amount: 0, rate: 2.0, amount: 0, regime: '' },
  { type: 'iva', enabled: false, base_amount: 0, rate: 0, amount: 0, regime: '' },
  { type: 'suss', enabled: false, base_amount: 0, rate: 0, amount: 0, regime: '' },
]

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
  const [linkingPago, setLinkingPago] = useState<{ id: string; amount: number; enterprise_id?: string } | null>(null)
  const [dismissedPending, setDismissedPending] = useState<string[]>(getDismissedPending())
  const [pendingCollapsed, setPendingCollapsed] = useState(true)

  const [chequesDisponibles, setChequesDisponibles] = useState<ChequeDisponible[]>([])
  const [selectedChequeId, setSelectedChequeId] = useState('')
  const [purchaseInvoices, setPurchaseInvoices] = useState<any[]>([])
  const [piAmounts, setPiAmounts] = useState<Record<string, string>>({})


  const [form, setForm] = useState({
    enterprise_id: '', purchase_id: '',
    amount: '', payment_method: 'transferencia', bank_id: '',
    reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '',
  })
  const [formCurrency, setFormCurrency] = useState('ARS')
  const [formExchangeRate, setFormExchangeRate] = useState<number | null>(null)

  // Retenciones manuales
  const [retenciones, setRetenciones] = useState<RetencionRow[]>(INITIAL_RETENCIONES)

  const handleRetencionToggle = (idx: number) => {
    setRetenciones(prev => prev.map((r, i) => i !== idx ? r : { ...r, enabled: !r.enabled }))
  }

  const handleRetencionChange = (idx: number, field: string, value: number) => {
    setRetenciones(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const updated = { ...r, [field]: value }
      if (field === 'base_amount' || field === 'rate') {
        updated.amount = Math.round(updated.base_amount * updated.rate) / 100
      }
      return updated
    }))
  }

  const handleRetencionRegime = (idx: number, regime: string) => {
    setRetenciones(prev => prev.map((r, i) => i !== idx ? r : { ...r, regime }))
  }

  const totalRetenciones = retenciones
    .filter(r => r.enabled)
    .reduce((sum, r) => sum + r.amount, 0)

  // Pre-fill retenciones from padron when enterprise changes
  useEffect(() => {
    if (form.enterprise_id) {
      api.calculateRetenciones(form.enterprise_id, parseFloat(form.amount || '0') || 0)
        .then((data: any) => {
          if (data && Array.isArray(data) && data.length > 0) {
            setRetenciones(prev => prev.map(r => {
              const match = data.find((d: any) => d.type === r.type)
              if (match) {
                return {
                  ...r,
                  enabled: true,
                  rate: match.rate || r.rate,
                  base_amount: match.base_amount || parseFloat(form.amount || '0') || 0,
                  amount: match.amount || 0,
                  regime: match.regime || '',
                }
              }
              return r
            }))
          }
        })
        .catch(() => { /* no padron data, keep manual */ })
    } else {
      setRetenciones(INITIAL_RETENCIONES)
    }
  }, [form.enterprise_id])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [pagosRes, entRes, purchRes, bankRes, chequesRes] = await Promise.all([
        api.getPagos(filterEnterprise ? { enterprise_id: filterEnterprise } : undefined).catch((err: any) => {
          setError(`Error cargando pagos: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getEnterprises().catch(() => []),
        api.getPurchases().catch(() => []),
        api.getBanks().catch(() => []),
        api.getChequesForEndorsement().catch(() => []),
      ])
      setPagos(pagosRes || [])
      setEnterprises(entRes || [])
      setPurchases(purchRes || [])
      setBanks(bankRes || [])
      setChequesDisponibles(chequesRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterMethod, dateFrom, dateTo, pageSize])

  // Load purchase invoices for selected enterprise (for linking)
  useEffect(() => {
    if (form.enterprise_id) {
      api.getAvailablePurchaseInvoicesForLinking({ enterprise_id: form.enterprise_id })
        .then((data: any[]) => {
          setPurchaseInvoices(data || [])
        })
        .catch(() => setPurchaseInvoices([]))
    } else {
      setPurchaseInvoices([])
    }
    setPiAmounts({})
  }, [form.enterprise_id])

  // Pre-fill retenciones from purchase invoice retenciones_previstas
  useEffect(() => {
    const linkedPiIds = Object.entries(piAmounts)
      .filter(([, amt]) => parseFloat(amt) > 0)
      .map(([id]) => id)
    if (linkedPiIds.length === 0) return

    // Aggregate retenciones_previstas from all linked purchase invoices
    const retMap = new Map<string, { rate: number; count: number }>()
    for (const piId of linkedPiIds) {
      const pi = purchaseInvoices.find((p: any) => p.id === piId)
      const previstas = pi?.retenciones_previstas
      if (Array.isArray(previstas)) {
        for (const rp of previstas) {
          const existing = retMap.get(rp.type)
          if (existing) {
            // Average rates if multiple invoices have different rates
            existing.rate = (existing.rate * existing.count + rp.rate) / (existing.count + 1)
            existing.count++
          } else {
            retMap.set(rp.type, { rate: rp.rate, count: 1 })
          }
        }
      }
    }

    if (retMap.size > 0) {
      const totalAmount = Object.values(piAmounts).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
      setRetenciones(prev => prev.map(r => {
        const match = retMap.get(r.type)
        if (match) {
          const baseAmount = totalAmount
          const amount = Math.round(baseAmount * match.rate) / 100
          return { ...r, enabled: true, rate: match.rate, base_amount: baseAmount, amount }
        }
        return r
      }))
    }
  }, [piAmounts, purchaseInvoices])

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
    if (form.payment_method === 'cheque') {
      if (!selectedChequeId) {
        setError('Selecciona un cheque para endosar')
        return
      }
      if (!form.enterprise_id) {
        setError('Selecciona un proveedor para endosar el cheque')
        return
      }
      const cheque = chequesDisponibles.find(c => c.id === selectedChequeId)
      if (cheque && parseFloat(form.amount) > parseFloat(cheque.amount)) {
        setError(`El monto ($${form.amount}) supera el valor del cheque ($${cheque.amount})`)
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      if (form.payment_method === 'cheque' && selectedChequeId) {
        // Endorse cheque to pay provider
        const result = await api.endorseCheque(selectedChequeId, {
          enterprise_id: form.enterprise_id,
          amount: parseFloat(form.amount),
          notes: form.notes || undefined,
        })
        if (result.excess > 0) {
          toast.success(`Cheque endosado. Exceso de ${formatCurrency(result.excess)} registrado como credito a favor en CC`)
        } else {
          toast.success('Pago con cheque endosado registrado')
        }
      } else {
        // Build purchase_invoice_items from piAmounts
        const purchaseInvoiceItems = Object.entries(piAmounts)
          .filter(([, amount]) => parseFloat(amount) > 0)
          .map(([purchase_invoice_id, amount]) => ({
            purchase_invoice_id,
            amount: parseFloat(amount),
          }))

        const finalAmount = purchaseInvoiceItems.length > 0
          ? purchaseInvoiceItems.reduce((sum, i) => sum + i.amount, 0)
          : parseFloat(form.amount)

        const enabledRetenciones = retenciones
          .filter(r => r.enabled && r.amount > 0)
          .map(r => ({
            type: r.type,
            base_amount: r.base_amount,
            rate: r.rate,
            amount: r.amount,
            regime: r.regime || null,
          }))

        await api.createPago({
          enterprise_id: form.enterprise_id || null,
          purchase_id: form.purchase_id || null,
          amount: finalAmount,
          payment_method: form.payment_method,
          bank_id: form.bank_id || null,
          reference: form.reference || null,
          payment_date: form.payment_date,
          notes: form.notes || null,
          purchase_invoice_items: purchaseInvoiceItems.length > 0 ? purchaseInvoiceItems : undefined,
          currency: formCurrency,
          exchange_rate: formCurrency !== 'ARS' ? formExchangeRate : undefined,
          retenciones: enabledRetenciones.length > 0 ? enabledRetenciones : undefined,
        })
        toast.success('Pago registrado correctamente')
      }
      setShowForm(false)
      setSelectedChequeId('')
      setFormCurrency('ARS')
      setFormExchangeRate(null)
      setRetenciones(INITIAL_RETENCIONES)
      setForm({ enterprise_id: '', purchase_id: '', amount: '', payment_method: 'transferencia', bank_id: '', reference: '', payment_date: new Date().toISOString().split('T')[0], notes: '' })
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
  const showBankSelector = form.payment_method === 'transferencia'
  const showChequeSelector = form.payment_method === 'cheque'

  // Calculate total from purchase invoice amounts
  const piTotal = Object.values(piAmounts).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
  const hasPiItems = piTotal > 0

  const selectedCheque = chequesDisponibles.find(c => c.id === selectedChequeId)
  const chequeExcess = selectedCheque && form.amount
    ? parseFloat(selectedCheque.amount) - parseFloat(form.amount)
    : 0

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
    { key: 'payment_date', label: 'Fecha', type: 'date' as const },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'purchase_number', label: 'Compra N°' },
    { key: 'amount', label: 'Monto', type: 'currency' as const },
    { key: 'payment_method', label: 'Metodo de Pago' },
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pagos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Pagos realizados a empresas</p>
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
        <Card className="border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700 dark:text-red-400">Total Pagado</p>
            <p className="text-xl font-bold text-red-800 dark:text-red-300">{fmt(totalPagado)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700 dark:text-blue-400">Registros</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{filteredPagos.length}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700 dark:text-purple-400">Empresas</p>
            <p className="text-xl font-bold text-purple-800 dark:text-purple-300">{new Set(filteredPagos.map(p => p.enterprise_id).filter(Boolean)).size}</p>
          </CardContent>
        </Card>
        <Card className="border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">Deuda Pendiente</p>
            <p className="text-xl font-bold text-yellow-800 dark:text-yellow-300">{fmt(totalPendingAmount)}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg animate-fadeIn">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Pendientes de Pago Section */}
      {!loading && pendingPurchases.length > 0 && (
        <Card className="border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-200">
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
                    className="bg-white dark:bg-gray-800 border border-yellow-200 dark:border-yellow-800 rounded-lg px-4 py-3 flex items-center justify-between gap-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="font-mono font-bold text-orange-700 text-sm whitespace-nowrap">
                        #{String(purchase.purchase_number).padStart(4, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
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
                        className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 transition-colors"
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
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Empresa</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value, purchase_id: '' })}>
                  <option value="">Seleccionar...</option>
                  {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                </select>
              </div>
              <Input label={hasPiItems ? `Monto (auto: ${fmt(piTotal)})` : 'Monto *'} type="number" step="0.01" min="0.01" placeholder="0.00" value={hasPiItems ? piTotal.toFixed(2) : form.amount} onChange={e => { if (!hasPiItems) setForm({ ...form, amount: e.target.value }) }} required={!hasPiItems} readOnly={hasPiItems} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Metodo de Pago *</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                  <option value="efectivo">Efectivo</option>
                  <option value="mercado_pago">Mercado Pago</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
              {showBankSelector && (
                <BankSelector
                  banks={banks}
                  value={form.bank_id}
                  onChange={bankId => setForm({ ...form, bank_id: bankId })}
                  onBanksChange={setBanks}
                  label="Banco *"
                />
              )}
              {showChequeSelector && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Cheque disponible *</label>
                  <select
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                    value={selectedChequeId}
                    onChange={e => {
                      const cheque = chequesDisponibles.find(c => c.id === e.target.value)
                      setSelectedChequeId(e.target.value)
                      if (cheque) {
                        const chequeAmount = parseFloat(cheque.amount)
                        const currentAmount = parseFloat(form.amount) || 0
                        setForm({
                          ...form,
                          amount: currentAmount > 0 ? form.amount : chequeAmount.toFixed(2),
                          reference: `Cheque #${cheque.number} - ${cheque.bank}`,
                        })
                      }
                    }}
                    required
                  >
                    <option value="">Seleccionar cheque...</option>
                    {chequesDisponibles.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        #{ch.number} - {ch.bank} - {fmt(ch.amount)} (vto: {fmtDate(ch.due_date)})
                      </option>
                    ))}
                  </select>
                  {chequesDisponibles.length === 0 && (
                    <p className="text-xs text-red-500 mt-1">No hay cheques disponibles para endosar</p>
                  )}
                  {selectedCheque && chequeExcess > 0.01 && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      Exceso de {fmt(chequeExcess)} quedara como credito a favor en CC del proveedor
                    </p>
                  )}
                  {selectedCheque && chequeExcess < -0.01 && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                      El cheque ({fmt(selectedCheque.amount)}) no cubre el monto total. Se descontara lo que cubra.
                    </p>
                  )}
                </div>
              )}
              <Input label="Referencia" placeholder="N° transferencia, cheque, etc." value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
              <DateInput label="Fecha" value={form.payment_date} onChange={val => setForm({ ...form, payment_date: val })} />
              <CurrencySelector
                currency={formCurrency}
                exchangeRate={formExchangeRate}
                onCurrencyChange={setFormCurrency}
                onExchangeRateChange={setFormExchangeRate}
                foreignAmount={parseFloat(form.amount || '0')}
                compact
              />
              <div className="col-span-full">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              {/* Purchase Invoices linking section */}
              {form.enterprise_id && (
                <div className="col-span-full border border-purple-200 dark:border-purple-800 rounded-lg p-4 bg-purple-50/50 dark:bg-purple-950/20">
                  <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-300 mb-3">
                    Vincular a facturas de compra
                    {hasPiItems && <span className="ml-2 text-xs font-normal text-purple-600">Total: {fmt(piTotal)}</span>}
                  </h4>
                  {purchaseInvoices.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 border-b border-purple-200 dark:border-purple-700">
                            <th className="pb-2">Factura</th>
                            <th className="pb-2">Fecha</th>
                            <th className="pb-2 text-right">Total</th>
                            <th className="pb-2 text-right">Restante</th>
                            <th className="pb-2 text-right w-32">Monto a pagar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseInvoices.map((pi: any) => {
                            const remaining = parseFloat(pi.remaining_balance || '0')
                            return (
                              <tr key={pi.id} className="border-b border-purple-100 dark:border-purple-800">
                                <td className="py-2">
                                  <span className="font-mono font-medium text-purple-800 dark:text-purple-300">
                                    {pi.invoice_type} {pi.invoice_number}
                                  </span>
                                </td>
                                <td className="py-2 text-gray-500">{fmtDate(pi.invoice_date)}</td>
                                <td className="py-2 text-right">{fmt(pi.total_amount)}</td>
                                <td className="py-2 text-right text-orange-600 dark:text-orange-400">{fmt(remaining)}</td>
                                <td className="py-2 text-right">
                                  <div className="flex items-center gap-1 justify-end">
                                    <input
                                      type="number"
                                      min="0"
                                      max={remaining}
                                      step="0.01"
                                      placeholder="0.00"
                                      value={piAmounts[pi.id] || ''}
                                      onChange={e => setPiAmounts({ ...piAmounts, [pi.id]: e.target.value })}
                                      className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-right text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-1 focus:ring-purple-500"
                                    />
                                    <button type="button" onClick={() => setPiAmounts({ ...piAmounts, [pi.id]: remaining.toFixed(2) })} className="text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap">Todo</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">
                      {form.enterprise_id ? 'Este proveedor no tiene facturas de compra pendientes' : 'Selecciona un proveedor'}
                    </p>
                  )}
                </div>
              )}

              {/* Retenciones */}
              <div className="col-span-full border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <h4 className="font-medium mb-3 text-gray-800 dark:text-gray-200">Retenciones (opcional)</h4>
                <div className="space-y-2">
                  {retenciones.map((ret, idx) => (
                    <div key={ret.type} className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={ret.enabled}
                        onChange={() => handleRetencionToggle(idx)}
                        className="rounded border-gray-300"
                      />
                      <span className="w-24 text-sm font-medium text-gray-700 dark:text-gray-300">{RETENCION_LABELS[ret.type]}</span>
                      <input
                        type="number"
                        placeholder="Base"
                        step="0.01"
                        min="0"
                        value={ret.base_amount || ''}
                        disabled={!ret.enabled}
                        className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        onChange={e => handleRetencionChange(idx, 'base_amount', parseFloat(e.target.value) || 0)}
                      />
                      <input
                        type="number"
                        placeholder="%"
                        step="0.01"
                        min="0"
                        value={ret.rate || ''}
                        disabled={!ret.enabled}
                        className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        onChange={e => handleRetencionChange(idx, 'rate', parseFloat(e.target.value) || 0)}
                      />
                      <input
                        type="text"
                        placeholder="Regimen"
                        value={ret.regime}
                        disabled={!ret.enabled}
                        className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        onChange={e => handleRetencionRegime(idx, e.target.value)}
                      />
                      <span className="w-28 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                        $ {ret.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                {totalRetenciones > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-between text-sm text-gray-700 dark:text-gray-300">
                    <span>Neto a pagar: <b>$ {(hasPiItems ? piTotal : parseFloat(form.amount || '0')).toFixed(2)}</b></span>
                    <span>Retenciones: <b>$ {totalRetenciones.toFixed(2)}</b></span>
                    <span>Total que cancela: <b>$ {((hasPiItems ? piTotal : parseFloat(form.amount || '0')) + totalRetenciones).toFixed(2)}</b></span>
                  </div>
                )}
              </div>

              <div className="flex items-end col-span-full">
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
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todas las empresas</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Metodo de Pago</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
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
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Compra</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Metodo</th>
                  <th className="px-4 py-3">Banco</th>
                  <th className="px-4 py-3">Asignacion</th>
                  <th className="px-4 py-3">Referencia</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedPagos.map(pago => (
                  <tr key={pago.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{fmtDate(pago.payment_date)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-gray-900 dark:text-gray-100">{pago.enterprise_name || <span className="text-gray-400">-</span>}</p>
                        <TagBadges tags={pago.enterprise_tags || []} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {pago.purchase_number ? (
                        <span className="font-mono text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">#{String(pago.purchase_number).padStart(4, '0')}</span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-red-600">{fmt(pago.amount)}</span>
                      {pago.retenciones && pago.retenciones.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5 justify-end">
                          {pago.retenciones.map((ret) => (
                            <span key={ret.id} className="text-[10px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 px-1 py-0.5 rounded">
                              {ret.type.toUpperCase()} {parseFloat(ret.rate).toFixed(1)}% = {fmt(ret.amount)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[pago.payment_method] || pago.payment_method}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{pago.bank_name || '-'}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const totalAmt = parseFloat(pago.amount || '0')
                        const assigned = parseFloat(String((pago as any).total_assigned || '0'))
                        const invoices = (pago as any).linked_purchase_invoices || []
                        const isFullyAssigned = assigned >= totalAmt - 0.01 && totalAmt > 0
                        const isPartial = assigned > 0 && !isFullyAssigned
                        return (
                          <div>
                            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                              isFullyAssigned ? 'bg-green-100 text-green-800' :
                              isPartial ? 'bg-blue-100 text-blue-800' :
                              'bg-orange-100 text-orange-800'
                            }`}>
                              {isFullyAssigned ? 'Completo' : isPartial ? `Parcial` : 'Sin vincular'}
                            </span>
                            {invoices.length > 0 && (
                              <div className="flex flex-wrap gap-0.5 mt-0.5">
                                {invoices.map((pi: any, idx: number) => (
                                  <span key={pi.id || idx} className="text-[10px] text-purple-600 font-mono">
                                    {pi.invoice_type}{pi.invoice_number}({fmt(pi.amount)})
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">{pago.reference ? <span className="font-mono text-xs">{pago.reference}</span> : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <PermissionGate module="pagos" action="create">
                          <button
                            onClick={() => setLinkingPago({
                              id: pago.id,
                              amount: Number(pago.total_amount || pago.amount || 0),
                              enterprise_id: pago.enterprise_id || undefined,
                            })}
                            className="text-purple-600 hover:text-purple-800 text-xs font-medium transition-colors"
                          >
                            Vincular
                          </button>
                        </PermissionGate>
                        <PermissionGate module="pagos" action="delete">
                          <button onClick={() => setDeleteTarget(pago)} className="text-red-500 hover:text-red-700 text-sm transition-colors">Eliminar</button>
                        </PermissionGate>
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

      {/* Modal: vincular pago existente a facturas de compra */}
      {linkingPago && (
        <PagoInvoiceLinker
          pagoId={linkingPago.id}
          pagoAmount={linkingPago.amount}
          enterpriseId={linkingPago.enterprise_id}
          onClose={() => setLinkingPago(null)}
          onLinked={() => { setLinkingPago(null); loadData() }}
        />
      )}
    </div>
  )
}
