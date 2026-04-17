import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { Pagination } from '@/components/shared/Pagination'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { ContextMenuBase, type ContextMenuItem } from '@/components/ui/ContextMenuBase'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useBusinessUnitStore } from '@/stores/businessUnitStore'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toLocalYMD } from '@/utils/dates'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { HelpTip } from '@/components/shared/HelpTip'

// ----- Types -----

interface PurchaseItem {
  id?: string
  product_id?: string | null
  product_name: string
  description: string
  quantity: number | string
  unit_price: number | string
  vat_rate: number | string
  subtotal?: number | string
  add_to_stock?: boolean
}

interface Purchase {
  id: string
  purchase_number: number
  date: string
  enterprise_name: string | null
  enterprise_cuit: string | null
  enterprise_id: string | null
  business_unit_id: string | null
  business_unit_name?: string | null
  item_count: number
  items?: PurchaseItem[]
  subtotal: string | null
  vat_amount: string | null
  total_amount: string
  payment_method: string | null
  payment_status: string
  bank_id: string | null
  bank_name: string | null
  invoice_type: string | null
  invoice_number: string | null
  invoice_cae: string | null
  invoice_status?: string
  invoiced_amount?: string
  notes: string | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  status: string
  stock_added?: boolean
  created_at: string
}

interface Enterprise { id: string; name: string; cuit: string | null }
interface Bank { id: string; bank_name: string }
interface ProductOption {
  id: string
  name: string
  sku: string
  pricing?: { cost: string; final_price: string; vat_rate?: string }
}

// ----- Retenciones (practicadas al proveedor al registrar la compra) -----

interface RetencionRow {
  type: string
  enabled: boolean
  base_amount: number
  rate: number
  amount: number
  regime: string
  jurisdiction?: string
  certificate_number?: string
}

const RETENCION_LABELS: Record<string, string> = {
  iibb: 'IIBB',
  ganancias: 'Ganancias',
  iva: 'IVA',
  suss: 'SUSS',
}

const INITIAL_RETENCIONES: RetencionRow[] = [
  { type: 'iibb', enabled: false, base_amount: 0, rate: 3.0, amount: 0, regime: '', jurisdiction: '' },
  { type: 'ganancias', enabled: false, base_amount: 0, rate: 2.0, amount: 0, regime: '' },
  { type: 'iva', enabled: false, base_amount: 0, rate: 0, amount: 0, regime: '' },
  { type: 'suss', enabled: false, base_amount: 0, rate: 0, amount: 0, regime: '' },
]

// ----- Constants -----

const PAYMENT_METHODS = [
  { value: '', label: 'Sin especificar' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
]

const VAT_RATE_OPTIONS = [
  { value: 0, label: '0%' },
  { value: 10.5, label: '10.5%' },
  { value: 21, label: '21%' },
  { value: 27, label: '27%' },
]

// Logical status used for the badges/filters (derived from backend fields).
const LOGICAL_STATUS_OPTIONS = [
  { value: 'pendiente', label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'recibida', label: 'Recibida', color: 'bg-green-100 text-green-800' },
  { value: 'parcial', label: 'Parcial', color: 'bg-blue-100 text-blue-800' },
  { value: 'anulada', label: 'Anulada', color: 'bg-red-100 text-red-800' },
]

const deriveLogicalStatus = (p: Purchase): 'pendiente' | 'recibida' | 'parcial' | 'anulada' => {
  if ((p.status || '').toLowerCase() === 'cancelada' || (p.status || '').toLowerCase() === 'anulada') return 'anulada'
  if (p.invoice_status === 'parcial') return 'parcial'
  if (p.stock_added) return 'recibida'
  return 'pendiente'
}

const emptyItem = (): PurchaseItem => ({
  product_id: '',
  product_name: '',
  description: '',
  quantity: 1,
  unit_price: 0,
  vat_rate: 21,
  add_to_stock: true,
})

// ----- Component -----

export const Purchases: React.FC = () => {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [availableProducts, setAvailableProducts] = useState<ProductOption[]>([])
  const businessUnits = useBusinessUnitStore(s => s.units)
  const businessUnitsLoaded = useBusinessUnitStore(s => s.loaded)

  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<Purchase | null>(null)

  // Filters
  const [filterEnterprise, setFilterEnterprise] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterBU, setFilterBU] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const searchRef = useRef(search)
  searchRef.current = search
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [summaryPeriod, setSummaryPeriod] = useState('mes')

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Modals / actions
  const [anularTarget, setAnularTarget] = useState<Purchase | null>(null)
  const [anularReason, setAnularReason] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [receivingId, setReceivingId] = useState<string | null>(null)

  // Context menu
  const contextMenu = useContextMenu<Purchase>()

  // Form state
  const [form, setForm] = useState({
    enterprise_id: '',
    business_unit_id: '',
    date: toLocalYMD(new Date()),
    payment_method: '',
    bank_id: '',
    notes: '',
    invoice_type: '',
    invoice_number: '',
    invoice_cae: '',
    add_to_inventory: true,
  })
  const [items, setItems] = useState<PurchaseItem[]>([emptyItem()])

  // Retenciones practicadas (collapsible, opt-in)
  const [retenciones, setRetenciones] = useState<RetencionRow[]>(INITIAL_RETENCIONES)
  const [retencionesOpen, setRetencionesOpen] = useState(false)

  // ----- Load data -----

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [purchRes, entRes, bankRes, prodRes] = await Promise.all([
        api.getPurchases({
          enterprise_id: filterEnterprise.length === 1 ? filterEnterprise[0] : undefined,
          business_unit_id: filterBU.length === 1 ? filterBU[0] : undefined,
        }).catch((err: any) => {
          setError(`Error cargando compras: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return []
        }),
        api.getEnterprises().catch(() => []),
        api.getBanks().catch(() => []),
        api.getProducts().catch(() => ({ items: [] })),
      ])
      setPurchases(Array.isArray(purchRes) ? purchRes : purchRes?.items || [])
      setEnterprises(Array.isArray(entRes) ? entRes : entRes?.items || [])
      setBanks(Array.isArray(bankRes) ? bankRes : bankRes?.items || [])
      setAvailableProducts(Array.isArray(prodRes) ? prodRes : prodRes?.items || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterEnterprise, filterBU])

  useEffect(() => { loadData() }, [loadData])

  // Lazy-load business units if not loaded yet
  useEffect(() => {
    if (!businessUnitsLoaded) {
      api.getBusinessUnits()
        .then((data: any[]) => useBusinessUnitStore.getState().setUnits(data || []))
        .catch(() => useBusinessUnitStore.getState().setUnits([]))
    }
  }, [businessUnitsLoaded])

  // ----- Form helpers (per-item totals & VAT breakdown) -----

  const itemSubtotal = (it: PurchaseItem) => (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)

  const totals = useMemo(() => {
    let neto = 0
    const vatByRate: Record<number, number> = {}
    let vatTotal = 0
    for (const it of items) {
      const sub = itemSubtotal(it)
      neto += sub
      const rate = Number(it.vat_rate) || 0
      const vat = sub * rate / 100
      vatByRate[rate] = (vatByRate[rate] || 0) + vat
      vatTotal += vat
    }
    return {
      neto: Math.round(neto * 100) / 100,
      vatByRate,
      vatTotal: Math.round(vatTotal * 100) / 100,
      total: Math.round((neto + vatTotal) * 100) / 100,
    }
  }, [items])

  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (idx: number) => setItems(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))

  // Retenciones handlers (mirrors Pagos)
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
  const updateItem = (idx: number, field: keyof PurchaseItem, value: any) => {
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const handleProductSelect = (idx: number, productId: string) => {
    const prod = availableProducts.find(p => p.id === productId)
    setItems(prev => {
      const next = [...prev]
      if (prod) {
        next[idx] = {
          ...next[idx],
          product_id: productId,
          product_name: prod.name,
          unit_price: parseFloat(prod.pricing?.cost || '0') || 0,
          vat_rate: parseFloat(prod.pricing?.vat_rate || '21') || 21,
        }
      } else {
        next[idx] = { ...next[idx], product_id: productId }
      }
      return next
    })
  }

  // ----- Form open/close -----

  const resetForm = () => {
    setForm({
      enterprise_id: '',
      business_unit_id: '',
      date: toLocalYMD(new Date()),
      payment_method: '',
      bank_id: '',
      notes: '',
      invoice_type: '',
      invoice_number: '',
      invoice_cae: '',
      add_to_inventory: true,
    })
    setItems([emptyItem()])
    setRetenciones(INITIAL_RETENCIONES)
    setRetencionesOpen(false)
    setEditingId(null)
  }

  const openCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    resetForm()
  }

  const handleEdit = async (purchase: Purchase) => {
    try {
      const detail = await api.getPurchase(purchase.id)
      setForm({
        enterprise_id: detail.enterprise_id || '',
        business_unit_id: detail.business_unit_id || '',
        date: detail.date ? toLocalYMD(new Date(detail.date)) : toLocalYMD(new Date()),
        payment_method: detail.payment_method || '',
        bank_id: detail.bank_id || '',
        notes: detail.notes || '',
        invoice_type: detail.invoice_type || '',
        invoice_number: detail.invoice_number || '',
        invoice_cae: detail.invoice_cae || '',
        add_to_inventory: false,
      })
      setItems((detail.items || []).map((i: any) => ({
        product_id: i.product_id || '',
        product_name: i.product_name || '',
        description: i.description || '',
        quantity: (parseInt(String(i.quantity ?? '1'), 10) || 1).toString(),
        unit_price: i.unit_price?.toString() || '0',
        vat_rate: parseFloat(i.vat_rate?.toString() || '21') || 21,
        add_to_stock: false,
      })) || [emptyItem()])
      setEditingId(purchase.id)
      setShowForm(true)
    } catch (e: any) {
      toast.error('Error al cargar compra: ' + e.message)
    }
  }

  const handleDuplicate = async (purchase: Purchase) => {
    try {
      const detail = await api.getPurchase(purchase.id)
      setForm({
        enterprise_id: detail.enterprise_id || '',
        business_unit_id: detail.business_unit_id || '',
        date: toLocalYMD(new Date()),
        payment_method: detail.payment_method || '',
        bank_id: detail.bank_id || '',
        notes: detail.notes || '',
        invoice_type: '',
        invoice_number: '',
        invoice_cae: '',
        add_to_inventory: true,
      })
      setItems((detail.items || []).map((i: any) => ({
        product_id: i.product_id || '',
        product_name: i.product_name || '',
        description: i.description || '',
        quantity: (parseInt(String(i.quantity ?? '1'), 10) || 1).toString(),
        unit_price: i.unit_price?.toString() || '0',
        vat_rate: parseFloat(i.vat_rate?.toString() || '21') || 21,
        add_to_stock: true,
      })) || [emptyItem()])
      setEditingId(null)
      setShowForm(true)
      toast.success(`Compra #${String(purchase.purchase_number || 0).padStart(4, '0')} duplicada — revisa y guarda`)
    } catch (e: any) {
      toast.error('Error al duplicar: ' + e.message)
    }
  }

  // ----- Submit -----

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = items.filter(i => (i.product_name || '').trim())
    if (validItems.length === 0) {
      setError('Agrega al menos un item con nombre')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        enterprise_id: form.enterprise_id || null,
        business_unit_id: form.business_unit_id || null,
        date: form.date || null,
        payment_method: form.payment_method || null,
        bank_id: form.bank_id || null,
        notes: form.notes || null,
        invoice_type: form.invoice_type || null,
        invoice_number: form.invoice_number || null,
        invoice_cae: form.invoice_cae || null,
        add_to_inventory: form.add_to_inventory,
        items: validItems.map(i => ({
          product_id: i.product_id && i.product_id !== 'custom' ? i.product_id : null,
          product_name: i.product_name,
          description: i.description || null,
          quantity: parseInt(String(i.quantity), 10) || 0,
          unit_price: Number(i.unit_price) || 0,
          vat_rate: Number(i.vat_rate) || 0,
          add_to_stock: i.add_to_stock !== false,
        })),
        retenciones: retenciones
          .filter(r => r.enabled && r.amount > 0)
          .map(r => ({
            type: r.type,
            base_amount: r.base_amount,
            rate: r.rate,
            amount: r.amount,
            regime: r.regime || null,
            jurisdiction: r.type === 'iibb' ? (r.jurisdiction || null) : (r.jurisdiction || undefined),
            certificate_number: r.certificate_number || null,
          })),
      }
      let result: any
      if (editingId) {
        result = await api.updatePurchase(editingId, payload)
        toast.success('Compra actualizada')
      } else {
        result = await api.createPurchase(payload)
        toast.success('Compra registrada')
      }
      if (form.add_to_inventory && result?.stock_updated) {
        toast.success('Stock actualizado automaticamente')
      } else if (form.add_to_inventory && result?.stock_error) {
        toast.error(result.stock_error)
      }
      closeForm()
      await loadData()
    } catch (e: any) {
      const msg = e?.response?.data?.error || e.message || 'Error al guardar compra'
      toast.error(msg)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  // ----- Anular (delete) -----

  const openAnular = (p: Purchase) => {
    setAnularTarget(p)
    setAnularReason('')
  }

  const confirmAnular = async () => {
    if (!anularTarget) return
    if (!anularReason.trim()) {
      toast.error('El motivo es requerido')
      return
    }
    setAnulando(true)
    try {
      // Reason sent in body for forward-compat. Backend currently ignores but accepts.
      await (api as any).deletePurchase(anularTarget.id, { reason: anularReason.trim() })
      toast.success('Compra anulada — movimientos de stock revertidos')
      setAnularTarget(null)
      setAnularReason('')
      await loadData()
    } catch (e: any) {
      const msg = e?.response?.data?.error || e.message || 'Error al anular'
      toast.error(msg)
    } finally {
      setAnulando(false)
    }
  }

  // ----- Recibir (mark as received + apply stock) -----

  const handleRecibir = async (purchase: Purchase) => {
    if (purchase.stock_added) {
      toast.error('Esta compra ya fue recibida (stock aplicado)')
      return
    }
    try {
      setReceivingId(purchase.id)
      let detail = purchase
      if (!purchase.items || purchase.items.length === 0) {
        detail = await api.getPurchase(purchase.id)
      }
      const stockItems = (detail.items || [])
        .map((i: any) => ({
          product_id: i.product_id || '',
          quantity: parseInt(String(i.quantity || '0'), 10) || 0,
        }))
        .filter((i: any) => i.product_id && i.quantity > 0)

      if (stockItems.length === 0) {
        toast.error('No hay items con productos asociados — nada para recibir')
        return
      }

      await api.addStockFromPurchase(purchase.id, stockItems)
      toast.success('Compra recibida — stock actualizado')
      await loadData()
    } catch (e: any) {
      const msg = e?.response?.data?.error || e.message || 'Error al recibir compra'
      toast.error(msg)
    } finally {
      setReceivingId(null)
    }
  }

  // ----- Filters / pagination / KPIs -----

  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, filterStatus, filterBU, dateFrom, dateTo, search, pageSize])

  const filteredPurchases = useMemo(() => {
    let result = purchases
    if (dateFrom) result = result.filter(p => toLocalYMD(p.date) >= dateFrom)
    if (dateTo) result = result.filter(p => toLocalYMD(p.date) <= dateTo)
    if (filterEnterprise.length > 0) result = result.filter(p => p.enterprise_id && filterEnterprise.includes(p.enterprise_id))
    if (filterBU.length > 0) result = result.filter(p => p.business_unit_id && filterBU.includes(p.business_unit_id))
    if (filterStatus.length > 0) result = result.filter(p => filterStatus.includes(deriveLogicalStatus(p)))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(p =>
        String(p.purchase_number || '').includes(q) ||
        (p.enterprise_name || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q) ||
        (p.invoice_number || '').toLowerCase().includes(q) ||
        (p.items || []).some(it => (it.product_name || '').toLowerCase().includes(q))
      )
    }
    return result
  }, [purchases, dateFrom, dateTo, filterEnterprise, filterBU, filterStatus, search])

  // KPIs scoped to current month (rolling) regardless of date filter
  const kpis = useMemo(() => {
    const now = new Date()
    const monthStart = toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1))
    const monthEnd = toLocalYMD(now)
    const inMonth = purchases.filter(p => {
      const d = toLocalYMD(p.date)
      return d >= monthStart && d <= monthEnd
    })
    const compradoMes = inMonth
      .filter(p => deriveLogicalStatus(p) !== 'anulada')
      .reduce((sum, p) => sum + parseFloat(p.total_amount || '0'), 0)
    const cantidadCompras = inMonth.filter(p => deriveLogicalStatus(p) !== 'anulada').length
    const pendienteRecibir = purchases.filter(p => deriveLogicalStatus(p) === 'pendiente').length
    const anuladasMes = inMonth.filter(p => deriveLogicalStatus(p) === 'anulada').length
    return { compradoMes, cantidadCompras, pendienteRecibir, anuladasMes }
  }, [purchases])

  const totalPages = Math.ceil(filteredPurchases.length / pageSize)
  const paginatedPurchases = filteredPurchases.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = filterEnterprise.length > 0 || filterStatus.length > 0 || filterBU.length > 0 || !!dateFrom || !!dateTo || !!search

  const csvColumns = [
    { key: 'purchase_number', label: 'N° Compra' },
    { key: 'date', label: 'Fecha', type: 'date' as const },
    { key: 'enterprise_name', label: 'Proveedor' },
    { key: 'business_unit_name', label: 'BU' },
    { key: 'item_count', label: 'Items', type: 'number' as const },
    { key: 'total_amount', label: 'Total', type: 'currency' as const },
    { key: 'status', label: 'Estado' },
    { key: 'payment_method', label: 'Metodo de Pago' },
  ]

  const clearFilters = () => {
    setFilterEnterprise([])
    setFilterStatus([])
    setFilterBU([])
    setDateFrom('')
    setDateTo('')
    setSearch('')
  }

  const showBankSelector = form.payment_method === 'transferencia' || form.payment_method === 'cheque'

  // Stock impact preview lines
  const stockImpactLines = useMemo(() => {
    if (!form.add_to_inventory) return []
    return items
      .filter(i => i.product_id && i.product_id !== 'custom' && i.add_to_stock !== false && Number(i.quantity) > 0)
      .map(i => {
        const prod = availableProducts.find(p => p.id === i.product_id)
        return `${prod?.name || i.product_name}: +${Number(i.quantity)} unid.`
      })
  }, [items, form.add_to_inventory, availableProducts])

  // ----- Row expansion -----

  const toggleExpand = async (purchaseId: string) => {
    if (expandedPurchase === purchaseId) {
      setExpandedPurchase(null)
      setExpandedDetail(null)
      return
    }
    setExpandedPurchase(purchaseId)
    try {
      const detail = await api.getPurchase(purchaseId)
      setExpandedDetail(detail)
    } catch {
      setExpandedDetail(null)
    }
  }

  // ----- Render -----

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Compras</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{purchases.length} compra{purchases.length !== 1 ? 's' : ''} registrada{purchases.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={filteredPurchases} columns={csvColumns} filename="compras" />
          <ExportExcelButton data={filteredPurchases} columns={csvColumns} filename="compras" />
          <PermissionGate module="purchases" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => showForm ? closeForm() : openCreate()}>
              {showForm ? 'Cancelar' : '+ Nueva Compra'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold" aria-label="Cerrar error">x</button>
        </div>
      )}

      {/* Period selector */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">Periodo:</span>
        <PeriodSelector selected={summaryPeriod} onChange={p => {
          setSummaryPeriod(p.value)
          setDateFrom(p.dateFrom)
          setDateTo(p.dateTo)
        }} />
      </div>

      {/* KPI cards (always reflect current month) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-orange-700 dark:text-orange-400 truncate">Comprado mes</p>
            <p className="text-lg md:text-xl font-bold text-orange-800 dark:text-orange-300 truncate">{formatCurrency(kpis.compradoMes)}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-blue-700 dark:text-blue-400 truncate">Cantidad compras</p>
            <p className="text-lg md:text-xl font-bold text-blue-800 dark:text-blue-300 truncate">{kpis.cantidadCompras}</p>
          </CardContent>
        </Card>
        <Card className="border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-yellow-700 dark:text-yellow-400 truncate">Pendiente recibir</p>
            <p className="text-lg md:text-xl font-bold text-yellow-800 dark:text-yellow-300 truncate">{kpis.pendienteRecibir}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-red-700 dark:text-red-400 truncate">Anuladas mes</p>
            <p className="text-lg md:text-xl font-bold text-red-800 dark:text-red-300 truncate">{kpis.anuladasMes}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MultiSelectFilter
              label="Proveedor"
              options={enterprises.map(e => ({ value: e.id, label: e.name }))}
              selected={filterEnterprise}
              onChange={setFilterEnterprise}
              placeholder="Todos"
            />
            <MultiSelectFilter
              label="Estado"
              options={LOGICAL_STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
              selected={filterStatus}
              onChange={setFilterStatus}
              placeholder="Todos"
            />
            <MultiSelectFilter
              label="Razon social"
              options={businessUnits.map(b => ({ value: b.id, label: b.name }))}
              selected={filterBU}
              onChange={setFilterBU}
              placeholder="Todas"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Buscar</label>
              <input
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                placeholder="N°, proveedor, producto..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <DateRangeFilter
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onClear={() => { setDateFrom(''); setDateTo('') }}
                label="Fecha"
              />
            </div>
          </div>
          {isFiltered && (
            <div className="mt-2 flex justify-end">
              <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">Limpiar filtros</button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----- Form ----- */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">{editingId ? 'Editar Compra' : 'Nueva Compra'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Proveedor</label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}{ent.cuit ? ` (${ent.cuit})` : ''}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Razon social<HelpTip text="Razon social emisora de la compra. Si solo tenes una, se asigna automaticamente." /></label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.business_unit_id} onChange={e => setForm({ ...form, business_unit_id: e.target.value })}>
                    <option value="">Por defecto</option>
                    {businessUnits.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}{b.is_fiscal ? ' (Fiscal)' : ''}</option>)}
                  </select>
                </div>
                <DateInput label="Fecha" value={form.date} onChange={val => setForm({ ...form, date: val })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Metodo de Pago</label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                {showBankSelector && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Banco</label>
                    <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.bank_id} onChange={e => setForm({ ...form, bank_id: e.target.value })}>
                      <option value="">Seleccionar banco...</option>
                      {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Optional invoice metadata */}
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Factura recibida (opcional)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm text-gray-600 dark:text-gray-400">Tipo</label>
                    <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                      <option value="">Sin factura</option>
                      <option value="A">Factura A</option>
                      <option value="B">Factura B</option>
                      <option value="C">Factura C</option>
                    </select>
                  </div>
                  {form.invoice_type && (
                    <>
                      <Input label="N° Comprobante" placeholder="00003-00000012" value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} />
                      <Input label="CAE" placeholder="73012345678901" value={form.invoice_cae} onChange={e => setForm({ ...form, invoice_cae: e.target.value })} />
                    </>
                  )}
                </div>
              </div>

              {/* Items */}
              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Items de la Compra</h4>
                  <button type="button" onClick={addItem} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
                    + Agregar Item
                  </button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-12 md:col-span-3">
                          <label className="text-xs font-medium text-gray-500">Producto</label>
                          <select
                            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                            value={item.product_id || ''}
                            onChange={e => handleProductSelect(idx, e.target.value)}
                          >
                            <option value="">Seleccionar producto...</option>
                            {availableProducts.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                            <option value="custom">Producto manual...</option>
                          </select>
                          {(!item.product_id || item.product_id === 'custom') && (
                            <Input className="mt-1" placeholder="Nombre del producto" value={item.product_name} onChange={e => updateItem(idx, 'product_name', e.target.value)} />
                          )}
                        </div>
                        <div className="col-span-12 md:col-span-3">
                          <label className="text-xs font-medium text-gray-500">Descripcion</label>
                          <Input placeholder="Descripcion" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                        </div>
                        <div className="col-span-4 md:col-span-1">
                          <label className="text-xs font-medium text-gray-500">Cant.</label>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="1"
                            value={(() => {
                              const n = parseInt(String(item.quantity), 10)
                              return Number.isNaN(n) ? '' : String(n)
                            })()}
                            onChange={e => {
                              const raw = e.target.value
                              if (raw === '') {
                                updateItem(idx, 'quantity', '')
                                return
                              }
                              const n = parseInt(raw, 10)
                              updateItem(idx, 'quantity', Number.isNaN(n) ? 1 : n)
                            }}
                          />
                        </div>
                        <div className="col-span-4 md:col-span-2">
                          <label className="text-xs font-medium text-gray-500">P. Unit.</label>
                          <Input type="number" step="0.01" placeholder="0" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} />
                        </div>
                        <div className="col-span-3 md:col-span-1">
                          <label className="text-xs font-medium text-gray-500">IVA</label>
                          <select
                            className="w-full px-1.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                            value={Number(item.vat_rate)}
                            onChange={e => updateItem(idx, 'vat_rate', parseFloat(e.target.value))}
                          >
                            {VAT_RATE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                          </select>
                        </div>
                        <div className="col-span-9 md:col-span-1 text-right">
                          <label className="text-xs font-medium text-gray-500">Sub.</label>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{formatCurrency(itemSubtotal(item))}</p>
                        </div>
                        <div className="col-span-1 flex items-end justify-end">
                          {items.length > 1 && (
                            <button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-lg px-2" aria-label="Eliminar item">x</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Retenciones practicadas (collapsible, opt-in) */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
                <button
                  type="button"
                  onClick={() => setRetencionesOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg"
                  aria-expanded={retencionesOpen}
                >
                  <span>
                    Retenciones practicadas
                    {totalRetenciones > 0 && (
                      <span className="ml-2 text-sm text-amber-600 font-normal">
                        (${totalRetenciones.toFixed(2)})
                      </span>
                    )}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-500 transition-transform ${retencionesOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </button>
                {retencionesOpen && (
                  <div className="px-4 pb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      Retenciones aplicadas al proveedor en esta compra (Ganancias, IVA, IIBB, SUSS).
                    </p>
                    <div className="space-y-2">
                      {retenciones.map((ret, idx) => (
                        <div key={ret.type}>
                          <div className="flex items-center gap-3 flex-wrap">
                            <input
                              type="checkbox"
                              checked={ret.enabled}
                              onChange={() => handleRetencionToggle(idx)}
                              className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span className="w-24 text-sm font-medium text-gray-700 dark:text-gray-300">
                              {RETENCION_LABELS[ret.type]}
                            </span>
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
                            <div className="grid grid-cols-2 gap-2 mt-1 ml-7">
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
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {totalRetenciones > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-end text-sm text-gray-700 dark:text-gray-300">
                        <span>Total retenciones: <b>$ {totalRetenciones.toFixed(2)}</b></span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Inventory toggle + stock impact preview */}
              <div className="border-t pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.add_to_inventory}
                    onChange={e => setForm({ ...form, add_to_inventory: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                    {editingId ? 'Ajustar inventario con los cambios' : 'Sumar al inventario automaticamente'}
                    <HelpTip text="Si esta activo, los items con producto asociado incrementan stock al guardar." />
                  </span>
                </label>

                {form.add_to_inventory && stockImpactLines.length > 0 && (
                  <div className="mt-2 ml-6 p-2 rounded bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
                    <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-1">
                      Esta compra incrementara stock en:
                    </p>
                    <ul className="text-xs text-green-700 dark:text-green-400 space-y-0.5">
                      {stockImpactLines.map((line, i) => <li key={i}>• {line}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {/* Totals + actions */}
              <div className="border-t pt-4 flex flex-col md:flex-row justify-between gap-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-0.5">
                  <div>Neto: <strong>{formatCurrency(totals.neto)}</strong></div>
                  {Object.entries(totals.vatByRate)
                    .filter(([, v]) => Math.abs(v) > 0.001)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([rate, v]) => (
                      <div key={rate}>IVA {rate}%: <strong>{formatCurrency(v)}</strong></div>
                    ))}
                  <div className="text-lg text-green-700 dark:text-green-400 font-bold">Total: {formatCurrency(totals.total)}</div>
                </div>
                <div className="flex flex-col gap-2 md:items-end">
                  <textarea
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm resize-y w-full md:w-72 bg-white dark:bg-gray-700 dark:text-gray-100"
                    rows={2}
                    placeholder="Notas..."
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                  />
                  <Button type="submit" variant="success" loading={saving}>
                    {editingId ? 'Guardar Cambios' : 'Crear Compra'}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ----- Table ----- */}
      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={7} /></CardContent></Card>
      ) : filteredPurchases.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title={isFiltered ? 'No hay compras con estos filtros' : 'No hay compras registradas'}
            description={isFiltered ? 'Probá ajustando los filtros de busqueda' : 'Registra la primera compra para empezar'}
            actionLabel={isFiltered ? 'Limpiar filtros' : '+ Nueva Compra'}
            onAction={isFiltered ? clearFilters : openCreate}
          />
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 text-left text-sm font-medium text-gray-500 dark:text-gray-300">
                  <th className="px-4 py-3">N°</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">BU</th>
                  <th className="px-4 py-3 text-center">Items</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPurchases.map(purchase => {
                  const logical = deriveLogicalStatus(purchase)
                  const statusOpt = LOGICAL_STATUS_OPTIONS.find(s => s.value === logical)!
                  const isAnulada = logical === 'anulada'
                  const rowBase = expandedPurchase === purchase.id
                    ? 'bg-orange-50 dark:bg-orange-900/20 border-b-0'
                    : 'border-b dark:border-gray-700'
                  const rowStyle = isAnulada
                    ? `${rowBase} bg-red-50 dark:bg-red-900/20 line-through text-gray-500`
                    : rowBase
                  return (
                    <React.Fragment key={purchase.id}>
                      <tr
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${rowStyle}`}
                        onClick={() => toggleExpand(purchase.id)}
                        onContextMenu={(e) => contextMenu.openMenu(e, purchase)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-orange-700 dark:text-orange-400">
                            #{String(purchase.purchase_number || 0).padStart(4, '0')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{formatDate(purchase.date)}</td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{purchase.enterprise_name || '-'}</p>
                            {purchase.enterprise_cuit && <p className="text-xs text-gray-500">{purchase.enterprise_cuit}</p>}
                            <TagBadges tags={purchase.enterprise_tags || []} size="sm" />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                          {purchase.business_unit_name || businessUnits.find(b => b.id === purchase.business_unit_id)?.name || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300">
                            {purchase.item_count} item{Number(purchase.item_count) !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold ${isAnulada ? 'text-gray-500' : 'text-red-700 dark:text-red-400'}`}>
                            {formatCurrency(parseFloat(purchase.total_amount || '0'))}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`text-xs font-medium rounded-full px-2 py-1 inline-block ${statusOpt.color}`}>
                            {statusOpt.label}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {expandedPurchase === purchase.id && (
                        <tr>
                          <td colSpan={7} className="px-0 py-0 border-b-2 border-orange-300">
                            <div className="mx-3 my-3 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg shadow-sm overflow-hidden">
                              <div className="border-l-4 border-orange-500 px-4 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-orange-800 dark:text-orange-300 border-b border-orange-200 pb-1">Items</h4>
                                    {expandedDetail?.items && expandedDetail.items.length > 0 ? (
                                      <div className="space-y-1.5">
                                        {expandedDetail.items.map((item: any, idx: number) => (
                                          <div key={idx} className="bg-white dark:bg-gray-800 rounded px-2 py-1.5 border border-orange-100 dark:border-orange-900/40">
                                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.product_name}</p>
                                            {item.description && <p className="text-xs text-gray-500">{item.description}</p>}
                                            <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                              <span>Cant: {item.quantity}</span>
                                              <span>P/U: {formatCurrency(parseFloat(item.unit_price || '0'))}</span>
                                              <span>IVA: {parseFloat(item.vat_rate || '21')}%</span>
                                              <span className="font-medium text-gray-800 dark:text-gray-200">Sub: {formatCurrency(parseFloat(item.subtotal || '0'))}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-gray-400">{purchase.item_count} item(s) — cargando...</p>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                      <div>
                                        <p className="text-xs text-gray-500">Subtotal</p>
                                        <p className="text-sm font-medium">{formatCurrency(parseFloat(purchase.subtotal || '0'))}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-gray-500">IVA</p>
                                        <p className="text-sm font-medium">{formatCurrency(parseFloat(purchase.vat_amount || '0'))}</p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-orange-800 dark:text-orange-300 border-b border-orange-200 pb-1">Proveedor y Detalles</h4>
                                    <div>
                                      <p className="text-xs text-gray-500">Proveedor</p>
                                      <p className="text-sm font-medium">{purchase.enterprise_name || 'Sin proveedor'}</p>
                                      {purchase.enterprise_cuit && <p className="text-xs text-gray-500 font-mono">{purchase.enterprise_cuit}</p>}
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">Razon social</p>
                                      <p className="text-sm">{purchase.business_unit_name || businessUnits.find(b => b.id === purchase.business_unit_id)?.name || '-'}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">Fecha</p>
                                      <p className="text-sm">{formatDate(purchase.date)}</p>
                                    </div>
                                    {purchase.notes && (
                                      <div>
                                        <p className="text-xs text-gray-500">Notas</p>
                                        <p className="text-sm bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded">{purchase.notes}</p>
                                      </div>
                                    )}
                                  </div>

                                  <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-orange-800 dark:text-orange-300 border-b border-orange-200 pb-1">Estado y Stock</h4>
                                    <div>
                                      <p className="text-xs text-gray-500">Estado</p>
                                      <span className={`text-xs font-medium rounded-full px-2 py-1 inline-block ${statusOpt.color}`}>{statusOpt.label}</span>
                                    </div>
                                    <div>
                                      <p className="text-xs text-gray-500">Pago</p>
                                      <p className="text-sm">{PAYMENT_METHODS.find(m => m.value === purchase.payment_method)?.label || 'Sin especificar'}</p>
                                    </div>
                                    {purchase.invoice_type && (
                                      <div>
                                        <p className="text-xs text-gray-500">Comprobante</p>
                                        <span className="font-mono text-sm font-semibold text-purple-800 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 px-2 py-1 rounded inline-block mt-0.5">
                                          {purchase.invoice_type} {purchase.invoice_number || ''}
                                        </span>
                                      </div>
                                    )}
                                    {!isAnulada && (
                                      <PermissionGate module="inventory" action="create">
                                        {purchase.stock_added ? (
                                          <div className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-center">
                                            Recibida — stock aplicado
                                          </div>
                                        ) : (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleRecibir(purchase) }}
                                            disabled={receivingId === purchase.id}
                                            className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                                          >
                                            {receivingId === purchase.id ? 'Recibiendo...' : 'Marcar como recibida'}
                                          </button>
                                        )}
                                      </PermissionGate>
                                    )}
                                  </div>
                                </div>
                              </div>
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
            totalItems={filteredPurchases.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      {/* ----- Anular Modal ----- */}
      {anularTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Anular compra #{String(anularTarget.purchase_number || 0).padStart(4, '0')}
            </h3>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 px-3 py-2 rounded text-sm text-yellow-800 dark:text-yellow-300">
              <strong>Atencion:</strong> Se revertirán los movimientos de stock asociados a esta compra. Esta accion no se puede deshacer.
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Motivo de anulacion <span className="text-red-500">*</span></label>
              <textarea
                className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                rows={3}
                placeholder="Ej: Mercaderia no recibida, error de carga..."
                value={anularReason}
                onChange={e => setAnularReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setAnularTarget(null); setAnularReason('') }}
                disabled={anulando}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmAnular}
                disabled={anulando || !anularReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {anulando ? 'Anulando...' : 'Anular compra'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----- Context menu ----- */}
      {contextMenu.menu && (() => {
        const purchase = contextMenu.menu.item
        const logical = deriveLogicalStatus(purchase)
        const isAnulada = logical === 'anulada'
        const items: ContextMenuItem[] = []

        items.push({
          id: 'ver',
          label: 'Ver detalle',
          onClick: () => toggleExpand(purchase.id),
        })

        if (!isAnulada) {
          items.push({
            id: 'editar',
            label: 'Editar',
            onClick: () => handleEdit(purchase),
          })
        }

        items.push({
          id: 'duplicar',
          label: 'Duplicar',
          onClick: () => handleDuplicate(purchase),
        })

        if (!isAnulada && !purchase.stock_added) {
          items.push({ id: 'sep1', label: '', separator: true })
          items.push({
            id: 'recibir',
            label: 'Marcar como recibida',
            onClick: () => handleRecibir(purchase),
          })
        }

        items.push({ id: 'sep2', label: '', separator: true })

        items.push({
          id: 'imprimir',
          label: 'Imprimir / PDF',
          onClick: () => window.print(),
        })

        if (!isAnulada) {
          items.push({ id: 'sep3', label: '', separator: true })
          items.push({
            id: 'anular',
            label: 'Anular compra',
            danger: true,
            onClick: () => openAnular(purchase),
          })
        }

        return (
          <ContextMenuBase
            x={contextMenu.menu.x}
            y={contextMenu.menu.y}
            header={{
              title: `#${String(purchase.purchase_number || 0).padStart(4, '0')} - ${purchase.enterprise_name || 'Sin proveedor'}`,
              subtitle: formatCurrency(parseFloat(purchase.total_amount || '0')),
            }}
            items={items}
            onClose={contextMenu.closeMenu}
          />
        )
      })()}
    </div>
  )
}

export default Purchases
