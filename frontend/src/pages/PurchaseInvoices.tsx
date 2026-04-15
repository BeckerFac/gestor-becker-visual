import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toLocalYMD } from '@/utils/dates'
import { checkEnterpriseFiscalData } from '@/utils/fiscal'

// ---- Types ----

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
  cae_expiry_date?: string | null
  subtotal: string
  vat_amount: string
  other_taxes: string | null
  total_amount: string
  total_paid?: string | null
  payment_status: string
  status: string
  remaining_balance: string | null
  notes: string | null
  related_invoice_id?: string | null
  is_credit_note?: boolean
  cancelled_at?: string | null
  cancelled_by?: string | null
  cancellation_reason?: string | null
  created_at: string
}

interface Enterprise {
  id: string
  name: string
  cuit?: string | null
  razon_social?: string | null
  tax_condition?: string | null
  address?: string | null
  fiscal_address?: string | null
}

interface Purchase {
  id: string
  purchase_number: number
  total_amount: string
  enterprise_name: string | null
  enterprise_id?: string
}

// ---- Constants ----

const INVOICE_TYPES = ['A', 'B', 'C'] as const
const NC_TYPES = ['NC_A', 'NC_B', 'NC_C'] as const
type PIInvoiceType = typeof INVOICE_TYPES[number] | typeof NC_TYPES[number]

const isNcType = (t: string) => t.startsWith('NC_')

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  authorized: { label: 'Autorizada', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  cancelled: { label: 'Anulada', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  cancelado: { label: 'Anulada', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
}

const PAYMENT_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pagado: { label: 'Pagada', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  parcial: { label: 'Pago parcial', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  B: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  C: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  NC_A: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  NC_B: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  NC_C: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const isCancelled = (pi: PurchaseInvoice) =>
  pi.status === 'cancelled' || pi.status === 'cancelado'

const isFiscallyLocked = (pi: PurchaseInvoice) =>
  pi.status === 'authorized' && !isCancelled(pi)

// ---- KPI Card ----

interface KpiCardProps {
  label: string
  value: string | number
  accent: 'purple' | 'green' | 'red' | 'blue' | 'gray'
  subtitle?: string
}

const ACCENT_STYLES: Record<KpiCardProps['accent'], string> = {
  purple: 'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300',
  green: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  gray: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-300',
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, accent, subtitle }) => (
  <Card className={`border ${ACCENT_STYLES[accent]}`}>
    <CardContent className="pt-3 pb-2">
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {subtitle && <p className="text-[10px] opacity-70 mt-0.5">{subtitle}</p>}
    </CardContent>
  </Card>
)

// ---- Component ----

export const PurchaseInvoices: React.FC = () => {
  // Data
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Filters: period, multi-select supplier/status/type, search
  const [period, setPeriod] = useState('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterEnterprises, setFilterEnterprises] = useState<string[]>([])
  const [filterPaymentStatuses, setFilterPaymentStatuses] = useState<string[]>([])
  const [filterTypes, setFilterTypes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pi: PurchaseInvoice } | null>(null)

  // Expand row
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedPagos, setExpandedPagos] = useState<any[]>([])

  // Anular modal
  const [anularTarget, setAnularTarget] = useState<PurchaseInvoice | null>(null)
  const [anularReason, setAnularReason] = useState('')
  const [anulando, setAnulando] = useState(false)

  // NC modal
  const [ncTarget, setNcTarget] = useState<PurchaseInvoice | null>(null)
  const [ncForm, setNcForm] = useState({
    invoice_type: 'NC_A' as 'NC_A' | 'NC_B' | 'NC_C',
    punto_venta: '',
    invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    cae: '',
    subtotal: '',
    vat_amount: '',
    total_amount: '',
    notes: '',
    partial: false,
  })
  const [ncSaving, setNcSaving] = useState(false)

  // Create form (kept from previous minimal version + fiscal data check)
  const [form, setForm] = useState({
    enterprise_id: '',
    purchase_id: '',
    invoice_type: 'A',
    punto_venta: '',
    invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    cae: '',
    subtotal: '',
    vat_amount: '',
    other_taxes: '',
    total_amount: '',
    notes: '',
  })

  // ---- Data Loading ----

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [piRes, entRes, purchRes] = await Promise.all([
        api.getPurchaseInvoices({}).catch((err: any) => {
          setError(`Error cargando facturas: ${err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getEnterprises().catch(() => []),
        api.getPurchases().catch(() => []),
      ])
      setInvoices((piRes || []) as PurchaseInvoice[])
      setEnterprises(entRes || [])
      setPurchases(purchRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    setCurrentPage(1)
  }, [filterEnterprises, filterPaymentStatuses, filterTypes, search, dateFrom, dateTo, pageSize])

  // Context menu close on outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  // ---- Filtering ----

  const filteredInvoices = useMemo(() => {
    let result = invoices
    if (dateFrom) result = result.filter(i => toLocalYMD(i.invoice_date) >= dateFrom)
    if (dateTo) result = result.filter(i => toLocalYMD(i.invoice_date) <= dateTo)
    if (filterEnterprises.length > 0) {
      const set = new Set(filterEnterprises)
      result = result.filter(i => set.has(i.enterprise_id))
    }
    if (filterPaymentStatuses.length > 0) {
      const set = new Set(filterPaymentStatuses)
      result = result.filter(i => {
        if (set.has('anulada') && isCancelled(i)) return true
        return set.has(i.payment_status)
      })
    }
    if (filterTypes.length > 0) {
      const set = new Set(filterTypes)
      result = result.filter(i => {
        if (set.has('NC') && isNcType(i.invoice_type)) return true
        return set.has(i.invoice_type)
      })
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(i =>
        (i.invoice_number || '').toLowerCase().includes(q) ||
        (i.enterprise_name || '').toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q) ||
        (i.cae || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [invoices, dateFrom, dateTo, filterEnterprises, filterPaymentStatuses, filterTypes, search])

  // ---- KPIs (computed over current filtered window) ----

  const kpis = useMemo(() => {
    const active = filteredInvoices.filter(i => !isCancelled(i))
    const totalFacturado = active.reduce((s, i) => s + parseFloat(i.total_amount || '0'), 0)
    const totalPagado = active.reduce((s, i) => {
      const total = parseFloat(i.total_amount || '0')
      const remaining = parseFloat(i.remaining_balance || String(total))
      return s + Math.max(0, total - remaining)
    }, 0)
    const pendientePago = active.reduce((s, i) => {
      const remaining = parseFloat(i.remaining_balance || '0')
      return s + Math.max(0, remaining)
    }, 0)
    const cantidadFacturas = active.length
    const cantidadAnuladas = filteredInvoices.filter(i => isCancelled(i)).length
    return { totalFacturado, totalPagado, pendientePago, cantidadFacturas, cantidadAnuladas }
  }, [filteredInvoices])

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize))
  const paginated = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered =
    filterEnterprises.length > 0 ||
    filterPaymentStatuses.length > 0 ||
    filterTypes.length > 0 ||
    !!search ||
    !!dateFrom ||
    !!dateTo

  const clearFilters = () => {
    setFilterEnterprises([])
    setFilterPaymentStatuses([])
    setFilterTypes([])
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setPeriod('month')
  }

  // ---- Handlers ----

  const handleContextMenu = (e: React.MouseEvent, pi: PurchaseInvoice) => {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 240)
    const y = Math.min(e.clientY, window.innerHeight - 260)
    setContextMenu({ x, y, pi })
  }

  const loadPagosForInvoice = useCallback(async (piId: string) => {
    try {
      const data = await api.getPurchaseInvoicePagos(piId)
      setExpandedPagos(data || [])
    } catch {
      setExpandedPagos([])
    }
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

  const selectedEnterpriseForForm = useMemo(
    () => enterprises.find(e => e.id === form.enterprise_id) || null,
    [enterprises, form.enterprise_id]
  )

  const filteredPurchasesForForm = form.enterprise_id
    ? purchases.filter(p => (p as any).enterprise_id === form.enterprise_id)
    : purchases

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.invoice_number) { setError('Numero de factura requerido'); return }
    if (!form.total_amount || parseFloat(form.total_amount) <= 0) { setError('Monto total requerido'); return }
    if (!form.enterprise_id) { setError('Proveedor requerido'); return }

    // Fiscal data check (C3 rule)
    if (selectedEnterpriseForForm) {
      const fiscal = checkEnterpriseFiscalData(selectedEnterpriseForForm as any)
      if (!fiscal.complete) {
        toast.error(`Datos fiscales incompletos: ${fiscal.missing.join(', ')}`)
        return
      }
    }

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
      } as any)
      toast.success('Factura de compra registrada')
      setShowForm(false)
      setForm({
        enterprise_id: '', purchase_id: '', invoice_type: 'A', punto_venta: '',
        invoice_number: '', invoice_date: new Date().toISOString().split('T')[0],
        cae: '', subtotal: '', vat_amount: '', other_taxes: '', total_amount: '', notes: '',
      })
      await loadData()
    } catch (e: any) {
      toast.error(e.message || 'Error al crear factura de compra')
    } finally {
      setSaving(false)
    }
  }

  // Edit: blocked if authorized
  const handleEdit = (pi: PurchaseInvoice) => {
    if (isFiscallyLocked(pi)) {
      toast.error('Factura autorizada: campos fiscales bloqueados por AFIP')
      return
    }
    toast.info('Edicion de factura (proximamente)')
  }

  // Duplicar: pre-fill form
  const handleDuplicate = (pi: PurchaseInvoice) => {
    setForm({
      enterprise_id: pi.enterprise_id,
      purchase_id: pi.purchase_id || '',
      invoice_type: pi.invoice_type,
      punto_venta: pi.punto_venta || '',
      invoice_number: '',
      invoice_date: new Date().toISOString().split('T')[0],
      cae: '',
      subtotal: pi.subtotal || '',
      vat_amount: pi.vat_amount || '',
      other_taxes: pi.other_taxes || '',
      total_amount: pi.total_amount || '',
      notes: pi.notes || '',
    })
    setShowForm(true)
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0)
  }

  // Anular handlers
  const openAnular = (pi: PurchaseInvoice) => {
    setAnularTarget(pi)
    setAnularReason('')
  }
  const closeAnular = () => {
    setAnularTarget(null)
    setAnularReason('')
  }
  const handleAnular = async () => {
    if (!anularTarget) return
    if (anularReason.trim().length < 10) {
      toast.error('El motivo debe tener al menos 10 caracteres')
      return
    }
    setAnulando(true)
    try {
      await api.cancelPurchaseInvoice(anularTarget.id, anularReason.trim())
      toast.success('Factura anulada')
      closeAnular()
      await loadData()
    } catch (e: any) {
      toast.error(e.message || 'Error al anular factura')
    } finally {
      setAnulando(false)
    }
  }

  // NC handlers
  const openNC = (pi: PurchaseInvoice) => {
    if (!isFiscallyLocked(pi)) {
      toast.error('Solo se pueden emitir NC sobre facturas autorizadas')
      return
    }
    // Map original type to NC type
    const ncType = pi.invoice_type === 'A' ? 'NC_A'
      : pi.invoice_type === 'B' ? 'NC_B'
      : 'NC_C'
    setNcTarget(pi)
    setNcForm({
      invoice_type: ncType,
      punto_venta: pi.punto_venta || '',
      invoice_number: '',
      invoice_date: new Date().toISOString().split('T')[0],
      cae: '',
      subtotal: pi.subtotal || '',
      vat_amount: pi.vat_amount || '',
      total_amount: pi.total_amount || '',
      notes: `NC sobre factura ${pi.invoice_type} ${pi.punto_venta ? pi.punto_venta + '-' : ''}${pi.invoice_number}`,
      partial: false,
    })
  }
  const closeNC = () => {
    setNcTarget(null)
  }
  const handleCreateNC = async () => {
    if (!ncTarget) return
    if (!ncForm.invoice_number) { toast.error('Numero de NC requerido'); return }
    if (!ncForm.total_amount || parseFloat(ncForm.total_amount) <= 0) { toast.error('Total requerido'); return }
    setNcSaving(true)
    try {
      const buId = localStorage.getItem('gestia_active_business_unit_id') || undefined
      await api.createPurchaseInvoiceNC({
        related_invoice_id: ncTarget.id,
        enterprise_id: ncTarget.enterprise_id,
        invoice_type: ncForm.invoice_type,
        punto_venta: ncForm.punto_venta || undefined,
        invoice_number: ncForm.invoice_number,
        invoice_date: ncForm.invoice_date,
        cae: ncForm.cae || undefined,
        subtotal: parseFloat(ncForm.subtotal) || 0,
        vat_amount: parseFloat(ncForm.vat_amount) || 0,
        total_amount: parseFloat(ncForm.total_amount),
        notes: ncForm.notes || undefined,
        business_unit_id: buId,
      })
      toast.success('Nota de Credito creada')
      closeNC()
      await loadData()
    } catch (e: any) {
      toast.error(e.message || 'Error al crear NC')
    } finally {
      setNcSaving(false)
    }
  }

  // PDF download (placeholder — hook into real endpoint if exists)
  const handleDownloadPdf = (_pi: PurchaseInvoice) => {
    toast.info('Descarga de PDF (proximamente)')
  }

  // ---- CSV columns ----

  const csvColumns = [
    { key: 'invoice_date', label: 'Fecha', type: 'date' as const },
    { key: 'invoice_type', label: 'Tipo' },
    { key: 'invoice_number_fmt', label: 'Numero' },
    { key: 'enterprise_name', label: 'Proveedor' },
    { key: 'subtotal', label: 'Neto', type: 'currency' as const },
    { key: 'vat_amount', label: 'IVA', type: 'currency' as const },
    { key: 'total_amount', label: 'Total', type: 'currency' as const },
    { key: 'remaining_balance', label: 'Saldo', type: 'currency' as const },
    { key: 'payment_status_label', label: 'Estado Pago' },
    { key: 'status_label', label: 'Estado' },
    { key: 'cae', label: 'CAE' },
    { key: 'cancellation_reason', label: 'Motivo Anulacion' },
  ]

  const csvData = filteredInvoices.map(pi => ({
    invoice_date: pi.invoice_date,
    invoice_type: pi.invoice_type,
    invoice_number_fmt: `${pi.punto_venta ? pi.punto_venta + '-' : ''}${pi.invoice_number}`,
    enterprise_name: pi.enterprise_name || '',
    subtotal: pi.subtotal || '0',
    vat_amount: pi.vat_amount || '0',
    total_amount: pi.total_amount || '0',
    remaining_balance: pi.remaining_balance || '0',
    payment_status_label: PAYMENT_STATUS_MAP[pi.payment_status]?.label || pi.payment_status,
    status_label: STATUS_MAP[pi.status]?.label || pi.status,
    cae: pi.cae || '',
    cancellation_reason: pi.cancellation_reason || '',
  }))

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Facturas de Compra</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {filteredInvoices.length} comprobante{filteredInvoices.length !== 1 ? 's' : ''} · Recibidos de proveedores
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={csvColumns} filename="facturas_compra" />
          <ExportExcelButton data={csvData} columns={csvColumns} filename="facturas_compra" />
          <PermissionGate module="purchases" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancelar' : '+ Cargar Factura'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Facturado (mes)" value={formatCurrency(kpis.totalFacturado)} accent="purple" />
        <KpiCard label="Total Pagado (mes)" value={formatCurrency(kpis.totalPagado)} accent="green" />
        <KpiCard label="Pendiente de Pago" value={formatCurrency(kpis.pendientePago)} accent="red" />
        <KpiCard label="Cantidad de Facturas" value={kpis.cantidadFacturas} accent="blue" />
        <KpiCard label="Anuladas" value={kpis.cantidadAnuladas} accent="gray" />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-start justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 font-bold text-red-500 hover:text-red-700">x</button>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <PeriodSelector
              selected={period}
              onChange={(p) => {
                setPeriod(p.value)
                setDateFrom(p.dateFrom)
                setDateTo(p.dateTo)
              }}
            />
            <div className="flex items-center gap-2 ml-auto">
              <input
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 min-w-[240px]"
                placeholder="Buscar por numero, proveedor, notas, CAE..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <MultiSelectFilter
              label="Proveedor"
              options={enterprises.map(e => ({ value: e.id, label: e.name }))}
              selected={filterEnterprises}
              onChange={setFilterEnterprises}
            />
            <MultiSelectFilter
              label="Estado"
              options={[
                { value: 'pagado', label: 'Pagada' },
                { value: 'parcial', label: 'Pago parcial' },
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'anulada', label: 'Anulada' },
              ]}
              selected={filterPaymentStatuses}
              onChange={setFilterPaymentStatuses}
            />
            <MultiSelectFilter
              label="Tipo"
              options={[
                { value: 'A', label: 'Factura A' },
                { value: 'B', label: 'Factura B' },
                { value: 'C', label: 'Factura C' },
                { value: 'NC', label: 'Nota de Credito' },
              ]}
              selected={filterTypes}
              onChange={setFilterTypes}
            />
          </div>
        </CardContent>
      </Card>

      {/* Create Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">Cargar Factura de Compra</h3></CardHeader>
          <CardContent>
            {selectedEnterpriseForForm && (() => {
              const fiscal = checkEnterpriseFiscalData(selectedEnterpriseForForm as any)
              if (fiscal.complete) return null
              return (
                <div className="mb-4 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-800 dark:text-red-300">
                  {'\u26A0'} Datos fiscales del proveedor incompletos: {fiscal.missing.join(', ')}
                </div>
              )
            })()}
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Proveedor *</label>
                <select
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={form.enterprise_id}
                  onChange={e => setForm({ ...form, enterprise_id: e.target.value, purchase_id: '' })}
                  required
                >
                  <option value="">Seleccionar proveedor...</option>
                  {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Compra asociada</label>
                <select
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={form.purchase_id}
                  onChange={e => setForm({ ...form, purchase_id: e.target.value })}
                >
                  <option value="">Sin compra (gasto independiente)</option>
                  {filteredPurchasesForForm.map(p => (
                    <option key={p.id} value={p.id}>
                      #{String(p.purchase_number).padStart(4, '0')} ({formatCurrency(p.total_amount)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo *</label>
                <select
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={form.invoice_type}
                  onChange={e => setForm({ ...form, invoice_type: e.target.value })}
                >
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
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving} className="w-full">Registrar Factura</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <Card><CardContent><SkeletonTable rows={6} cols={9} /></CardContent></Card>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Comprobante</th>
                  <th className="px-2 py-2">Proveedor</th>
                  <th className="px-2 py-2 text-right">Neto</th>
                  <th className="px-2 py-2 text-right">IVA</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Pagado</th>
                  <th className="px-2 py-2 text-right">Saldo</th>
                  <th className="px-2 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(pi => {
                  const cancelled = isCancelled(pi)
                  const locked = isFiscallyLocked(pi)
                  const total = parseFloat(pi.total_amount || '0')
                  const remaining = parseFloat(pi.remaining_balance || String(total))
                  const pagado = Math.max(0, total - remaining)
                  const psMeta = PAYMENT_STATUS_MAP[pi.payment_status] || PAYMENT_STATUS_MAP.pendiente
                  const rowBg = cancelled
                    ? 'bg-red-50/60 dark:bg-red-950/20 line-through text-gray-400'
                    : ''
                  return (
                    <React.Fragment key={pi.id}>
                      <tr
                        className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${rowBg}`}
                        onContextMenu={(e) => handleContextMenu(e, pi)}
                        onClick={() => handleToggleExpand(pi.id)}
                        title={cancelled && pi.cancellation_reason ? `Anulada: ${pi.cancellation_reason}` : undefined}
                      >
                        <td className="px-2 py-2 text-gray-600 dark:text-gray-400 text-xs">
                          {formatDate(pi.invoice_date)}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block px-1.5 py-0.5 rounded font-bold text-xs ${TYPE_BADGE_COLORS[pi.invoice_type] || 'bg-gray-100 text-gray-800 dark:text-gray-200'}`}>
                              {pi.invoice_type.replace('_', ' ')}
                            </span>
                            <span className="font-mono text-xs text-gray-800 dark:text-gray-200">
                              {pi.punto_venta ? `${pi.punto_venta}-` : ''}{pi.invoice_number}
                            </span>
                            {locked && (
                              <span
                                title="Campos fiscales bloqueados por AFIP"
                                className="text-amber-600 dark:text-amber-400"
                                aria-label="Bloqueada"
                              >
                                {/* padlock icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                              </span>
                            )}
                            {cancelled && (
                              <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-600 text-white">
                                ANULADA
                              </span>
                            )}
                          </div>
                          {pi.cae && <p className="font-mono text-[10px] text-gray-400 mt-0.5">CAE: {pi.cae}</p>}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <span className="font-medium text-gray-800 dark:text-gray-200">{pi.enterprise_name}</span>
                          {pi.enterprise_cuit && <p className="text-gray-500 dark:text-gray-400">{pi.enterprise_cuit}</p>}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(parseFloat(pi.subtotal || '0'))}</td>
                        <td className="px-2 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(parseFloat(pi.vat_amount || '0'))}</td>
                        <td className="px-2 py-2 text-right font-bold text-purple-700 dark:text-purple-400">{formatCurrency(total)}</td>
                        <td className="px-2 py-2 text-right text-green-700 dark:text-green-400">{formatCurrency(pagado)}</td>
                        <td className="px-2 py-2 text-right">
                          {remaining > 0.01 ? (
                            <span className="text-red-600 font-medium">{formatCurrency(remaining)}</span>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {cancelled ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                              Anulada
                            </span>
                          ) : (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${psMeta.color}`}>
                              {psMeta.label}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedId === pi.id && (
                        <tr className="bg-purple-50/50 dark:bg-purple-950/20">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="space-y-3">
                              {cancelled && pi.cancellation_reason && (
                                <div className="p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded text-xs text-red-800 dark:text-red-300">
                                  <span className="font-semibold">Motivo de anulacion:</span> {pi.cancellation_reason}
                                  {pi.cancelled_at && <span className="ml-2 text-red-600">({formatDate(pi.cancelled_at)})</span>}
                                </div>
                              )}
                              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ordenes de pago vinculadas</h4>
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
                                <p className="text-sm text-gray-400 italic">Sin pagos vinculados.</p>
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

      {/* Context Menu */}
      {contextMenu && (() => {
        const pi = contextMenu.pi
        const cancelled = isCancelled(pi)
        const locked = isFiscallyLocked(pi)
        return (
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[220px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setContextMenu(null); handleToggleExpand(pi.id) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Ver detalle
            </button>
            <button
              onClick={() => { setContextMenu(null); handleEdit(pi) }}
              disabled={locked}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={locked ? 'Bloqueada: campos fiscales inmutables' : undefined}
            >
              Editar {locked && '(bloqueada)'}
            </button>
            <button
              onClick={() => { setContextMenu(null); handleDuplicate(pi) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Duplicar
            </button>
            {locked && !isNcType(pi.invoice_type) && (
              <button
                onClick={() => { setContextMenu(null); openNC(pi) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Crear Nota de Credito
              </button>
            )}
            <button
              onClick={() => { setContextMenu(null); handleDownloadPdf(pi) }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Descargar PDF
            </button>
            <div className="border-t dark:border-gray-700 my-1" />
            <button
              onClick={() => { setContextMenu(null); openAnular(pi) }}
              disabled={cancelled}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anular
            </button>
          </div>
        )
      })()}

      {/* Anular Modal */}
      {anularTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={closeAnular}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Anular Factura de Compra</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {anularTarget.invoice_type} {anularTarget.punto_venta ? anularTarget.punto_venta + '-' : ''}{anularTarget.invoice_number} · {anularTarget.enterprise_name}
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Motivo de anulacion <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
              rows={4}
              value={anularReason}
              onChange={(e) => setAnularReason(e.target.value)}
              placeholder="Minimo 10 caracteres. Ej: Duplicada por error, proveedor rechazo la operacion, etc."
            />
            <p className={`text-xs mt-1 ${anularReason.trim().length >= 10 ? 'text-green-600' : 'text-gray-500'}`}>
              {anularReason.trim().length}/10 caracteres minimos
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={closeAnular} disabled={anulando}>Cancelar</Button>
              <Button
                variant="danger"
                onClick={handleAnular}
                loading={anulando}
                disabled={anularReason.trim().length < 10}
              >
                Confirmar Anulacion
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* NC Modal */}
      {ncTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={closeNC}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Crear Nota de Credito</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Sobre factura {ncTarget.invoice_type} {ncTarget.punto_venta ? ncTarget.punto_venta + '-' : ''}{ncTarget.invoice_number} · {ncTarget.enterprise_name}
            </p>
            <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-800 dark:text-blue-300">
              Tipo NC: <strong>{ncForm.invoice_type.replace('_', ' ')}</strong> · Totales pre-cargados desde la factura original. Edita para NC parcial.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Punto de Venta"
                value={ncForm.punto_venta}
                onChange={e => setNcForm({ ...ncForm, punto_venta: e.target.value })}
              />
              <Input
                label="Numero NC *"
                value={ncForm.invoice_number}
                onChange={e => setNcForm({ ...ncForm, invoice_number: e.target.value })}
                required
              />
              <DateInput
                label="Fecha *"
                value={ncForm.invoice_date}
                onChange={val => setNcForm({ ...ncForm, invoice_date: val })}
                required
              />
              <Input
                label="CAE"
                value={ncForm.cae}
                onChange={e => setNcForm({ ...ncForm, cae: e.target.value })}
              />
              <Input
                label="Neto"
                type="number" step="0.01" min="0"
                value={ncForm.subtotal}
                onChange={e => setNcForm({ ...ncForm, subtotal: e.target.value })}
              />
              <Input
                label="IVA"
                type="number" step="0.01" min="0"
                value={ncForm.vat_amount}
                onChange={e => setNcForm({ ...ncForm, vat_amount: e.target.value })}
              />
              <Input
                label="Total NC *"
                type="number" step="0.01" min="0.01"
                value={ncForm.total_amount}
                onChange={e => setNcForm({ ...ncForm, total_amount: e.target.value })}
                required
              />
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ncForm.partial}
                    onChange={e => setNcForm({ ...ncForm, partial: e.target.checked })}
                  />
                  <span>NC parcial</span>
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Notas</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                  rows={2}
                  value={ncForm.notes}
                  onChange={e => setNcForm({ ...ncForm, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={closeNC} disabled={ncSaving}>Cancelar</Button>
              <Button variant="primary" onClick={handleCreateNC} loading={ncSaving}>Crear NC</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
