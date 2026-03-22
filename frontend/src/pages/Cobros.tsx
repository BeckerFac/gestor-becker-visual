import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { HelpTip } from '@/components/shared/HelpTip'

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

interface OrderForReceipt {
  id: string
  order_number: number
  title: string
  total_amount: string
  enterprise_name: string
  customer_name: string
  paid: number
  remaining: number
}

interface AgingDetail {
  enterprise_name: string
  customer_name: string
  document_type: 'invoice' | 'order'
  document_number: string
  total_amount: number
  paid_amount: number
  remaining: number
  due_date: string
  days_overdue: number
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+'
}

interface AgingData {
  summary: {
    current: number
    bucket_1_30: number
    bucket_31_60: number
    bucket_61_90: number
    bucket_90_plus: number
    total_overdue: number
  }
  details: AgingDetail[]
  worst_clients: Array<{ enterprise_name: string; total_overdue: number; oldest_days: number }>
  avg_dso: number
}

const BUCKET_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  'current': { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-t-[#22C55E]', text: 'text-green-800 dark:text-green-200', dot: 'bg-[#22C55E]' },
  '1-30': { bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-t-[#EAB308]', text: 'text-yellow-800 dark:text-yellow-200', dot: 'bg-[#EAB308]' },
  '31-60': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-t-[#F97316]', text: 'text-orange-800 dark:text-orange-200', dot: 'bg-[#F97316]' },
  '61-90': { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-t-[#EF4444]', text: 'text-red-800 dark:text-red-200', dot: 'bg-[#EF4444]' },
  '90+': { bg: 'bg-red-100 dark:bg-red-950/50', border: 'border-t-[#991B1B]', text: 'text-red-900 dark:text-red-100', dot: 'bg-[#991B1B]' },
}

const BUCKET_LABELS: Record<string, string> = {
  'current': 'Al dia',
  '1-30': '1-30 dias',
  '31-60': '31-60 dias',
  '61-90': '61-90 dias',
  '90+': '90+ dias',
}

function getRowBgClass(bucket: string): string {
  switch (bucket) {
    case '1-30': return 'bg-yellow-50/50 dark:bg-yellow-950/10'
    case '31-60': return 'bg-orange-50/50 dark:bg-orange-950/10'
    case '61-90': return 'bg-red-50/50 dark:bg-red-950/10'
    case '90+': return 'bg-red-100/50 dark:bg-red-950/20'
    default: return ''
  }
}

function getPaymentBehavior(avgDaysOverdue: number): { label: string; className: string } {
  if (avgDaysOverdue <= 7) return { label: 'Buen pagador', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' }
  if (avgDaysOverdue <= 30) return { label: 'Regular', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' }
  return { label: 'Moroso', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' }
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
}

const CHEQUE_TYPES = [
  { value: 'comun', label: 'Comun' },
  { value: 'cruzado', label: 'Cruzado' },
  { value: 'no_a_la_orden', label: 'No a la orden' },
  { value: 'diferido', label: 'Diferido' },
]

const INITIAL_CHEQUE_FORM = {
  number: '',
  bank: '',
  cheque_type: 'comun',
  drawer: '',
  drawer_cuit: '',
  issue_date: new Date().toISOString().split('T')[0],
  due_date: '',
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
  const [searchParams, setSearchParams] = useSearchParams()
  const invoiceParamProcessed = useRef(false)

  // Data state
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [aging, setAging] = useState<AgingData | null>(null)
  const [agingCollapsed, setAgingCollapsed] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showInvoiceSection, setShowInvoiceSection] = useState(false)
  const [linkTab, setLinkTab] = useState<'invoices' | 'orders'>('invoices')
  const [invoicesForReceipt, setInvoicesForReceipt] = useState<InvoiceForReceipt[]>([])
  const [ordersForReceipt, setOrdersForReceipt] = useState<OrderForReceipt[]>([])
  const [invoiceItems, setInvoiceItems] = useState<Record<string, string>>({})
  const [orderItems, setOrderItems] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    enterprise_id: '',
    amount: '',
    payment_method: 'transferencia',
    bank_id: '',
    reference: '',
    receipt_date: new Date().toISOString().split('T')[0],
    notes: '',
  })

  // Cheque form state
  const [chequeForm, setChequeForm] = useState({ ...INITIAL_CHEQUE_FORM })

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Receipt | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Pending orders state
  const [dismissedPendingCobros, setDismissedPendingCobros] = useState<string[]>(getDismissedPendingCobros())
  const [pendingCollapsed, setPendingCollapsed] = useState(true)

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
      const [receiptsRes, cobrosRes, entRes, ordersRes, bankRes, agingRes] = await Promise.all([
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
        api.getAgingReport().catch(() => null),
      ])
      setReceipts(receiptsRes || [])
      setCobros(cobrosRes || [])
      setEnterprises(entRes || [])
      setOrders((ordersRes.items || ordersRes || []))
      setBanks(bankRes || [])
      setAging(agingRes)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise])

  const loadInvoicesForReceipt = useCallback(async () => {
    try {
      const [invoiceRes, ordersRes, cobrosRes] = await Promise.all([
        api.getInvoices({ fiscal_type: 'all', limit: 200 }).catch(() => ({ items: [] })),
        api.getOrders({ limit: 200 }).catch(() => ({ items: [] })),
        api.getCobros().catch(() => []),
      ])
      const items: InvoiceForReceipt[] = (invoiceRes.items || []).filter((inv: any) =>
        (inv.status === 'authorized' || inv.status === 'emitido') &&
        (inv.payment_status !== 'pagado')
      )
      setInvoicesForReceipt(items)

      // Build orders without invoice that are not fully paid
      const allOrders = (ordersRes.items || ordersRes || []) as any[]
      // Get invoiced order IDs (orders that have a linked authorized invoice)
      const invoicedOrderIds = new Set(
        (invoiceRes.items || [])
          .filter((inv: any) => inv.order_id && (inv.status === 'authorized' || inv.status === 'emitido'))
          .map((inv: any) => inv.order_id)
      )
      // Calculate paid per order from cobros
      const paidMap = new Map<string, number>()
      for (const c of (cobrosRes || [])) {
        if (c.order_id) {
          paidMap.set(c.order_id, (paidMap.get(c.order_id) || 0) + Number(c.amount || 0))
        }
      }
      const ordersWithoutInv: OrderForReceipt[] = allOrders
        .filter((o: any) => o.payment_status !== 'pagado' && o.status !== 'cancelado' && !invoicedOrderIds.has(o.id))
        .map((o: any) => {
          const total = parseFloat(o.total_amount || '0')
          const paid = paidMap.get(o.id) || 0
          const remaining = Math.max(0, total - paid)
          return {
            id: o.id,
            order_number: o.order_number,
            title: o.title || '',
            total_amount: o.total_amount,
            enterprise_name: o.enterprise?.name || o.customer?.name || 'Sin empresa',
            customer_name: o.customer?.name || '',
            paid,
            remaining,
          }
        })
        .filter((o: OrderForReceipt) => o.remaining > 0)
      setOrdersForReceipt(ordersWithoutInv)
    } catch (e: any) {
      console.warn('Could not load invoices/orders for receipt:', e.message)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterMethod, dateFrom, dateTo, pageSize])

  // Pre-fill form from invoice query params (coming from Invoices page)
  useEffect(() => {
    if (invoiceParamProcessed.current || loading) return
    const invoiceId = searchParams.get('invoice_id')
    const amount = searchParams.get('amount')
    if (!invoiceId) return

    invoiceParamProcessed.current = true
    // Clear query params from URL without triggering navigation
    setSearchParams({}, { replace: true })

    // Open form and pre-fill
    const prefillFromInvoice = async () => {
      try {
        const res = await api.getInvoices({ fiscal_type: 'all', limit: 200 })
        const allInvoices: InvoiceForReceipt[] = (res.items || []).filter((inv: any) =>
          (inv.status === 'authorized' || inv.status === 'emitido') &&
          (inv.payment_status !== 'pagado')
        )
        setInvoicesForReceipt(allInvoices)

        const targetInvoice = allInvoices.find((inv: InvoiceForReceipt) => inv.id === invoiceId)
        const enterpriseId = targetInvoice
          ? enterprises.find(e => e.name === (targetInvoice.enterprise?.name || ''))?.id || ''
          : ''

        const remaining = amount || '0'

        setForm({
          enterprise_id: enterpriseId,
          amount: '',
          payment_method: 'transferencia',
          bank_id: '',
          reference: '',
          receipt_date: new Date().toISOString().split('T')[0],
          notes: '',
        })
        setInvoiceItems({ [invoiceId]: remaining })
        setShowInvoiceSection(true)
        setShowForm(true)
      } catch (e: any) {
        console.warn('Could not prefill from invoice params:', e.message)
        setShowForm(true)
      }
    }
    prefillFromInvoice()
  }, [searchParams, loading, enterprises, setSearchParams])

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
    // Auto-scroll to the form so the user sees it
    setTimeout(() => {
      const el = document.getElementById('registrar-cobro-form')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('cobro-form-highlight')
        setTimeout(() => el.classList.remove('cobro-form-highlight'), 1500)
      }
    }, 300)
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
    setChequeForm({ ...INITIAL_CHEQUE_FORM })
    setInvoiceItems({})
    setOrderItems({})
    setShowInvoiceSection(false)
    setLinkTab('invoices')
    // Auto-scroll to the form so the user sees it
    setTimeout(() => {
      const el = document.getElementById('registrar-cobro-form')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('cobro-form-highlight')
        setTimeout(() => el.classList.remove('cobro-form-highlight'), 1500)
      }
    }, 300)
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

  const orderTotal = useMemo(() => {
    return Object.values(orderItems).reduce((sum, v) => sum + parseFloat(v || '0'), 0)
  }, [orderItems])

  const linkedTotal = invoiceTotal + orderTotal

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const items = Object.entries(invoiceItems)
      .filter(([_, amount]) => parseFloat(amount) > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount: parseFloat(amount) }))

    const oItems = Object.entries(orderItems)
      .filter(([_, amount]) => parseFloat(amount) > 0)
      .map(([order_id, amount]) => ({ order_id, amount: parseFloat(amount) }))

    const hasInvoiceItems = items.length > 0
    const hasOrderItems = oItems.length > 0
    const directAmount = parseFloat(form.amount || '0')

    if (!hasInvoiceItems && !hasOrderItems && directAmount <= 0) {
      toast.error('Ingresa un monto o selecciona facturas/pedidos a cobrar')
      return
    }

    // Validate cheque fields if payment method is cheque
    if (form.payment_method === 'cheque') {
      if (!chequeForm.number || !chequeForm.bank || !chequeForm.drawer || !chequeForm.issue_date || !chequeForm.due_date) {
        toast.error('Completa todos los campos obligatorios del cheque')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const receiptPayload: any = {
        receipt_date: form.receipt_date,
        payment_method: form.payment_method,
        notes: form.notes || null,
        enterprise_id: form.enterprise_id || null,
        bank_id: form.bank_id || null,
        reference: form.reference || null,
        ...((hasInvoiceItems || hasOrderItems)
          ? {
              ...(hasInvoiceItems ? { items } : {}),
              ...(hasOrderItems ? { order_items: oItems } : {}),
            }
          : { amount: directAmount }
        ),
      }

      // Attach cheque data if payment method is cheque
      if (form.payment_method === 'cheque') {
        receiptPayload.cheque_data = {
          number: chequeForm.number,
          bank: chequeForm.bank,
          cheque_type: chequeForm.cheque_type,
          drawer: chequeForm.drawer,
          drawer_cuit: chequeForm.drawer_cuit || null,
          issue_date: chequeForm.issue_date,
          due_date: chequeForm.due_date,
        }
      }

      await api.createReceipt(receiptPayload)
      setShowForm(false)
      setInvoiceItems({})
      setOrderItems({})
      setShowInvoiceSection(false)
      setChequeForm({ ...INITIAL_CHEQUE_FORM })
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
    { key: 'receipt_number', label: 'N° Recibo' },
    { key: 'receipt_date', label: 'Fecha', type: 'date' as const },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'total_amount', label: 'Monto', type: 'currency' as const },
    { key: 'payment_method', label: 'Metodo de Pago' },
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cobros</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Pagos recibidos de empresas</p>
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
        <Card className="border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700 dark:text-green-400">Total Cobrado</p>
            <p className="text-xl font-bold text-green-800 dark:text-green-300">{fmt(totalCobrado)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700 dark:text-blue-400">Registros</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{filteredReceipts.length}</p>
          </CardContent>
        </Card>
        <Card className="border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-purple-700 dark:text-purple-400">Empresas</p>
            <p className="text-xl font-bold text-purple-800 dark:text-purple-300">{new Set(filteredReceipts.map(r => r.enterprise_id || r.items?.[0]?.enterprise_name).filter(Boolean)).size}</p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-orange-700 dark:text-orange-400">Pendiente de Cobro</p>
            <p className="text-xl font-bold text-orange-800 dark:text-orange-300">{fmt(totalPendingCobros)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pedidos por Cobrar Section */}
      {!loading && pendingOrders.length > 0 && (
        <Card className="border border-orange-300 dark:border-orange-800 bg-gradient-to-r from-orange-50 to-yellow-50 dark:from-orange-950/30 dark:to-yellow-950/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-200">
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
                    className="bg-white dark:bg-gray-800 border border-orange-200 dark:border-orange-800 rounded-lg px-4 py-3 flex items-center justify-between gap-4 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="font-mono font-bold text-orange-700 text-sm whitespace-nowrap">
                        #{String(order.order_number).padStart(4, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
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

      {/* Aging Report Section */}
      {!loading && aging && (aging.summary.total_overdue > 0 || aging.details.length > 0) && (
        <Card className="border border-gray-200 dark:border-gray-700 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Antiguedad de Saldos
                </h3>
                {aging.avg_dso > 0 && (
                  <span className="text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded-full">
                    DSO: {aging.avg_dso}d
                  </span>
                )}
              </div>
              <button
                onClick={() => setAgingCollapsed(!agingCollapsed)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm font-medium transition-colors flex items-center gap-1"
              >
                {agingCollapsed ? 'Expandir' : 'Colapsar'}
                <span className="text-xs">{agingCollapsed ? '\u25BC' : '\u25B2'}</span>
              </button>
            </div>
          </CardHeader>
          {!agingCollapsed && (
            <CardContent className="pt-0 space-y-4">
              {/* Bucket summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {([
                  { key: 'current', value: aging.summary.current },
                  { key: '1-30', value: aging.summary.bucket_1_30 },
                  { key: '31-60', value: aging.summary.bucket_31_60 },
                  { key: '61-90', value: aging.summary.bucket_61_90 },
                  { key: '90+', value: aging.summary.bucket_90_plus },
                ] as const).map(({ key, value }) => {
                  const colors = BUCKET_COLORS[key]
                  const count = aging.details.filter(d => d.bucket === key).length
                  return (
                    <div key={key} className={`rounded-lg border border-gray-200 dark:border-gray-700 border-t-4 ${colors.border} ${colors.bg} px-3 py-2`}>
                      <p className={`text-xs font-medium ${colors.text}`}>{BUCKET_LABELS[key]}</p>
                      <p className={`text-lg font-bold ${colors.text}`}>{fmt(value)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{count} doc{count !== 1 ? 's' : ''}</p>
                    </div>
                  )
                })}
              </div>

              {/* Stacked bar */}
              {aging.summary.total_overdue > 0 && (
                <div>
                  <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                    {(() => {
                      const s = aging.summary
                      const total = s.current + s.bucket_1_30 + s.bucket_31_60 + s.bucket_61_90 + s.bucket_90_plus
                      if (total === 0) return null
                      const segments = [
                        { value: s.current, color: 'bg-[#22C55E]' },
                        { value: s.bucket_1_30, color: 'bg-[#EAB308]' },
                        { value: s.bucket_31_60, color: 'bg-[#F97316]' },
                        { value: s.bucket_61_90, color: 'bg-[#EF4444]' },
                        { value: s.bucket_90_plus, color: 'bg-[#991B1B]' },
                      ]
                      return segments.map((seg, i) => {
                        const pct = (seg.value / total) * 100
                        if (pct < 0.5) return null
                        return <div key={i} className={`${seg.color}`} style={{ width: `${pct}%` }} />
                      })
                    })()}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Total vencido: <span className="font-bold text-red-600 dark:text-red-400">{fmt(aging.summary.total_overdue)}</span>
                  </p>
                </div>
              )}

              {/* Worst clients */}
              {aging.worst_clients.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Principales deudores</p>
                  <div className="flex flex-wrap gap-2">
                    {aging.worst_clients.map((client, i) => {
                      const behavior = getPaymentBehavior(client.oldest_days)
                      return (
                        <div key={i} className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{client.enterprise_name}</span>
                          <span className="text-sm font-bold text-red-600 dark:text-red-400">{fmt(client.total_overdue)}</span>
                          <span className="text-xs text-gray-400">({client.oldest_days}d)</span>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${behavior.className}`}>{behavior.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Detail table */}
              {aging.details.filter(d => d.days_overdue > 0).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2">Empresa</th>
                        <th className="px-3 py-2">Tipo</th>
                        <th className="px-3 py-2">N Doc</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Pagado</th>
                        <th className="px-3 py-2 text-right">Restante</th>
                        <th className="px-3 py-2 text-center">Dias</th>
                        <th className="px-3 py-2 text-center">Bucket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aging.details.filter(d => d.days_overdue > 0).map((item, idx) => {
                        const colors = BUCKET_COLORS[item.bucket]
                        return (
                          <tr key={idx} className={`border-t border-gray-100 dark:border-gray-700 ${getRowBgClass(item.bucket)}`}>
                            <td className="px-3 py-2 text-gray-900 dark:text-gray-100 font-medium">{item.enterprise_name}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                item.document_type === 'invoice'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                  : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                              }`}>
                                {item.document_type === 'invoice' ? 'Factura' : 'Sin facturar'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                              {item.document_type === 'invoice'
                                ? String(item.document_number).padStart(8, '0')
                                : `#${String(item.document_number).padStart(4, '0')}`
                              }
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(item.total_amount)}</td>
                            <td className="px-3 py-2 text-right text-green-600 dark:text-green-400">{fmt(item.paid_amount)}</td>
                            <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-gray-100">{fmt(item.remaining)}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`font-bold ${
                                item.days_overdue > 90 ? 'text-red-900 dark:text-red-300' :
                                item.days_overdue > 60 ? 'text-red-600 dark:text-red-400' :
                                item.days_overdue > 30 ? 'text-orange-600 dark:text-orange-400' :
                                'text-yellow-600 dark:text-yellow-400'
                              }`}>
                                {item.days_overdue}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                                <span className="text-xs text-gray-500 dark:text-gray-400">{BUCKET_LABELS[item.bucket]}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Zero overdue */}
              {aging.summary.total_overdue === 0 && aging.details.length > 0 && (
                <div className="text-center py-4">
                  <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2">
                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-semibold text-green-800 dark:text-green-200">Todo al dia - Sin facturas vencidas</span>
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg animate-fadeIn">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <Card id="registrar-cobro-form" className="animate-fadeIn" style={{ scrollMarginTop: '20px' }}>
          <CardHeader><h3 className="text-lg font-semibold">Registrar Cobro</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Empresa</label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                  </select>
                </div>
                <Input label="Monto *" type="number" step="0.01" min="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
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
                    label="Banco"
                  />
                )}
                <Input label="Referencia" placeholder="N transferencia, cheque, etc." value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
                <DateInput label="Fecha" value={form.receipt_date} onChange={val => setForm({ ...form, receipt_date: val })} />
              </div>

              {/* Cheque inline form */}
              {form.payment_method === 'cheque' && (
                <div className="border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">Datos del Cheque</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Input label="Numero de cheque *" placeholder="Ej: 12345678" value={chequeForm.number} onChange={e => setChequeForm({ ...chequeForm, number: e.target.value })} required />
                    <Input label="Banco *" placeholder="Ej: Banco Nacion" value={chequeForm.bank} onChange={e => setChequeForm({ ...chequeForm, bank: e.target.value })} required />
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de cheque *</label>
                      <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" value={chequeForm.cheque_type} onChange={e => setChequeForm({ ...chequeForm, cheque_type: e.target.value })}>
                        {CHEQUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <Input label="Librador *" placeholder="Nombre del emisor" value={chequeForm.drawer} onChange={e => setChequeForm({ ...chequeForm, drawer: e.target.value })} required />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input label="CUIT del librador" placeholder="20-12345678-9" value={chequeForm.drawer_cuit} onChange={e => setChequeForm({ ...chequeForm, drawer_cuit: e.target.value })} />
                    <DateInput label="Fecha de emision *" value={chequeForm.issue_date} onChange={val => setChequeForm({ ...chequeForm, issue_date: val })} required />
                    <DateInput label="Fecha de cobro *" value={chequeForm.due_date} onChange={val => setChequeForm({ ...chequeForm, due_date: val })} required />
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y" rows={2} placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              {/* Optional invoice linking */}
              <div className="border-t border-gray-200 pt-3">
                <button
                  type="button"
                  onClick={handleToggleInvoices}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
                >
                  {showInvoiceSection ? 'Ocultar facturas/pedidos' : 'Vincular a facturas o pedidos (opcional)'}<HelpTip text="Opcional. Vincular el cobro a facturas o pedidos especificos permite llevar control parcial de pagos." />
                </button>
              </div>

              {showInvoiceSection && (
                <div>
                  {/* Tabs: Facturas / Pedidos */}
                  <div className="flex gap-1 mb-3 border-b border-gray-200 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={() => setLinkTab('invoices')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${linkTab === 'invoices' ? 'border-blue-500 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                      Facturas ({invoicesForReceipt.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setLinkTab('orders')}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${linkTab === 'orders' ? 'border-blue-500 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                      Pedidos sin factura ({ordersForReceipt.length})
                    </button>
                  </div>

                  {/* Invoices tab */}
                  {linkTab === 'invoices' && (
                    <div>
                      {invoicesForReceipt.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No hay facturas pendientes de cobro</p>
                      ) : (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
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
                                  <tr key={inv.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <td className="px-3 py-2 font-mono text-xs font-semibold">{invLabel}</td>
                                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{inv.enterprise?.name || inv.customer?.name || 'Consumidor Final'}</td>
                                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(total)}</td>
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
                                          className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-right text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
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
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                          Total facturas seleccionadas: <span className="font-bold text-green-700">{fmt(invoiceTotal)}</span>
                          <span className="text-xs text-gray-400 ml-2">(el monto del recibo se calculara automaticamente)</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Orders tab */}
                  {linkTab === 'orders' && (
                    <div>
                      {ordersForReceipt.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No hay pedidos sin factura pendientes de cobro</p>
                      ) : (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
                                <th className="px-3 py-2 text-left">Pedido</th>
                                <th className="px-3 py-2 text-left">Empresa</th>
                                <th className="px-3 py-2 text-right">Total</th>
                                <th className="px-3 py-2 text-right">Cobrado</th>
                                <th className="px-3 py-2 text-right">Restante</th>
                                <th className="px-3 py-2 text-right w-36">Monto a pagar</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ordersForReceipt.map(order => (
                                <tr key={order.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                  <td className="px-3 py-2 font-mono text-xs font-semibold">#{String(order.order_number).padStart(4, '0')}</td>
                                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{order.enterprise_name}</td>
                                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(order.total_amount)}</td>
                                  <td className="px-3 py-2 text-right text-green-600">{fmt(order.paid)}</td>
                                  <td className="px-3 py-2 text-right font-medium">{fmt(order.remaining)}</td>
                                  <td className="px-3 py-2 text-right">
                                    {order.remaining > 0 ? (
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max={order.remaining}
                                        placeholder="0.00"
                                        value={orderItems[order.id] || ''}
                                        onChange={e => {
                                          const val = e.target.value
                                          setOrderItems(prev => {
                                            const next = { ...prev }
                                            if (val && parseFloat(val) > 0) next[order.id] = val
                                            else delete next[order.id]
                                            return next
                                          })
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-right text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                                      />
                                    ) : (
                                      <span className="text-xs text-green-600 font-medium">Completo</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {orderTotal > 0 && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                          Total pedidos seleccionados: <span className="font-bold text-green-700">{fmt(orderTotal)}</span>
                          <span className="text-xs text-gray-400 ml-2">(el monto del recibo se calculara automaticamente)</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Combined total */}
                  {linkedTotal > 0 && (invoiceTotal > 0 && orderTotal > 0) && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      Total combinado: <span className="font-bold text-green-700">{fmt(linkedTotal)}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <div className="text-sm text-gray-600">
                  Total: <span className="font-bold text-lg text-green-700 ml-2">
                    {fmt(linkedTotal > 0 ? linkedTotal : parseFloat(form.amount || '0'))}
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
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
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
                  <tr key={receipt.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-gray-800 dark:text-gray-200">
                      #{String(receipt.receipt_number).padStart(6, '0')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{fmtDate(receipt.receipt_date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{getReceiptEnterpriseName(receipt)}</td>
                    <td className="px-4 py-3 text-right"><span className="font-bold text-green-700 dark:text-green-400">{fmt(receipt.total_amount)}</span></td>
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
