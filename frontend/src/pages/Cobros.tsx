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

interface Enterprise { id: string; name: string }
interface Order { id: string; order_number: number; title: string; total_amount: string; payment_status?: string; enterprise_id?: string; enterprise?: { id: string; name: string } | null; customer?: { id?: string; name?: string; enterprise_id?: string } }
interface Bank { id: string; bank_name: string }
interface Cobro {
  id: string
  enterprise_name: string | null
  enterprise_id: string | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  order_id: string | null
  order_number: number | null
  order_title: string | null
  amount: string
  payment_method: string
  bank_name: string | null
  reference: string | null
  payment_date: string
  notes: string | null
  has_receipt: boolean
  item_count: number
}

interface Receipt {
  id: string
  receipt_number: number
  receipt_date: string
  total_amount: string
  payment_method: string | null
  notes: string | null
  enterprise_id: string | null
  enterprise_name: string | null
  bank_id: string | null
  bank_name: string | null
  reference: string | null
  items: {
    id: string
    invoice_id: string
    amount: string
    invoice_number: number
    invoice_type: string | null
    invoice_total: string
    fiscal_type: string | null
    enterprise_name: string
    customer_name: string
  }[]
}

interface InvoiceForReceipt {
  id: string
  invoice_number: number
  invoice_type: string | null
  fiscal_type: string | null
  total_amount: string
  enterprise?: { name: string } | null
  customer?: { name: string } | null
  payment_status: string
  total_cobrado: string
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
}

const DISMISSED_PENDING_COBROS_KEY = 'gestia_dismissed_pending_cobros'

function getDismissedPendingCobros(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_PENDING_COBROS_KEY) || '[]')
  } catch {
    return []
  }
}

function dismissPendingCobro(orderId: string) {
  const dismissed = getDismissedPendingCobros()
  if (!dismissed.includes(orderId)) {
    localStorage.setItem(DISMISSED_PENDING_COBROS_KEY, JSON.stringify([...dismissed, orderId]))
  }
}

function restorePendingCobros() {
  localStorage.removeItem(DISMISSED_PENDING_COBROS_KEY)
}

export const Cobros: React.FC = () => {
  // Data state
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showInvoiceSection, setShowInvoiceSection] = useState(false)
  const [invoicesForReceipt, setInvoicesForReceipt] = useState<InvoiceForReceipt[]>([])
  const [invoiceItems, setInvoiceItems] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    enterprise_id: '',
    amount: '',
    payment_method: 'transferencia',
    bank_id: '',
    reference: '',
    receipt_date: new Date().toISOString().split('T')[0],
    notes: '',
  })

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Receipt | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Pending orders state
  const [dismissedPendingCobros, setDismissedPendingCobros] = useState<string[]>(getDismissedPendingCobros())
  const [pendingCollapsed, setPendingCollapsed] = useState(false)

  // Filter state
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [receiptsRes, cobrosRes, entRes, ordersRes, bankRes] = await Promise.all([
        api.getReceipts().catch((err: any) => {
          console.warn('Could not load receipts:', err.message)
          return []
        }),
        api.getCobros(filterEnterprise ? { enterprise_id: filterEnterprise } : undefined).catch((err: any) => {
          setError(`Error cargando cobros: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getEnterprises().catch(() => []),
        api.getOrders({ limit: 200 }).catch(() => ({ items: [] })),
        api.getBanks().catch(() => []),
      ])
      setReceipts(receiptsRes || [])
      setCobros(cobrosRes || [])
      setEnterprises(entRes || [])
      setOrders((ordersRes.items || ordersRes || []))
      setBanks(bankRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise])

  const loadInvoicesForReceipt = useCallback(async () => {
    try {
      const res = await api.getInvoices({ fiscal_type: 'all', limit: 200 })
      const items: InvoiceForReceipt[] = (res.items || []).filter((inv: any) =>
        (inv.status === 'authorized' || inv.status === 'emitido') &&
        (inv.payment_status !== 'pagado')
      )
      setInvoicesForReceipt(items)
    } catch (e: any) {
      console.warn('Could not load invoices for receipt:', e.message)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterMethod, dateFrom, dateTo, pageSize])

  // Calculate paid amounts per order from cobros data
  const paidByOrder = useMemo(() => {
    const map = new Map<string, number>()
    for (const cobro of cobros) {
      if (cobro.order_id) {
        const current = map.get(cobro.order_id) || 0
        map.set(cobro.order_id, current + Number(cobro.amount || 0))
      }
    }
    return map
  }, [cobros])

  // Pending orders (pendiente or parcial payment_status, not dismissed, not cancelled)
  const pendingOrders = useMemo(() => {
    const allOrders = Array.isArray(orders) ? orders : []
    return allOrders
      .filter((o: any) => o.payment_status === 'pendiente' || o.payment_status === 'parcial')
      .filter((o: any) => o.status !== 'cancelado')
      .filter(o => !dismissedPendingCobros.includes(o.id))
      .map(o => {
        const total = parseFloat(o.total_amount || '0')
        const paid = paidByOrder.get(o.id) || 0
        const remaining = Math.max(0, total - paid)
        const enterpriseName = (o as any).enterprise?.name || (o as any).customer?.name || 'Sin empresa'
        const enterpriseId = (o as any).enterprise?.id || (o as any).enterprise_id || (o as any).customer?.enterprise_id || ''
        return { ...o, paid, remaining, enterprise_name: enterpriseName, resolved_enterprise_id: enterpriseId }
      })
  }, [orders, paidByOrder, dismissedPendingCobros])

  const totalPendingCobros = pendingOrders.reduce((sum, o) => sum + o.remaining, 0)
  const hasDismissedPendingCobros = dismissedPendingCobros.length > 0

  const handleDismissPendingCobro = (orderId: string) => {
    dismissPendingCobro(orderId)
    setDismissedPendingCobros([...dismissedPendingCobros, orderId])
  }

  const handleRestorePendingCobros = () => {
    restorePendingCobros()
    setDismissedPendingCobros([])
  }

  const handleCollectFromOrder = useCallback((order: typeof pendingOrders[0]) => {
    setForm({
      enterprise_id: order.resolved_enterprise_id,
      amount: order.remaining.toFixed(2),
      payment_method: 'transferencia',
      bank_id: '',
      reference: '',
      receipt_date: new Date().toISOString().split('T')[0],
      notes: `Cobro pedido #${String(order.order_number).padStart(4, '0')}`,
    })
    setInvoiceItems({})
    setShowInvoiceSection(false)
    setShowForm(true)
  }, [])

  const handleOpenForm = async () => {
    setShowForm(true)
    setForm({
      enterprise_id: '',
      amount: '',
      payment_method: 'transferencia',
      bank_id: '',
      reference: '',
      receipt_date: new Date().toISOString().split('T')[0],
      notes: '',
    })
    setInvoiceItems({})
    setShowInvoiceSection(false)
  }

  const handleToggleInvoices = async () => {
    if (!showInvoiceSection) {
      await loadInvoicesForReceipt()
    }
    setShowInvoiceSection(!showInvoiceSection)
  }

  const invoiceTotal = useMemo(() => {
    return Object.values(invoiceItems).reduce((sum, v) => sum + parseFloat(v || '0'), 0)
  }, [invoiceItems])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const items = Object.entries(invoiceItems)
      .filter(([_, amount]) => parseFloat(amount) > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount: parseFloat(amount) }))

    const hasInvoiceItems = items.length > 0
    const directAmount = parseFloat(form.amount || '0')

    if (!hasInvoiceItems && directAmount <= 0) {
      toast.error('Ingresa un monto o selecciona facturas a cobrar')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api.createReceipt({
        receipt_date: form.receipt_date,
        payment_method: form.payment_method,
        notes: form.notes || null,
        enterprise_id: form.enterprise_id || null,
        bank_id: form.bank_id || null,
        reference: form.reference || null,
        ...(hasInvoiceItems
          ? { items }
          : { amount: directAmount }
        ),
      })
      setShowForm(false)
      setInvoiceItems({})
      setShowInvoiceSection(false)
      toast.success('Cobro registrado correctamente')
      await loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteReceipt(deleteTarget.id)
      toast.success('Cobro eliminado')
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

  // Filtered + paginated receipts
  const filteredReceipts = useMemo(() => {
    let result = receipts
    if (filterEnterprise) {
      result = result.filter(r => {
        // Match by direct enterprise_id or by enterprise in invoice items
        if (r.enterprise_id === filterEnterprise) return true
        return (r.items || []).some(item => {
          const matchEnterprise = enterprises.find(e => e.name === item.enterprise_name)
          return matchEnterprise?.id === filterEnterprise
        })
      })
    }
    if (filterMethod) result = result.filter(r => r.payment_method === filterMethod)
    if (dateFrom) result = result.filter(r => {
      const d = r.receipt_date ? new Date(r.receipt_date).toISOString().split('T')[0] : ''
      return d >= dateFrom
    })
    if (dateTo) result = result.filter(r => {
      const d = r.receipt_date ? new Date(r.receipt_date).toISOString().split('T')[0] : ''
      return d <= dateTo
    })
    return result
  }, [receipts, filterEnterprise, filterMethod, dateFrom, dateTo, enterprises])

  const totalCobrado = filteredReceipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0)
  const totalPages = Math.ceil(filteredReceipts.length / pageSize)
  const paginatedReceipts = filteredReceipts.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = !!filterEnterprise || !!filterMethod || !!dateFrom || !!dateTo

  const csvColumns = [
    { key: 'receipt_date', label: 'Fecha' },
    { key: 'receipt_number', label: 'N Recibo' },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'total_amount', label: 'Monto' },
    { key: 'payment_method', label: 'Metodo' },
    { key: 'bank_name', label: 'Banco' },
    { key: 'reference', label: 'Referencia' },
    { key: 'notes', label: 'Notas' },
  ]

  const csvData = filteredReceipts.map(r => ({
    ...r,
    enterprise_name: r.enterprise_name || (r.items || []).map(i => i.enterprise_name).filter(Boolean).join(', ') || '-',
  }))

  const clearFilters = () => {
    setFilterEnterprise('')
    setFilterMethod('')
    setDateFrom('')
    setDateTo('')
  }

  const getReceiptEnterpriseName = (receipt: Receipt): string => {
    if (receipt.enterprise_name) return receipt.enterprise_name
    const names = (receipt.items || []).map(i => i.enterprise_name || i.customer_name).filter(Boolean)
    const unique = [...new Set(names)]
    return unique.join(', ') || '-'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cobros</h1>
          <p className="text-sm text-gray-500 mt-1">Pagos recibidos de empresas</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={csvColumns} filename="cobros" />
          <ExportExcelButton data={csvData} columns={csvColumns} filename="cobros" />
          <PermissionGate module="cobros" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => showForm ? setShowForm(false) : handleOpenForm()}>
              {showForm ? 'Cancelar' : '+ Registrar Cobro'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700">Total Cobrado</p>
            <p className="text-xl font-bold text-green-800">{fmt(totalCobrado)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700">Registros</p>
            <p className="text-xl font-bold text-blue-800">{filteredReceipts.length}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 bg-purple-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700">Empresas</p>
            <p className="text-xl font-bold text-purple-800">{new Set(filteredReceipts.map(r => r.enterprise_id || r.items?.[0]?.enterprise_name).filter(Boolean)).size}</p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 bg-orange-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-orange-700">Pendiente de Cobro</p>
            <p className="text-xl font-bold text-orange-800">{fmt(totalPendingCobros)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pedidos por Cobrar Section */}
      {!loading && pendingOrders.length > 0 && (
        <Card className="border border-orange-300 bg-gradient-to-r from-orange-50 to-yellow-50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-orange-900">
                  Pedidos por Cobrar
                </h3>
                <span className="text-xs font-medium bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">
                  {pendingOrders.length}
                </span>
              </div>
              <button
                onClick={() => setPendingCollapsed(!pendingCollapsed)}
                className="text-orange-700 hover:text-orange-900 text-sm font-medium transition-colors flex items-center gap-1"
              >
                {pendingCollapsed ? 'Expandir' : 'Colapsar'}
                <span className="text-xs">{pendingCollapsed ? '\u25BC' : '\u25B2'}</span>
              </button>
            </div>
          </CardHeader>
          {!pendingCollapsed && (
            <CardContent className="pt-0">
              <div className="space-y-2">
                {pendingOrders.map(order => (
                  <div
                    key={order.id}
                    className="bg-white border border-orange-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="font-mono font-bold text-orange-700 text-sm whitespace-nowrap">
                        #{String(order.order_number).padStart(4, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {order.enterprise_name}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                          <span>Total: {fmt(order.total_amount)}</span>
                          {order.paid > 0 && (
                            <span className="text-green-600">Cobrado: {fmt(order.paid)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="text-sm font-bold text-orange-700">{fmt(order.remaining)}</p>
                        <p className="text-xs text-gray-400">restante</p>
                      </div>
                      <span className={`text-xs font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${
                        order.payment_status === 'parcial'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {order.payment_status === 'parcial' ? 'Parcial' : 'Pendiente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PermissionGate module="cobros" action="create">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handleCollectFromOrder(order)}
                        >
                          Cobrar
                        </Button>
                      </PermissionGate>
                      <button
                        onClick={() => handleDismissPendingCobro(order.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        title="Ocultar temporalmente"
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {hasDismissedPendingCobros && (
                <button
                  onClick={handleRestorePendingCobros}
                  className="text-xs text-gray-400 hover:text-orange-600 transition-colors mt-3"
                >
                  Mostrar ocultos ({dismissedPendingCobros.length})
                </button>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Restore dismissed when all are hidden */}
      {!loading && pendingOrders.length === 0 && hasDismissedPendingCobros && (
        <button
          onClick={handleRestorePendingCobros}
          className="text-xs text-gray-400 hover:text-orange-600 transition-colors"
        >
          Mostrar pedidos por cobrar ocultos ({dismissedPendingCobros.length})
        </button>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg animate-fadeIn">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">Registrar Cobro</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Empresa</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                  </select>
                </div>
                <Input label="Monto *" type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
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
                    <label className="text-sm font-medium text-gray-700">Banco</label>
                    <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })}>
                      <option value="">Seleccionar banco...</option>
                      {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name}</option>)}
                    </select>
                  </div>
                )}
                <Input label="Referencia" placeholder="N transferencia, cheque, etc." value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
                <Input label="Fecha" type="date" value={form.receipt_date} onChange={e => setForm({ ...form, receipt_date: e.target.value })} />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              {/* Optional invoice linking */}
              <div className="border-t border-gray-200 pt-3">
                <button
                  type="button"
                  onClick={handleToggleInvoices}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                >
                  {showInvoiceSection ? 'Ocultar facturas' : 'Vincular a facturas (opcional)'}
                </button>
              </div>

              {showInvoiceSection && (
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-2">Facturas a cobrar</label>
                  {invoicesForReceipt.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No hay facturas pendientes de cobro</p>
                  ) : (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500">
                            <th className="px-3 py-2 text-left">Factura</th>
                            <th className="px-3 py-2 text-left">Cliente / Empresa</th>
                            <th className="px-3 py-2 text-right">Total</th>
                            <th className="px-3 py-2 text-right">Cobrado</th>
                            <th className="px-3 py-2 text-right">Restante</th>
                            <th className="px-3 py-2 text-right w-36">Monto a pagar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoicesForReceipt.map(inv => {
                            const total = parseFloat(inv.total_amount || '0')
                            const cobrado = parseFloat(inv.total_cobrado || '0')
                            const remaining = Math.max(0, total - cobrado)
                            const invLabel = inv.fiscal_type === 'interno'
                              ? `CI-${String(inv.invoice_number).padStart(6, '0')}`
                              : inv.fiscal_type === 'no_fiscal'
                                ? `NF-${String(inv.invoice_number).padStart(6, '0')}`
                                : `${inv.invoice_type || ''} ${String(inv.invoice_number).padStart(8, '0')}`
                            return (
                              <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2 font-mono text-xs font-semibold">{invLabel}</td>
                                <td className="px-3 py-2 text-gray-700">{inv.enterprise?.name || inv.customer?.name || 'Consumidor Final'}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{fmt(total)}</td>
                                <td className="px-3 py-2 text-right text-green-600">{fmt(cobrado)}</td>
                                <td className="px-3 py-2 text-right font-medium">{fmt(remaining)}</td>
                                <td className="px-3 py-2 text-right">
                                  {remaining > 0 ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max={remaining}
                                      placeholder="0.00"
                                      value={invoiceItems[inv.id] || ''}
                                      onChange={e => {
                                        const val = e.target.value
                                        setInvoiceItems(prev => {
                                          const next = { ...prev }
                                          if (val && parseFloat(val) > 0) next[inv.id] = val
                                          else delete next[inv.id]
                                          return next
                                        })
                                      }}
                                      className="w-full px-2 py-1 border border-gray-300 rounded text-right text-sm"
                                    />
                                  ) : (
                                    <span className="text-xs text-green-600 font-medium">Completo</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {invoiceTotal > 0 && (
                    <p className="text-sm text-gray-600 mt-2">
                      Total facturas seleccionadas: <span className="font-bold text-green-700">{fmt(invoiceTotal)}</span>
                      <span className="text-xs text-gray-400 ml-2">(el monto del recibo se calculara automaticamente)</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <div className="text-sm text-gray-600">
                  Total: <span className="font-bold text-lg text-green-700 ml-2">
                    {fmt(invoiceTotal > 0 ? invoiceTotal : parseFloat(form.amount || '0'))}
                  </span>
                </div>
                <Button type="submit" variant="success" loading={saving}>
                  Registrar Cobro
                </Button>
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
        <SkeletonTable rows={6} cols={6} />
      ) : filteredReceipts.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay cobros con estos filtros' : 'No hay cobros registrados'}
          description={isFiltered ? undefined : 'Registra el primer cobro para empezar a llevar el control'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Registrar Cobro'}
          onAction={isFiltered ? clearFilters : handleOpenForm}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-3">N Recibo</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Metodo</th>
                  <th className="px-4 py-3">Referencia</th>
                  <th className="px-4 py-3">Facturas</th>
                  <th className="px-4 py-3">Notas</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedReceipts.map(receipt => (
                  <tr key={receipt.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-gray-800">
                      #{String(receipt.receipt_number).padStart(6, '0')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(receipt.receipt_date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{getReceiptEnterpriseName(receipt)}</td>
                    <td className="px-4 py-3 text-right"><span className="font-bold text-green-700">{fmt(receipt.total_amount)}</span></td>
                    <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[receipt.payment_method || ''] || receipt.payment_method || '-'}</td>
                    <td className="px-4 py-3">{receipt.reference ? <span className="font-mono text-xs">{receipt.reference}</span> : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(receipt.items || []).length > 0 ? (
                          receipt.items.map((item, idx) => {
                            const label = item.fiscal_type === 'interno'
                              ? `CI-${String(item.invoice_number).padStart(6, '0')}`
                              : item.fiscal_type === 'no_fiscal'
                                ? `NF-${String(item.invoice_number).padStart(6, '0')}`
                                : `${item.invoice_type || ''} ${String(item.invoice_number).padStart(8, '0')}`
                            return (
                              <span key={item.id || idx} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono" title={`${item.customer_name} - ${fmt(item.amount)}`}>
                                {label} ({fmt(item.amount)})
                              </span>
                            )
                          })
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[150px] truncate" title={receipt.notes || ''}>{receipt.notes || '-'}</td>
                    <td className="px-4 py-3">
                      <PermissionGate module="cobros" action="delete">
                        <button
                          onClick={() => setDeleteTarget(receipt)}
                          className="text-red-500 hover:text-red-700 text-sm transition-colors"
                        >
                          Eliminar
                        </button>
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
            totalItems={filteredReceipts.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar cobro"
        message={`Eliminar el recibo #${deleteTarget ? String(deleteTarget.receipt_number).padStart(6, '0') : ''}? El cobro asociado tambien se eliminara. Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
