import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DateInput } from '@/components/ui/DateInput'
import { BankSelector } from '@/components/ui/BankSelector'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toLocalYMD } from '@/utils/dates'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { PagoInvoiceLinker } from '@/components/pagos/PagoInvoiceLinker'
import { CurrencySelector } from '@/components/shared/CurrencySelector'

// ---------- Types ----------

interface Pago {
  id: string
  enterprise_name: string | null
  enterprise_cuit?: string
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
  retenciones?: Array<{
    id: string
    type: string
    rate: string
    amount: string
    regime: string | null
    jurisdiction?: string | null
    certificate_number?: string | null
    purchase_invoice_id?: string | null
  }>
  notes: string | null
  status?: string
  anulled_at?: string | null
  anulled_by?: string | null
  anulled_reason?: string | null
  payment_methods?: Array<{
    method: string
    amount: string
    bank_id: string | null
    bank_name?: string | null
    reference: string | null
    cheque_data?: {
      number: string
      bank: string
      drawer: string
      drawer_cuit?: string | null
      due_date: string
      issue_date?: string
    } | null
  }>
  linked_purchase_invoices?: Array<{
    id: string
    purchase_invoice_id: string
    amount: string
    invoice_number: number
    invoice_type: string | null
    invoice_total: string
  }>
  total_assigned?: string | number
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

// ---------- Constants ----------

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque_emitido: 'Cheque emitido',
  cheque: 'Cheque',
  otro: 'Otro',
  mixto: 'Mixto',
  mercado_pago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
}

const RETENCION_LABELS: Record<string, string> = {
  iibb: 'IIBB',
  ganancias: 'Ganancias',
  iva: 'IVA',
  suss: 'SUSS',
}

interface PaymentMethodRow {
  method: string
  amount: string
  bank_id: string
  reference: string
  cheque_id?: string // existing emitted cheque to reuse (optional)
  cheque_data: {
    number: string
    bank: string
    drawer: string
    drawer_cuit: string
    cheque_type: string
    issue_date: string
    due_date: string
  } | null
}

const INITIAL_PAYMENT_METHOD: PaymentMethodRow = {
  method: 'transferencia', amount: '', bank_id: '', reference: '', cheque_data: null,
}

interface RetencionRow {
  type: string
  enabled: boolean
  base_amount: number
  rate: number
  amount: number
  regime: string
  jurisdiction?: string
  certificate_number?: string
  purchase_invoice_id?: string
}

const INITIAL_RETENCIONES: RetencionRow[] = [
  { type: 'iibb', enabled: false, base_amount: 0, rate: 3.0, amount: 0, regime: '', jurisdiction: '' },
  { type: 'ganancias', enabled: false, base_amount: 0, rate: 2.0, amount: 0, regime: '' },
  { type: 'iva', enabled: false, base_amount: 0, rate: 0, amount: 0, regime: '' },
  { type: 'suss', enabled: false, base_amount: 0, rate: 0, amount: 0, regime: '' },
]

const DISMISSED_PENDING_KEY = 'gestia_dismissed_pending_pagos'

function getDismissedPending(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_PENDING_KEY) || '[]') } catch { return [] }
}
function dismissPending(purchaseId: string) {
  const dismissed = getDismissedPending()
  if (!dismissed.includes(purchaseId)) {
    localStorage.setItem(DISMISSED_PENDING_KEY, JSON.stringify([...dismissed, purchaseId]))
  }
}
function restorePending() { localStorage.removeItem(DISMISSED_PENDING_KEY) }

// ---------- Component ----------

export const Pagos: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const expandConsumedRef = useRef(false)

  // Data
  const [pagos, setPagos] = useState<Pago[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [chequesEmitidosDisponibles, setChequesEmitidosDisponibles] = useState<ChequeDisponible[]>([])
  const [purchaseInvoices, setPurchaseInvoices] = useState<any[]>([])
  const [piAmounts, setPiAmounts] = useState<Record<string, string>>({})

  // UI state
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPagoId, setExpandedPagoId] = useState<string | null>(null)
  const [pendingCollapsed, setPendingCollapsed] = useState(true)
  const [dismissedPending, setDismissedPending] = useState<string[]>(getDismissedPending())

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterStatus, setFilterStatus] = useState('') // '', 'completo', 'parcial', 'anulado'
  const [periodValue, setPeriodValue] = useState('mes')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Linking modal
  const [linkingPago, setLinkingPago] = useState<{ id: string; amount: number; enterprise_id?: string } | null>(null)

  // Anular modal
  const [anularTarget, setAnularTarget] = useState<Pago | null>(null)
  const [anularReason, setAnularReason] = useState('')
  const [anulando, setAnulando] = useState(false)

  // Form
  const [form, setForm] = useState({
    enterprise_id: '',
    purchase_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: '',
  })
  const [formCurrency, setFormCurrency] = useState('ARS')
  const [formExchangeRate, setFormExchangeRate] = useState<number | null>(null)

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([{ ...INITIAL_PAYMENT_METHOD }])
  const [retenciones, setRetenciones] = useState<RetencionRow[]>(INITIAL_RETENCIONES)

  // ---------- Period preset ----------
  // Initialize period to "mes" (current month)
  useEffect(() => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    setDateFrom(toLocalYMD(startOfMonth))
    setDateTo(toLocalYMD(now))
  }, [])

  // ---------- Multi-method handlers ----------

  const addPaymentMethod = () => setPaymentMethods(prev => [...prev, {
    method: 'efectivo', amount: '', bank_id: '', reference: '', cheque_data: null,
  }])
  const removePaymentMethod = (index: number) => setPaymentMethods(prev => prev.filter((_, i) => i !== index))
  const updatePaymentMethod = (index: number, field: string, value: string) => {
    setPaymentMethods(prev => prev.map((pm, i) => {
      if (i !== index) return pm
      if (field === 'method' && value === 'cheque_emitido' && !pm.cheque_data) {
        return { ...pm, [field]: value, cheque_data: { number: '', bank: '', drawer: '', drawer_cuit: '', cheque_type: 'propio', issue_date: new Date().toISOString().split('T')[0], due_date: '' }, cheque_id: '' }
      }
      if (field === 'method' && value !== 'cheque_emitido') {
        return { ...pm, [field]: value, cheque_data: null, cheque_id: undefined }
      }
      return { ...pm, [field]: value }
    }))
  }
  const updateChequeData = (index: number, field: string, value: string) => {
    setPaymentMethods(prev => prev.map((pm, i) => i !== index || !pm.cheque_data ? pm : { ...pm, cheque_data: { ...pm.cheque_data, [field]: value } }))
  }
  const selectExistingCheque = (index: number, chequeId: string) => {
    const ch = chequesEmitidosDisponibles.find(c => c.id === chequeId)
    if (!ch) {
      setPaymentMethods(prev => prev.map((pm, i) => i === index ? { ...pm, cheque_id: '' } : pm))
      return
    }
    setPaymentMethods(prev => prev.map((pm, i) => {
      if (i !== index) return pm
      return {
        ...pm,
        cheque_id: chequeId,
        amount: pm.amount || ch.amount,
        cheque_data: {
          number: ch.number,
          bank: ch.bank,
          drawer: ch.drawer,
          drawer_cuit: '',
          cheque_type: 'propio',
          issue_date: new Date().toISOString().split('T')[0],
          due_date: ch.due_date,
        },
      }
    }))
  }

  const paymentMethodsTotal = useMemo(
    () => paymentMethods.reduce((s, pm) => s + (parseFloat(pm.amount) || 0), 0),
    [paymentMethods]
  )

  // ---------- Retenciones handlers ----------

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
  const setRetencionField = (idx: number, field: string, value: string) => {
    setRetenciones(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: value }))
  }

  const totalRetenciones = useMemo(
    () => retenciones.filter(r => r.enabled).reduce((s, r) => s + r.amount, 0),
    [retenciones]
  )

  // ---------- Loaders ----------

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
        // Cheques EMITIDOS available (en cartera, propios, no aplicados todavia).
        // Reusing endorsement endpoint as fallback if a dedicated one does not exist yet.
        api.getChequesForEndorsement().catch(() => []),
      ])
      setPagos(pagosRes || [])
      setEnterprises(entRes || [])
      setPurchases(purchRes || [])
      setBanks(bankRes || [])
      // Filter cheques to only outgoing (emitido, available). Best-effort: backend may not yet
      // tag direction, in which case we just show whatever the endpoint returned.
      const emitidos = (chequesRes || []).filter((c: any) =>
        !c.direction || c.direction === 'emitido' || c.direction === 'recibido'
      )
      setChequesEmitidosDisponibles(emitidos)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterMethod, filterStatus, dateFrom, dateTo, pageSize])

  // Deep-link ?expand=<pagoId> from Global Search / other pages.
  useEffect(() => {
    if (expandConsumedRef.current) return
    if (loading) return
    const expandId = searchParams.get('expand')
    if (!expandId) return
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_REGEX.test(expandId)) return
    if (!pagos.some(p => p.id === expandId)) return
    setExpandedPagoId(expandId)
    expandConsumedRef.current = true
    setSearchParams(prev => { const np = new URLSearchParams(prev); np.delete('expand'); return np }, { replace: true })
    setTimeout(() => {
      const el = document.getElementById(`pago-row-${expandId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
  }, [loading, pagos, searchParams, setSearchParams])

  // Load purchase invoices for selected enterprise (for linking)
  useEffect(() => {
    if (form.enterprise_id) {
      api.getAvailablePurchaseInvoicesForLinking({ enterprise_id: form.enterprise_id })
        .then((data: any[]) => setPurchaseInvoices(data || []))
        .catch(() => setPurchaseInvoices([]))
    } else {
      setPurchaseInvoices([])
    }
    setPiAmounts({})
  }, [form.enterprise_id])

  // Pre-fill retenciones from padron when enterprise changes
  useEffect(() => {
    if (!form.enterprise_id) {
      setRetenciones(INITIAL_RETENCIONES)
      return
    }
    let cancelled = false
    api.calculateRetenciones(form.enterprise_id, paymentMethodsTotal || 0)
      .then((data: any) => {
        if (cancelled) return
        if (data && Array.isArray(data) && data.length > 0) {
          setRetenciones(prev => prev.map(r => {
            const match = data.find((d: any) => d.type === r.type)
            if (match) {
              return {
                ...r,
                enabled: true,
                rate: match.rate || r.rate,
                base_amount: match.base_amount || paymentMethodsTotal || 0,
                amount: match.amount || 0,
                regime: match.regime || '',
              }
            }
            return r
          }))
        }
      })
      .catch(() => { /* no padron data */ })
    return () => { cancelled = true }
  }, [form.enterprise_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill retenciones from purchase invoice retenciones_previstas
  useEffect(() => {
    const linkedPiIds = Object.entries(piAmounts)
      .filter(([, amt]) => parseFloat(amt) > 0)
      .map(([id]) => id)
    if (linkedPiIds.length === 0) return

    const retMap = new Map<string, { rate: number; count: number }>()
    for (const piId of linkedPiIds) {
      const pi = purchaseInvoices.find((p: any) => p.id === piId)
      const previstas = pi?.retenciones_previstas
      if (Array.isArray(previstas)) {
        for (const rp of previstas) {
          const existing = retMap.get(rp.type)
          if (existing) {
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
          // If only one PI is linked, default purchase_invoice_id automatically
          const defaultPi = linkedPiIds.length === 1 ? linkedPiIds[0] : r.purchase_invoice_id
          return { ...r, enabled: true, rate: match.rate, base_amount: baseAmount, amount, purchase_invoice_id: defaultPi }
        }
        return r
      }))
    }
  }, [piAmounts, purchaseInvoices])

  // ---------- Pendientes de Pago ----------

  const paidByPurchase = useMemo(() => {
    const map = new Map<string, number>()
    for (const pago of pagos) {
      if (pago.status === 'anulado') continue
      if (pago.purchase_id) {
        const current = map.get(pago.purchase_id) || 0
        map.set(pago.purchase_id, current + Number(pago.amount || 0))
      }
    }
    return map
  }, [pagos])

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
      payment_date: new Date().toISOString().split('T')[0],
      notes: `Pago compra #${String(purchase.purchase_number).padStart(4, '0')}`,
    })
    setPaymentMethods([{ ...INITIAL_PAYMENT_METHOD, amount: purchase.remaining.toFixed(2) }])
    setRetenciones(INITIAL_RETENCIONES)
    setShowForm(true)
  }, [])

  // ---------- Submit ----------

  const handleOpenForm = () => {
    setShowForm(true)
    setForm({
      enterprise_id: '',
      purchase_id: '',
      payment_date: new Date().toISOString().split('T')[0],
      notes: '',
    })
    setPaymentMethods([{ ...INITIAL_PAYMENT_METHOD }])
    setRetenciones(INITIAL_RETENCIONES)
    setPiAmounts({})
    setFormCurrency('ARS')
    setFormExchangeRate(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validations
    const pmTotal = paymentMethods.reduce((s, pm) => s + (parseFloat(pm.amount) || 0), 0)
    if (pmTotal <= 0) {
      toast.error('Ingresa al menos un metodo de pago con monto > 0')
      return
    }

    // PI applications
    const purchaseInvoiceItems = Object.entries(piAmounts)
      .filter(([, amount]) => parseFloat(amount) > 0)
      .map(([purchase_invoice_id, amount]) => ({ purchase_invoice_id, amount: parseFloat(amount) }))
    const piTotal = purchaseInvoiceItems.reduce((s, i) => s + i.amount, 0)

    // Retenciones enabled
    const enabledRetenciones = retenciones
      .filter(r => r.enabled && r.amount > 0)
      .map(r => ({
        type: r.type,
        base_amount: r.base_amount,
        rate: r.rate,
        amount: r.amount,
        regime: r.regime || null,
        jurisdiction: r.type === 'iibb' ? (r.jurisdiction || null) : (r.jurisdiction || undefined),
        certificate_number: r.certificate_number || null,
        purchase_invoice_id: r.purchase_invoice_id || null,
      }))
    const retTotal = enabledRetenciones.reduce((s, r) => s + r.amount, 0)

    // sum(payment_methods) + retenciones = sum(applied to invoices) when there ARE PI items
    // Bruto = pmTotal + retTotal (lo que cancela factura). Neto pagado = pmTotal.
    const bruto = pmTotal + retTotal

    if (purchaseInvoiceItems.length > 0) {
      if (Math.abs(piTotal - bruto) > 0.01) {
        toast.error(
          `La suma asignada a facturas ($${piTotal.toFixed(2)}) no coincide con bruto ($${bruto.toFixed(2)} = $${pmTotal.toFixed(2)} pagos + $${retTotal.toFixed(2)} retenciones)`
        )
        return
      }
    }

    // Multi-PI requires explicit purchase_invoice_id per retencion
    if (purchaseInvoiceItems.length > 1) {
      for (const ret of enabledRetenciones) {
        if (!ret.purchase_invoice_id) {
          toast.error(`Con multiples facturas, la retencion ${ret.type.toUpperCase()} debe especificar a que factura se imputa`)
          return
        }
      }
    }

    // Validate cheque fields per row
    for (const pm of paymentMethods) {
      if (pm.method === 'cheque_emitido' && pm.cheque_data) {
        const cd = pm.cheque_data
        if (!cd.number || !cd.bank || !cd.drawer || !cd.issue_date || !cd.due_date) {
          toast.error('Completa todos los campos del cheque emitido (numero, banco, librador, fechas)')
          return
        }
      }
      if (pm.method === 'transferencia' && !pm.bank_id) {
        toast.error('Transferencia requiere seleccionar banco')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const paymentMethodsPayload = paymentMethods
        .filter(pm => parseFloat(pm.amount) > 0)
        .map(pm => ({
          method: pm.method,
          amount: parseFloat(pm.amount),
          bank_id: pm.bank_id || undefined,
          reference: pm.reference || undefined,
          cheque_data: pm.method === 'cheque_emitido' ? pm.cheque_data || undefined : undefined,
        }))

      const summaryMethod = paymentMethodsPayload.length === 1 ? paymentMethodsPayload[0].method : 'mixto'

      await api.createPago({
        enterprise_id: form.enterprise_id || null,
        purchase_id: form.purchase_id || null,
        amount: pmTotal,
        payment_method: summaryMethod,
        bank_id: paymentMethodsPayload[0]?.bank_id || null,
        reference: paymentMethodsPayload[0]?.reference || null,
        payment_methods: paymentMethodsPayload,
        payment_date: form.payment_date,
        notes: form.notes || null,
        purchase_invoice_items: purchaseInvoiceItems.length > 0 ? purchaseInvoiceItems : undefined,
        currency: formCurrency,
        exchange_rate: formCurrency !== 'ARS' ? formExchangeRate : undefined,
        retenciones: enabledRetenciones.length > 0 ? enabledRetenciones : undefined,
      })

      toast.success('Orden de pago registrada correctamente')
      setShowForm(false)
      setPaymentMethods([{ ...INITIAL_PAYMENT_METHOD }])
      setRetenciones(INITIAL_RETENCIONES)
      setPiAmounts({})
      setFormCurrency('ARS')
      setFormExchangeRate(null)
      setForm({ enterprise_id: '', purchase_id: '', payment_date: new Date().toISOString().split('T')[0], notes: '' })
      await loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  // ---------- Anular ----------

  const handleAnular = async () => {
    if (!anularTarget) return
    const reason = anularReason.trim()
    if (reason.length < 5) {
      toast.error('El motivo es obligatorio (minimo 5 caracteres)')
      return
    }
    setAnulando(true)
    try {
      await api.deletePago(anularTarget.id, reason)
      toast.success('Pago anulado')
      setAnularTarget(null)
      setAnularReason('')
      await loadData()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message)
    } finally {
      setAnulando(false)
    }
  }

  // ---------- Derived ----------

  const fmt = (n: any) => formatCurrency(n)
  const fmtDate = (d: string) => formatDate(d)

  const filteredPagos = useMemo(() => {
    let result = pagos
    if (filterMethod) {
      if (filterMethod === 'cheque') {
        result = result.filter(p => p.payment_method === 'cheque' || p.payment_method === 'cheque_emitido')
      } else if (filterMethod === 'mixto') {
        result = result.filter(p => p.payment_method === 'mixto')
      } else {
        result = result.filter(p => p.payment_method === filterMethod)
      }
    }
    if (filterStatus) {
      result = result.filter(p => {
        if (filterStatus === 'anulado') return p.status === 'anulado'
        if (p.status === 'anulado') return false
        const totalAmt = parseFloat(p.amount || '0')
        const assigned = parseFloat(String(p.total_assigned || '0'))
        const isFullyAssigned = assigned >= totalAmt - 0.01 && totalAmt > 0
        if (filterStatus === 'completo') return isFullyAssigned
        if (filterStatus === 'parcial') return assigned > 0 && !isFullyAssigned
        return true
      })
    }
    if (dateFrom) result = result.filter(p => toLocalYMD(p.payment_date) >= dateFrom)
    if (dateTo) result = result.filter(p => toLocalYMD(p.payment_date) <= dateTo)
    return result
  }, [pagos, filterMethod, filterStatus, dateFrom, dateTo])

  // KPIs (mes en curso) — independientes del filtro de fechas, miden el mes actual
  const kpis = useMemo(() => {
    const now = new Date()
    const monthStart = toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1))
    const today = toLocalYMD(now)
    const ofMonth = pagos.filter(p => {
      const ymd = toLocalYMD(p.payment_date)
      return ymd >= monthStart && ymd <= today
    })
    const activos = ofMonth.filter(p => p.status !== 'anulado')
    const totalPagadoMes = activos.reduce((s, p) => s + Number(p.amount || 0), 0)
    const cantPagosMes = activos.length
    const retencionesMes = activos.reduce((s, p) =>
      s + (p.retenciones || []).reduce((rs, r) => rs + Number(r.amount || 0), 0), 0)
    const anuladosMes = ofMonth.filter(p => p.status === 'anulado').length
    return { totalPagadoMes, cantPagosMes, retencionesMes, anuladosMes }
  }, [pagos])

  const totalPages = Math.ceil(filteredPagos.length / pageSize)
  const paginatedPagos = filteredPagos.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const isFiltered = !!filterEnterprise || !!filterMethod || !!filterStatus || !!dateFrom || !!dateTo

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
    setFilterEnterprise(''); setFilterMethod(''); setFilterStatus('')
    setDateFrom(''); setDateTo(''); setPeriodValue('todos')
  }

  const handlePeriodChange = (p: { value: string; dateFrom: string; dateTo: string }) => {
    setPeriodValue(p.value)
    setDateFrom(p.dateFrom)
    setDateTo(p.dateTo)
  }

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Ordenes de Pago</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Ordenes de pago a proveedores</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={filteredPagos} columns={csvColumns} filename="pagos" />
          <ExportExcelButton data={filteredPagos} columns={csvColumns} filename="pagos" />
          <PermissionGate module="pagos" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => showForm ? setShowForm(false) : handleOpenForm()}>
              {showForm ? 'Cancelar' : '+ Nueva Orden de Pago'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* KPIs - mes en curso */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-red-700 dark:text-red-400">Total Pagado (mes)</p>
            <p className="text-xl font-bold text-red-800 dark:text-red-300">{fmt(kpis.totalPagadoMes)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700 dark:text-blue-400">Cant. Pagos (mes)</p>
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{kpis.cantPagosMes}</p>
          </CardContent>
        </Card>
        <Card className="border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">Retenciones Practicadas (mes)</p>
            <p className="text-xl font-bold text-amber-800 dark:text-amber-300">{fmt(kpis.retencionesMes)}</p>
          </CardContent>
        </Card>
        <Card className="border border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-gray-700 dark:text-gray-400">Anulados (mes)</p>
            <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{kpis.anuladosMes}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg animate-fadeIn">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Pendientes de Pago */}
      {!loading && pendingPurchases.length > 0 && (
        <Card className="border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-200">Pendientes de Pago</h3>
                <span className="text-xs font-medium bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">{pendingPurchases.length}</span>
                <span className="text-xs text-yellow-700">Total: {fmt(totalPendingAmount)}</span>
              </div>
              <button
                onClick={() => setPendingCollapsed(!pendingCollapsed)}
                className="text-yellow-700 hover:text-yellow-900 text-sm font-medium transition-colors flex items-center gap-1"
              >
                {pendingCollapsed ? 'Expandir' : 'Colapsar'}
                <span className="text-xs">{pendingCollapsed ? '\u25BC' : '\u25B2'}</span>
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
                          {purchase.paid > 0 && <span className="text-green-600">Pagado: {fmt(purchase.paid)}</span>}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="text-sm font-bold text-red-700">{fmt(purchase.remaining)}</p>
                        <p className="text-xs text-gray-400">restante</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PermissionGate module="pagos" action="create">
                        <Button variant="success" size="sm" onClick={() => handlePayFromPurchase(purchase)}>Pagar</Button>
                      </PermissionGate>
                      <button
                        onClick={() => handleDismissPending(purchase.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        title="Ocultar temporalmente"
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>
              {hasDismissedPending && (
                <button onClick={handleRestorePending} className="text-xs text-gray-400 hover:text-yellow-600 transition-colors mt-3">
                  Mostrar ocultos ({dismissedPending.length})
                </button>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <h3 className="text-lg font-semibold">Registrar Orden de Pago</h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Cabecera: empresa + fecha + currency */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Proveedor</label>
                  <select
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                    value={form.enterprise_id}
                    onChange={e => {
                      if (e.target.value === '__new__') { navigate('/empresas?new=1'); return }
                      setForm({ ...form, enterprise_id: e.target.value, purchase_id: '' })
                    }}
                  >
                    <option value="">Seleccionar...</option>
                    {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                    <option value="__new__">+ Nuevo Proveedor</option>
                  </select>
                </div>
                <DateInput label="Fecha" value={form.payment_date} onChange={val => setForm({ ...form, payment_date: val })} />
                <CurrencySelector
                  currency={formCurrency}
                  exchangeRate={formExchangeRate}
                  onCurrencyChange={setFormCurrency}
                  onExchangeRateChange={setFormExchangeRate}
                  foreignAmount={paymentMethodsTotal}
                  compact
                />
              </div>

              {/* Facturas de Compra */}
              {form.enterprise_id && (
                <div className="border border-purple-200 dark:border-purple-800 rounded-lg p-4 bg-purple-50/50 dark:bg-purple-950/20">
                  <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-300 mb-3">
                    Vincular a facturas de compra
                    {Object.values(piAmounts).some(v => parseFloat(v) > 0) && (
                      <span className="ml-2 text-xs font-normal text-purple-600">
                        Asignado: {fmt(Object.values(piAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0))}
                      </span>
                    )}
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
                                      type="number" min="0" max={remaining} step="0.01" placeholder="0.00"
                                      value={piAmounts[pi.id] || ''}
                                      onChange={e => setPiAmounts({ ...piAmounts, [pi.id]: e.target.value })}
                                      className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-right text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-1 focus:ring-purple-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setPiAmounts({ ...piAmounts, [pi.id]: remaining.toFixed(2) })}
                                      className="text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
                                    >Todo</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Este proveedor no tiene facturas de compra pendientes</p>
                  )}
                </div>
              )}

              {/* Formas de Pago multi */}
              <div className="space-y-2">
                <label className="block text-sm font-medium">Formas de Pago</label>
                {paymentMethods.map((pm, i) => (
                  <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <label className="text-xs text-gray-500">Metodo</label>
                        <select
                          className="w-full rounded border p-2 text-sm dark:bg-gray-800"
                          value={pm.method}
                          onChange={e => updatePaymentMethod(i, 'method', e.target.value)}
                        >
                          <option value="transferencia">Transferencia</option>
                          <option value="efectivo">Efectivo</option>
                          <option value="cheque_emitido">Cheque emitido</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-500">Monto *</label>
                        <input
                          type="number" step="0.01" min="0"
                          className="w-full rounded border p-2 text-sm dark:bg-gray-800"
                          placeholder="0.00"
                          value={pm.amount}
                          onChange={e => updatePaymentMethod(i, 'amount', e.target.value)}
                        />
                      </div>
                      {pm.method === 'transferencia' && (
                        <div className="col-span-3">
                          <BankSelector
                            banks={banks}
                            value={pm.bank_id || ''}
                            onChange={bankId => updatePaymentMethod(i, 'bank_id', bankId)}
                            onBanksChange={setBanks}
                            label="Banco *"
                            className="!py-1.5 text-sm"
                          />
                        </div>
                      )}
                      <div className={pm.method === 'transferencia' ? 'col-span-3' : 'col-span-6'}>
                        <label className="text-xs text-gray-500">Referencia</label>
                        <input
                          className="w-full rounded border p-2 text-sm dark:bg-gray-800"
                          placeholder="N comprobante"
                          value={pm.reference}
                          onChange={e => updatePaymentMethod(i, 'reference', e.target.value)}
                        />
                      </div>
                      {paymentMethods.length > 1 && (
                        <div className="col-span-1 flex items-end">
                          <button type="button" onClick={() => removePaymentMethod(i)} className="p-2 text-red-500 hover:text-red-700">X</button>
                        </div>
                      )}
                    </div>

                    {/* Cheque emitido: existente o nuevo */}
                    {pm.method === 'cheque_emitido' && pm.cheque_data && (
                      <div className="mt-2 pl-4 border-l-2 border-amber-300 space-y-2">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-6">
                            <label className="text-xs text-gray-500">Cheque emitido existente (opcional)</label>
                            <select
                              className="w-full rounded border p-1.5 text-sm dark:bg-gray-800"
                              value={pm.cheque_id || ''}
                              onChange={e => selectExistingCheque(i, e.target.value)}
                            >
                              <option value="">Crear nuevo cheque...</option>
                              {chequesEmitidosDisponibles.map(ch => (
                                <option key={ch.id} value={ch.id}>
                                  #{ch.number} - {ch.bank} - {fmt(ch.amount)} (vto: {fmtDate(ch.due_date)})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <input placeholder="N Cheque" value={pm.cheque_data.number} onChange={e => updateChequeData(i, 'number', e.target.value)} className="rounded border p-1.5 text-sm dark:bg-gray-800" />
                          <input placeholder="Banco emisor" value={pm.cheque_data.bank} onChange={e => updateChequeData(i, 'bank', e.target.value)} className="rounded border p-1.5 text-sm dark:bg-gray-800" />
                          <input placeholder="Librador" value={pm.cheque_data.drawer} onChange={e => updateChequeData(i, 'drawer', e.target.value)} className="rounded border p-1.5 text-sm dark:bg-gray-800" />
                          <input placeholder="CUIT librador" value={pm.cheque_data.drawer_cuit} onChange={e => updateChequeData(i, 'drawer_cuit', e.target.value)} className="rounded border p-1.5 text-sm dark:bg-gray-800" />
                          <select value={pm.cheque_data.cheque_type} onChange={e => updateChequeData(i, 'cheque_type', e.target.value)} className="rounded border p-1.5 text-sm dark:bg-gray-800">
                            <option value="propio">Propio</option>
                            <option value="diferido">Diferido</option>
                            <option value="cruzado">Cruzado</option>
                          </select>
                          <DateInput label="Emision" value={pm.cheque_data.issue_date} onChange={val => updateChequeData(i, 'issue_date', val)} />
                          <DateInput label="Vencimiento" value={pm.cheque_data.due_date} onChange={val => updateChequeData(i, 'due_date', val)} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addPaymentMethod} className="text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">+ Agregar forma de pago</button>
                <div className="text-right text-sm font-medium">
                  Total: ${paymentMethodsTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </div>
              </div>

              {/* Retenciones practicadas */}
              <details className="border border-gray-200 dark:border-gray-700 rounded-lg" open={totalRetenciones > 0}>
                <summary className="px-4 py-3 cursor-pointer font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg select-none">
                  Retenciones practicadas al proveedor
                  {totalRetenciones > 0 && <span className="ml-2 text-sm text-amber-600 font-normal">(${totalRetenciones.toFixed(2)})</span>}
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Montos retenidos al proveedor (se descuentan del bruto al pagar)</p>
                  <div className="space-y-2">
                    {retenciones.map((ret, idx) => (
                      <div key={ret.type}>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={ret.enabled}
                            onChange={() => handleRetencionToggle(idx)}
                            className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                          />
                          <span className="w-24 text-sm font-medium text-gray-700 dark:text-gray-300">{RETENCION_LABELS[ret.type]}</span>
                          <input
                            type="number" placeholder="Base" step="0.01" min="0"
                            value={ret.base_amount || ''}
                            disabled={!ret.enabled}
                            className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
                            onChange={e => handleRetencionChange(idx, 'base_amount', parseFloat(e.target.value) || 0)}
                          />
                          <input
                            type="number" placeholder="%" step="0.01" min="0"
                            value={ret.rate || ''}
                            disabled={!ret.enabled}
                            className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
                            onChange={e => handleRetencionChange(idx, 'rate', parseFloat(e.target.value) || 0)}
                          />
                          <input
                            type="text" placeholder="Regimen"
                            value={ret.regime}
                            disabled={!ret.enabled}
                            className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
                            onChange={e => setRetencionField(idx, 'regime', e.target.value)}
                          />
                          <span className="w-28 text-right text-sm font-medium text-amber-700 dark:text-amber-400">
                            $ {ret.amount.toFixed(2)}
                          </span>
                        </div>
                        {ret.enabled && (
                          <div className="grid grid-cols-3 gap-2 mt-1 ml-7">
                            <div>
                              <label className="text-xs text-gray-500">N° Certificado</label>
                              <input
                                type="text" maxLength={14} placeholder="14 digitos"
                                value={ret.certificate_number || ''}
                                onChange={e => setRetencionField(idx, 'certificate_number', e.target.value)}
                                className="w-full rounded border border-gray-300 dark:border-gray-600 p-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
                              />
                            </div>
                            {ret.type === 'iibb' && (
                              <div>
                                <label className="text-xs text-gray-500">Jurisdiccion *</label>
                                <select
                                  value={ret.jurisdiction || ''}
                                  onChange={e => setRetencionField(idx, 'jurisdiction', e.target.value)}
                                  className="w-full rounded border border-gray-300 dark:border-gray-600 p-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="">Seleccionar...</option>
                                  <option value="caba">CABA</option>
                                  <option value="pba">Provincia de Buenos Aires</option>
                                  <option value="otra">Otra</option>
                                </select>
                              </div>
                            )}
                            {Object.values(piAmounts).filter(v => parseFloat(v) > 0).length > 1 && (
                              <div>
                                <label className="text-xs text-gray-500">Imputar a factura *</label>
                                <select
                                  value={ret.purchase_invoice_id || ''}
                                  onChange={e => setRetencionField(idx, 'purchase_invoice_id', e.target.value)}
                                  className="w-full rounded border border-gray-300 dark:border-gray-600 p-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="">Seleccionar...</option>
                                  {Object.entries(piAmounts)
                                    .filter(([, v]) => parseFloat(v) > 0)
                                    .map(([piId]) => {
                                      const pi = purchaseInvoices.find((p: any) => p.id === piId)
                                      return pi ? (
                                        <option key={piId} value={piId}>{pi.invoice_type} {pi.invoice_number}</option>
                                      ) : null
                                    })}
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {totalRetenciones > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-between text-sm text-gray-700 dark:text-gray-300">
                      <span>Neto a pagar (formas de pago): <b>$ {paymentMethodsTotal.toFixed(2)}</b></span>
                      <span>Retenciones: <b>$ {totalRetenciones.toFixed(2)}</b></span>
                      <span>Bruto que cancela factura: <b>$ {(paymentMethodsTotal + totalRetenciones).toFixed(2)}</b></span>
                    </div>
                  )}
                </div>
              </details>

              {/* Notas */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  rows={2}
                  placeholder="Observaciones..."
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Total neto: <span className="font-bold text-lg text-red-700 ml-2">{fmt(paymentMethodsTotal)}</span>
                  {totalRetenciones > 0 && (
                    <span className="ml-3 text-xs text-amber-600">+ {fmt(totalRetenciones)} retenciones</span>
                  )}
                </div>
                <Button type="submit" variant="success" loading={saving}>Registrar Orden de Pago</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <PeriodSelector selected={periodValue} onChange={handlePeriodChange} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Proveedor</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todos los proveedores</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Estado</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="completo">Completo</option>
                <option value="parcial">Parcial</option>
                <option value="anulado">Anulado</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Metodo</label>
              <select className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
                <option value="">Todos</option>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="cheque">Cheque</option>
                <option value="mixto">Mixto</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={(d) => { setDateFrom(d); setPeriodValue('') }} onDateToChange={(d) => { setDateTo(d); setPeriodValue('') }} onClear={() => { setDateFrom(''); setDateTo(''); setPeriodValue('todos') }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : filteredPagos.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay ordenes de pago con estos filtros' : 'No hay ordenes de pago registradas'}
          description={isFiltered ? undefined : 'Registra la primera orden de pago para empezar a llevar el control'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Nueva Orden de Pago'}
          onAction={isFiltered ? clearFilters : handleOpenForm}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Compra</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Metodo</th>
                  <th className="px-4 py-3">Asignacion</th>
                  <th className="px-4 py-3">Referencia</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedPagos.map(pago => {
                  const isAnulado = pago.status === 'anulado'
                  return (
                    <React.Fragment key={pago.id}>
                      <tr
                        id={`pago-row-${pago.id}`}
                        onClick={() => setExpandedPagoId(prev => prev === pago.id ? null : pago.id)}
                        className={`border-b dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                          expandedPagoId === pago.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        } ${isAnulado ? 'opacity-60 bg-red-50/30 dark:bg-red-900/10 line-through' : ''}`}
                        title={isAnulado ? `Anulado — ${pago.anulled_reason || 'sin motivo'}` : undefined}
                      >
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
                                <span key={ret.id} className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 px-1 py-0.5 rounded">
                                  {ret.type.toUpperCase()} {parseFloat(ret.rate).toFixed(1)}% = {fmt(ret.amount)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{PAYMENT_METHOD_LABELS[pago.payment_method] || pago.payment_method}</td>
                        <td className="px-4 py-3">
                          {(() => {
                            const totalAmt = parseFloat(pago.amount || '0')
                            const assigned = parseFloat(String(pago.total_assigned || '0'))
                            const invoices = pago.linked_purchase_invoices || []
                            const isFullyAssigned = assigned >= totalAmt - 0.01 && totalAmt > 0
                            const isPartial = assigned > 0 && !isFullyAssigned
                            return (
                              <div>
                                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                                  isFullyAssigned ? 'bg-green-100 text-green-800' :
                                  isPartial ? 'bg-blue-100 text-blue-800' :
                                  'bg-orange-100 text-orange-800'
                                }`}>
                                  {isFullyAssigned ? 'Completo' : isPartial ? 'Parcial' : 'Sin vincular'}
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
                          {isAnulado ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-block text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-800">ANULADO</span>
                              {pago.anulled_at && (
                                <span className="text-[10px] text-gray-500" title={pago.anulled_reason || ''}>
                                  {new Date(pago.anulled_at).toLocaleDateString('es-AR')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <PermissionGate module="pagos" action="create">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setLinkingPago({
                                      id: pago.id,
                                      amount: Number(pago.total_amount || pago.amount || 0),
                                      enterprise_id: pago.enterprise_id || undefined,
                                    })
                                  }}
                                  className="text-purple-600 hover:text-purple-800 text-xs font-medium transition-colors"
                                >Vincular</button>
                              </PermissionGate>
                              <PermissionGate module="pagos" action="delete">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setAnularTarget(pago) }}
                                  className="text-red-500 hover:text-red-700 text-sm transition-colors"
                                >Anular</button>
                              </PermissionGate>
                            </div>
                          )}
                        </td>
                      </tr>
                      {expandedPagoId === pago.id && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <div className="p-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-200 dark:border-gray-700 space-y-4">

                              {/* Bruto / Retenciones / Neto resumen */}
                              {(() => {
                                const neto = parseFloat(pago.amount || '0')
                                const retSum = (pago.retenciones || []).reduce((s, r) => s + Number(r.amount || 0), 0)
                                const bruto = neto + retSum
                                return (
                                  <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-4">
                                      <span><span className="text-gray-500">Bruto:</span> <b>{fmt(bruto)}</b></span>
                                      <span><span className="text-gray-500">Retenciones:</span> <b className="text-amber-600">{fmt(retSum)}</b></span>
                                      <span><span className="text-gray-500">Neto pagado:</span> <b className="text-red-700">{fmt(neto)}</b></span>
                                    </div>
                                  </div>
                                )
                              })()}

                              {/* Formas de Pago */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Formas de Pago</h4>
                                <table className="w-full text-sm">
                                  <thead><tr className="text-left text-xs text-gray-500">
                                    <th className="pb-1">Metodo</th><th className="pb-1">Monto</th><th className="pb-1">Banco</th><th className="pb-1">Referencia</th>
                                  </tr></thead>
                                  <tbody>
                                    {((pago.payment_methods && pago.payment_methods.length > 0)
                                      ? pago.payment_methods
                                      : [{ method: pago.payment_method, amount: pago.amount, bank_id: null, bank_name: pago.bank_name, reference: pago.reference }]
                                    ).map((pm: any, i: number) => (
                                      <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                                        <td className="py-1 capitalize">{PAYMENT_METHOD_LABELS[pm.method] || pm.method}</td>
                                        <td className="py-1 font-medium">${parseFloat(pm.amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                        <td className="py-1 text-gray-500">{pm.bank_name || '-'}</td>
                                        <td className="py-1 text-gray-500">{pm.reference || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {/* Facturas de Compra Vinculadas */}
                              {pago.linked_purchase_invoices && pago.linked_purchase_invoices.length > 0 && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Facturas de Compra Vinculadas</h4>
                                  <table className="w-full text-sm">
                                    <thead><tr className="text-left text-xs text-gray-500">
                                      <th className="pb-1">Factura</th><th className="pb-1 text-right">Total</th><th className="pb-1 text-right">Aplicado</th><th className="pb-1 text-right">Pendiente</th>
                                    </tr></thead>
                                    <tbody>
                                      {pago.linked_purchase_invoices.map((inv: any) => {
                                        const total = parseFloat(inv.invoice_total || '0')
                                        const applied = parseFloat(inv.amount || '0')
                                        return (
                                          <tr key={inv.id} className="border-t border-gray-100 dark:border-gray-700">
                                            <td className="py-1">{inv.invoice_type || ''} {inv.invoice_number}</td>
                                            <td className="py-1 text-right">${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                            <td className="py-1 text-right text-green-600">${applied.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                            <td className="py-1 text-right text-amber-600">${(total - applied > 0.01 ? (total - applied) : 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Retenciones Practicadas */}
                              {pago.retenciones && pago.retenciones.length > 0 && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Retenciones Practicadas</h4>
                                  <table className="w-full text-sm">
                                    <thead><tr className="text-left text-xs text-gray-500">
                                      <th className="pb-1">Tipo</th><th className="pb-1">Regimen</th><th className="pb-1">Tasa</th><th className="pb-1">Jurisdiccion</th><th className="pb-1">Imputado a</th><th className="pb-1">N° Cert.</th><th className="pb-1 text-right">Importe</th>
                                    </tr></thead>
                                    <tbody>
                                      {pago.retenciones.map((ret) => {
                                        const targetInv = (pago.linked_purchase_invoices || []).find((inv: any) =>
                                          inv.purchase_invoice_id === ret.purchase_invoice_id || inv.id === ret.purchase_invoice_id
                                        )
                                        return (
                                          <tr key={ret.id} className="border-t border-gray-100 dark:border-gray-700">
                                            <td className="py-1 uppercase">{RETENCION_LABELS[ret.type] || ret.type}</td>
                                            <td className="py-1">{ret.regime || '-'}</td>
                                            <td className="py-1">{parseFloat(ret.rate).toFixed(1)}%</td>
                                            <td className="py-1">{ret.jurisdiction || '-'}</td>
                                            <td className="py-1 font-mono text-xs">{targetInv ? `${targetInv.invoice_type || ''}${targetInv.invoice_number}` : '-'}</td>
                                            <td className="py-1 font-mono text-xs">{ret.certificate_number || '-'}</td>
                                            <td className="py-1 text-right font-medium">${parseFloat(ret.amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Cheques emitidos detalle */}
                              {(pago.payment_methods || []).some((pm: any) => (pm.method === 'cheque_emitido' || pm.method === 'cheque') && pm.cheque_data) && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Cheques emitidos</h4>
                                  {(pago.payment_methods || []).filter((pm: any) => (pm.method === 'cheque_emitido' || pm.method === 'cheque') && pm.cheque_data).map((pm: any, i: number) => (
                                    <div key={i} className="grid grid-cols-4 gap-2 text-sm border-l-2 border-amber-300 pl-3 mb-2">
                                      <div><span className="text-xs text-gray-500">N°</span><br />{pm.cheque_data?.number}</div>
                                      <div><span className="text-xs text-gray-500">Banco</span><br />{pm.cheque_data?.bank}</div>
                                      <div><span className="text-xs text-gray-500">Librador</span><br />{pm.cheque_data?.drawer}</div>
                                      <div><span className="text-xs text-gray-500">Vencimiento</span><br />{pm.cheque_data?.due_date}</div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Empresa + saldos */}
                              <div className="flex items-center justify-between">
                                <div className="text-sm text-gray-500">
                                  <span className="font-medium text-gray-700 dark:text-gray-300">{pago.enterprise_name || '-'}</span>
                                  {pago.enterprise_cuit && <span className="ml-2 text-gray-500">CUIT: {pago.enterprise_cuit}</span>}
                                </div>
                                <div className="text-sm text-right">
                                  <span className="text-gray-500">Total: </span><span className="font-medium">${parseFloat(pago.total_amount || pago.amount || '0').toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                                  {pago.total_assigned && parseFloat(String(pago.total_assigned)) > 0 && (
                                    <>
                                      <span className="mx-2 text-gray-300">|</span>
                                      <span className="text-gray-500">Asignado: </span><span className="text-green-600">${parseFloat(String(pago.total_assigned)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Notas */}
                              {pago.notes && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Observaciones</h4>
                                  <p className="text-sm text-gray-600 dark:text-gray-400">{pago.notes}</p>
                                </div>
                              )}

                              {/* Anulado footer */}
                              {isAnulado && (
                                <div className="border-t border-red-200 dark:border-red-800 pt-3 bg-red-50/40 dark:bg-red-900/10 -mx-4 px-4 -mb-4 pb-4">
                                  <h4 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">Pago anulado</h4>
                                  <p className="text-xs text-red-600 dark:text-red-400">
                                    {pago.anulled_at && <span>Fecha: {new Date(pago.anulled_at).toLocaleString('es-AR')}</span>}
                                  </p>
                                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                                    <span className="font-medium">Motivo:</span> {pago.anulled_reason || '(sin motivo)'}
                                  </p>
                                </div>
                              )}

                              {/* PDF */}
                              {!isAnulado && (
                                <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      try {
                                        const blob = await api.getPagoPdf(pago.id)
                                        const url = URL.createObjectURL(blob)
                                        window.open(url)
                                      } catch {
                                        toast.error('Error al generar PDF')
                                      }
                                    }}
                                    className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                  >Descargar PDF</button>
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
            totalItems={filteredPagos.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      {/* Anular modal */}
      {anularTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Anular pago</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              Anular este pago a {anularTarget.enterprise_name || 'proveedor'}? Los montos vinculados a facturas se desasignaran y los cheques emitidos se marcaran como anulados.
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Motivo de la anulacion (obligatorio)
            </label>
            <textarea
              value={anularReason}
              onChange={(e) => setAnularReason(e.target.value)}
              minLength={5}
              rows={3}
              placeholder="Explica brevemente por que se anula este pago..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              autoFocus
            />
            <div className="text-xs text-gray-500 mt-1">{anularReason.trim().length}/5 minimo</div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                disabled={anulando}
                onClick={() => { setAnularTarget(null); setAnularReason('') }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md disabled:opacity-50"
              >Cancelar</button>
              <button
                type="button"
                disabled={anulando || anularReason.trim().length < 5}
                onClick={handleAnular}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
              >{anulando ? 'Anulando...' : 'Anular'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Linker modal */}
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
