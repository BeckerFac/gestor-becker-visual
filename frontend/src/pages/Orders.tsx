import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { InvoicePreviewModal } from '@/components/shared/InvoicePreviewModal'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { TagBadges } from '@/components/shared/TagBadges'
import { useInvoicePreview } from '@/hooks/useInvoicePreview'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { HelpTip } from '@/components/shared/HelpTip'

interface Order {
  id: string
  order_number: number
  title: string
  description: string | null
  product_type: string
  status: string
  priority: string
  quantity: number
  unit_price: string
  total_amount: string
  vat_rate: string
  estimated_profit: string
  estimated_delivery: string | null
  actual_delivery: string | null
  has_invoice: boolean
  payment_method: string | null
  payment_status: string
  notes: string | null
  production_started_at: string | null
  customer?: { id: string; name: string; cuit: string }
  enterprise?: { id: string; name: string } | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  invoice?: { id: string; invoice_number: number; invoice_type: string; status: string; punto_venta?: number; cae?: string } | null
  bank?: { id: string; bank_name: string } | null
  quote?: { id: string; quote_number: number } | null
  cobro?: { id: string; amount: string; payment_method: string } | null
  invoiced_amount?: string
  invoice_status?: string
  created_at: string
}

interface Customer { id: string; name: string; cuit: string; enterprise_id?: string | null }
interface Product { id: string; name: string; sku: string; pricing?: { cost: string; final_price: string; vat_rate: string }; category?: string; category_id?: string | null; product_type?: string | null }
interface Enterprise { id: string; name: string; cuit?: string | null; price_list_id?: string | null }
interface Bank { id: string; bank_name: string }
interface Category { id: string; name: string; parent_id: string | null; color?: string | null; product_count?: number; child_product_count?: number }

interface FormItem {
  product_id: string
  product_name: string
  description: string
  quantity: number
  unit_price: number
  cost: number
  product_type: string
  deduct_stock: boolean
  category_ids: string[]
}

interface InvoicingStatusData {
  invoicing_status: 'sin_facturar' | 'parcial' | 'facturado'
  invoices: Array<{
    id: string
    invoice_number: number
    invoice_type: string
    status: string
    punto_venta?: number
    cae?: string
    fiscal_type?: string
    total_amount: string
  }>
  items: Array<{
    id: string
    product_name: string
    quantity: number
    invoiced_qty: number
    pending_qty: number
    unit_price: string
    vat_rate?: string
  }>
}

// Default types as fallback - actual types loaded from DB per company
const DEFAULT_PRODUCT_TYPES = [
  'portabanner', 'bandera', 'ploteo', 'carteleria', 'vinilo',
  'lona', 'backing', 'senaletica', 'vehicular', 'textil', 'otro', 'mixto',
]

const STATUS_OPTIONS = [
  { value: 'todos', label: 'Todos', color: '' },
  { value: 'pendiente', label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'en_produccion', label: 'En Produccion', color: 'bg-blue-100 text-blue-800' },
  { value: 'en_pausa', label: 'En Pausa', color: 'bg-gray-100 text-gray-800 dark:text-gray-200' },
  { value: 'terminado', label: 'Terminado', color: 'bg-green-100 text-green-800' },
  { value: 'entregado', label: 'Entregado', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'cancelado', label: 'Cancelado', color: 'bg-red-100 text-red-800' },
]

const PAYMENT_METHODS = [
  { value: '', label: 'Sin especificar' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
]

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  baja: { label: 'Baja', color: 'text-gray-500' },
  normal: { label: 'Normal', color: 'text-blue-600' },
  alta: { label: 'Alta', color: 'text-orange-600' },
  urgente: { label: 'Urgente', color: 'text-red-600 font-bold' },
}

const INVOICE_TYPES = ['A', 'B', 'C']

const emptyFormItem = (): FormItem => ({
  product_id: '',
  product_name: '',
  description: '',
  quantity: 1,
  unit_price: 0,
  cost: 0,
  product_type: 'otro',
  deduct_stock: true,
  category_ids: [],
})

const ORDER_DRAFT_KEY = 'bv_order_draft'

export const Orders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [productTypes, setProductTypes] = useState<string[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [openCatDropdown, setOpenCatDropdown] = useState<number | null>(null)
  const [showNewBankInput, setShowNewBankInput] = useState(false)
  const [newBankName, setNewBankName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<any>({})
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)

  // Invoicing state per order
  const [invoicingStatus, setInvoicingStatus] = useState<Record<string, InvoicingStatusData>>({})
  const [invoicingLoading, setInvoicingLoading] = useState<Record<string, boolean>>({})
  const [showInvoiceForm, setShowInvoiceForm] = useState<Record<string, boolean>>({})
  const [invoiceType, setInvoiceType] = useState<Record<string, string>>({})
  const [invoiceQtys, setInvoiceQtys] = useState<Record<string, Record<string, number>>>({})
  const [creatingInvoice, setCreatingInvoice] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deletingOrder, setDeletingOrder] = useState(false)

  // Filters
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterType, setFilterType] = useState<string[]>([])
  const [filterEnterprise, setFilterEnterprise] = useState<string[]>([])
  const [filterInvoice, setFilterInvoice] = useState<string[]>([])
  const [filterPayment, setFilterPayment] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const searchRef = useRef(search)
  searchRef.current = search
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [summaryPeriod, setSummaryPeriod] = useState('mes')

  // Form
  const [formEnterpriseId, setFormEnterpriseId] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [form, setForm] = useState({
    description: '', customer_id: '',
    vat_rate: '21', estimated_delivery: '',
    priority: 'normal', notes: '', payment_method: '', bank_id: '',
  })
  const [formItems, setFormItems] = useState<FormItem[]>([emptyFormItem()])
  const [hasDraft, setHasDraft] = useState(false)

  // Price criteria
  const [priceCriteriaList, setPriceCriteriaList] = useState<{ id: string; name: string }[]>([])
  const [selectedPriceCriteria, setSelectedPriceCriteria] = useState('')
  const [criteriaProductPricesCache, setCriteriaProductPricesCache] = useState<Record<string, Record<string, number>>>({})

  // Persist form draft to localStorage (only if form has meaningful content)
  useEffect(() => {
    if (showForm && !editingOrderId) {
      const hasContent = form.description || form.customer_id || formEnterpriseId || formTitle ||
        formItems.some(i => i.product_name || i.product_id)
      if (hasContent) {
        const draft = JSON.stringify({ form, formItems, formEnterpriseId, formTitle })
        localStorage.setItem(ORDER_DRAFT_KEY, draft)
        setHasDraft(true)
      }
    }
  }, [showForm, editingOrderId, form, formItems, formEnterpriseId, formTitle])

  // Restore draft when opening form (only for new orders, not edits)
  useEffect(() => {
    if (showForm && !editingOrderId) {
      const saved = localStorage.getItem(ORDER_DRAFT_KEY)
      if (saved) {
        try {
          const draft = JSON.parse(saved)
          if (draft.form) setForm(draft.form)
          if (draft.formItems?.length) setFormItems(draft.formItems.map((item: any) => ({ ...emptyFormItem(), ...item, category_ids: item.category_ids || [] })))
          if (draft.formEnterpriseId) setFormEnterpriseId(draft.formEnterpriseId)
          if (draft.formTitle) setFormTitle(draft.formTitle)
          setHasDraft(true)
        } catch { /* ignore corrupt data */ }
      }
    }
  }, [showForm, editingOrderId])

  // Check if draft exists on mount
  useEffect(() => {
    setHasDraft(!!localStorage.getItem(ORDER_DRAFT_KEY))
  }, [])

  const clearDraft = () => {
    localStorage.removeItem(ORDER_DRAFT_KEY)
    setHasDraft(false)
    setForm({ description: '', customer_id: '', vat_rate: '21', estimated_delivery: '', priority: 'normal', notes: '', payment_method: '', bank_id: '', })
    setFormItems([emptyFormItem()])
    setFormEnterpriseId('')
    setFormTitle('')
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [ordersRes, custRes, prodRes, entRes, banksRes, typesRes, criteriaRes, categoriesRes] = await Promise.all([
        api.getOrders({
          status: filterStatus.length === 1 ? filterStatus[0] : undefined,
          product_type: filterType.length === 1 ? filterType[0] : undefined,
          enterprise_id: filterEnterprise.length === 1 ? filterEnterprise[0] : undefined,
          has_invoice: filterInvoice.length === 1 ? filterInvoice[0] : undefined,
          search: searchRef.current || undefined,
        }).catch((err: any) => {
          setError(`Error cargando pedidos: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return { items: [], summary: {} }
        }),
        api.getCustomers().catch(() => ({ items: [] })),
        api.getProducts().catch(() => ({ items: [] })),
        api.getEnterprises().catch(() => []),
        api.getBanks().catch(() => []),
        api.getProductTypes().catch(() => []),
        api.getPriceCriteria().catch(() => []),
        api.getCategories().catch(() => []),
      ])
      setOrders(ordersRes.items || [])
      setSummary(ordersRes.summary || {})
      // Extract type names from structured response (objects with name property) or plain strings
      const typeNames = Array.isArray(typesRes)
        ? typesRes.map((t: any) => typeof t === 'string' ? t : t.name).filter(Boolean)
        : []
      setProductTypes(typeNames)
      setCustomers(custRes.items || custRes || [])
      setProducts(prodRes.items || prodRes || [])
      setEnterprises(entRes || [])
      setBanks(banksRes || [])
      setPriceCriteriaList(Array.isArray(criteriaRes) ? criteriaRes : [])
      setCategories(Array.isArray(categoriesRes) ? categoriesRes : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterType, filterEnterprise, filterInvoice])

  useEffect(() => { loadData() }, [loadData])

  // Close category dropdown on click outside
  useEffect(() => {
    if (openCatDropdown === null) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest(`[data-cat-dropdown]`)) {
        setOpenCatDropdown(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openCatDropdown])

  const handleSearch = () => loadData()

  // --- Form items management ---

  const addFormItem = () => {
    setFormItems(prev => [...prev, emptyFormItem()])
  }

  // Track price resolution info per item
  const [priceResolutions, setPriceResolutions] = useState<Record<number, { base_price: number; resolved_price: number; discount_percent: number; rule_applied: string | null; price_list_name: string | null }>>({})

  // Quantity tiers per item
  const [quantityTiers, setQuantityTiers] = useState<Record<number, { min_quantity: number; price: number; discount_percent: number }[]>>({})
  const [manualPriceOverride, setManualPriceOverride] = useState<Record<number, boolean>>({})

  const loadQuantityTiers = async (productId: string, idx: number, enterpriseId: string) => {
    if (!enterpriseId || !productId) return
    try {
      // Use enterprise from state to get price_list_id
      const ent = enterprises.find(e => e.id === enterpriseId)
      if (!ent?.price_list_id) return
      const tiers = await api.getQuantityTiers(ent.price_list_id, productId)
      if (Array.isArray(tiers) && tiers.length > 0) {
        setQuantityTiers(prev => ({ ...prev, [idx]: tiers }))
      } else {
        setQuantityTiers(prev => { const next = { ...prev }; delete next[idx]; return next })
      }
    } catch { /* ignore - tiers not available */ }
  }

  const resolveProductPrice = async (productId: string, quantity: number, idx: number) => {
    if (!formEnterpriseId || !productId) return null
    try {
      const resolution = await api.resolvePrice({
        enterprise_id: formEnterpriseId,
        product_id: productId,
        quantity: quantity,
      })
      if (resolution && resolution.price_list_name) {
        setPriceResolutions(prev => ({ ...prev, [idx]: resolution }))
        return resolution
      }
    } catch { /* ignore */ }
    return null
  }

  const updateFormItem = (idx: number, field: keyof FormItem, value: string | number | string[]) => {
    setFormItems(prev => {
      const updated = [...prev]
      const item = { ...updated[idx] }

      if (field === 'product_id') {
        const productId = value as string
        item.product_id = productId
        if (productId && productId !== 'custom') {
          const product = products.find(p => p.id === productId)
          if (product) {
            item.product_name = product.name
            item.unit_price = parseFloat(product.pricing?.final_price || '0') || 0
            item.cost = parseFloat(product.pricing?.cost || '0') || 0
            item.product_type = (product as any).category_name || (product as any).product_type || 'otro'
            setManualPriceOverride(prev => ({ ...prev, [idx]: false }))

            // If a price criteria is selected, try to use criteria price
            if (selectedPriceCriteria) {
              const cached = criteriaProductPricesCache[productId]
              if (cached && cached[selectedPriceCriteria] !== undefined) {
                item.unit_price = cached[selectedPriceCriteria]
              } else {
                // Load from API
                api.getProductPrices(productId).then(prices => {
                  const priceMap: Record<string, number> = {}
                  for (const pp of (Array.isArray(prices) ? prices : [])) {
                    priceMap[pp.criteria_name] = parseFloat(pp.price) || 0
                  }
                  setCriteriaProductPricesCache(prev => ({ ...prev, [productId]: priceMap }))
                  if (priceMap[selectedPriceCriteria] !== undefined) {
                    setFormItems(prevItems => {
                      const newItems = [...prevItems]
                      newItems[idx] = { ...newItems[idx], unit_price: priceMap[selectedPriceCriteria] }
                      return newItems
                    })
                  }
                }).catch(() => {})
              }
            } else {
              // Try to resolve price from enterprise's price list
              resolveProductPrice(productId, item.quantity || 1, idx).then(resolution => {
                if (resolution && resolution.resolved_price > 0) {
                  setFormItems(prevItems => {
                    const newItems = [...prevItems]
                    newItems[idx] = { ...newItems[idx], unit_price: resolution.resolved_price }
                    return newItems
                  })
                }
              })
            }
            // Load quantity tiers
            loadQuantityTiers(productId, idx, formEnterpriseId)
          }
        } else if (productId === 'custom') {
          item.product_name = ''
          item.unit_price = 0
          item.cost = 0
          setQuantityTiers(prev => { const next = { ...prev }; delete next[idx]; return next })
        }
      } else if (field === 'quantity') {
        const newQty = typeof value === 'string' ? parseFloat(value) || 0 : typeof value === 'number' ? value : 0
        item.quantity = newQty
        // Re-resolve price when quantity changes (quantity breaks) - only if not manually overridden
        if (item.product_id && item.product_id !== 'custom' && !manualPriceOverride[idx]) {
          resolveProductPrice(item.product_id, newQty, idx).then(resolution => {
            if (resolution && resolution.resolved_price > 0) {
              setFormItems(prevItems => {
                const newItems = [...prevItems]
                newItems[idx] = { ...newItems[idx], unit_price: resolution.resolved_price }
                return newItems
              })
            }
          })
        }
      } else if (field === 'unit_price' || field === 'cost') {
        (item as any)[field] = typeof value === 'string' ? parseFloat(value) || 0 : value
        // If user manually overrides unit_price, mark it
        if (field === 'unit_price') {
          setManualPriceOverride(prev => ({ ...prev, [idx]: true }))
          setPriceResolutions(prev => {
            const existing = prev[idx]
            if (existing) {
              return { ...prev, [idx]: { ...existing, rule_applied: 'Precio modificado manualmente' } }
            }
            return prev
          })
        }
      } else {
        (item as any)[field] = value
      }

      updated[idx] = item
      return updated
    })
  }

  const removeFormItem = (idx: number) => {
    setFormItems(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
  }

  const getFormItemSubtotal = (item: FormItem) => item.quantity * item.unit_price

  const getFormTotals = () => {
    const subtotal = formItems.reduce((sum, item) => sum + getFormItemSubtotal(item), 0)
    const vat = subtotal * (parseFloat(form.vat_rate) || 0) / 100
    return { subtotal, vat, total: subtotal + vat }
  }

  // --- Order creation ---

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formItems.length === 0 || formItems.every(i => !i.product_name)) {
      setError('Agrega al menos un item con nombre al pedido')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const totals = getFormTotals()
      // Derive order-level product_type from items (show all types instead of 'mixto')
      const itemTypes = [...new Set(formItems.map(i => i.product_type || 'otro'))]
      const orderProductType = itemTypes.join(', ')
      const payload = {
        title: formTitle || formItems[0]?.product_name || 'Pedido',
        description: form.description || null,
        product_type: orderProductType,
        customer_id: form.customer_id || null,
        enterprise_id: formEnterpriseId || null,
        bank_id: form.bank_id || null,
        quantity: formItems.reduce((sum, i) => sum + i.quantity, 0),
        unit_price: formItems[0]?.unit_price || 0,
        vat_rate: parseFloat(form.vat_rate),
        total_amount: totals.total,
        estimated_delivery: form.estimated_delivery || null,
        priority: form.priority,
        payment_method: form.payment_method || null,
        notes: form.notes || null,
        items: formItems.map(item => ({
          product_id: item.product_id && item.product_id !== 'custom' ? item.product_id : null,
          product_name: item.product_name,
          description: item.description || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          cost: item.cost || 0,
          product_type: item.product_type || 'otro',
          deduct_stock: item.deduct_stock || false,
        })),
      }
      if (editingOrderId) {
        await api.updateOrder(editingOrderId, payload)
        toast.success('Pedido actualizado')
      } else {
        await api.createOrder(payload)
        toast.success('Pedido creado')
      }
      setShowForm(false)
      setEditingOrderId(null)
      localStorage.removeItem(ORDER_DRAFT_KEY)
      setHasDraft(false)
      setFormEnterpriseId('')
      setFormTitle('')
      setForm({ description: '', customer_id: '', vat_rate: '21', estimated_delivery: '', priority: 'normal', notes: '', payment_method: '', bank_id: '', })
      setFormItems([emptyFormItem()])
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEditOrder = (order: Order) => {
    const status = invoicingStatus[order.id]
    const orderItems: FormItem[] = (status?.items || []).map((item: any) => ({
      product_id: item.product_id || 'custom',
      product_name: item.product_name || '',
      description: item.description || '',
      quantity: Number(item.quantity) || 1,
      unit_price: parseFloat(item.unit_price?.toString() || '0'),
      cost: parseFloat(item.cost?.toString() || '0'),
      product_type: item.product_type || 'otro',
      deduct_stock: item.deduct_stock || false,
      category_ids: [],
    }))

    setEditingOrderId(order.id)
    setFormTitle(order.title || '')
    setForm({
      description: order.description || '',
      customer_id: order.customer?.id || '',
      vat_rate: order.vat_rate?.toString() || '21',
      estimated_delivery: order.estimated_delivery || '',
      priority: order.priority || 'normal',
      notes: order.notes || '',
      payment_method: order.payment_method || '',
      bank_id: order.bank?.id || '',
    })
    setFormEnterpriseId(order.enterprise?.id || '')
    setFormItems(orderItems.length > 0 ? orderItems : [emptyFormItem()])
    setShowForm(true)
  }

  // --- Status / payment handlers ---

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      if (newStatus === 'en_produccion') {
        try {
          const bomCheck = await api.checkOrderBOM(orderId)
          if (!bomCheck.available) {
            const missing = (Array.isArray(bomCheck.items) ? bomCheck.items : []).filter((i: any) => !i.sufficient)
              .map((i: any) => `${i.product_name}: necesita ${i.required}, hay ${i.available}`)
              .join('\n')
            const proceed = window.confirm(`Atencion: No hay stock suficiente para algunos materiales:\n\n${missing}\n\nDesea continuar de todas formas?`)
            if (!proceed) return
          }
        } catch { /* BOM check failed, proceed anyway */ }
      }
      await api.updateOrderStatus(orderId, { status: newStatus })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleCreateInlineBank = async () => {
    if (!newBankName.trim()) return
    try {
      const newBank = await api.createBank({ bank_name: newBankName.trim() })
      setBanks(prev => [...prev, newBank])
      setForm(prev => ({ ...prev, bank_id: newBank.id }))
      setShowNewBankInput(false)
      setNewBankName('')
      toast.success('Banco creado')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Error creando banco')
    }
  }

  const handlePaymentMethodChange = async (orderId: string, method: string) => {
    try {
      await api.updateOrder(orderId, { payment_method: method || null })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handlePaymentStatusChange = async (orderId: string, newStatus: string) => {
    try {
      await api.updateOrder(orderId, { payment_status: newStatus })
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDeleteOrder = async () => {
    if (!deleteTarget) return
    setDeletingOrder(true)
    try {
      await api.deleteOrder(deleteTarget)
      toast.success('Pedido eliminado')
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeletingOrder(false)
      setDeleteTarget(null)
    }
  }

  // --- Expand / invoicing ---

  const loadInvoicingStatus = useCallback(async (orderId: string) => {
    setInvoicingLoading(prev => ({ ...prev, [orderId]: true }))
    try {
      const data = await api.getOrderInvoicingStatus(orderId)
      setInvoicingStatus(prev => ({ ...prev, [orderId]: data }))
      // Initialize invoice qtys from pending quantities
      const qtys: Record<string, number> = {}
      for (const item of (data.items || [])) {
        qtys[item.id] = item.pending_qty
      }
      setInvoiceQtys(prev => ({ ...prev, [orderId]: qtys }))
      setInvoiceType(prev => prev[orderId] ? prev : { ...prev, [orderId]: 'B' })
    } catch {
      // Silently fail - invoicing status not critical
    } finally {
      setInvoicingLoading(prev => ({ ...prev, [orderId]: false }))
    }
  }, [])

  // Production timer state
  const [timerTick, setTimerTick] = useState(0)
  const [editingTimer, setEditingTimer] = useState<string | null>(null)
  const [editTimerValue, setEditTimerValue] = useState('')

  useEffect(() => {
    const interval = setInterval(() => setTimerTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  const formatElapsedTime = (startDate: string, endDate?: string | null) => {
    const start = new Date(startDate).getTime()
    const end = endDate ? new Date(endDate).getTime() : Date.now()
    const diffMs = Math.max(0, end - start)
    const totalMinutes = Math.floor(diffMs / 60000)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)
    const minutes = totalMinutes % 60
    const parts: string[] = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0 || days > 0) parts.push(`${hours}h`)
    parts.push(`${minutes}m`)
    return parts.join(' ')
  }

  const handleProductionStartedAtChange = async (orderId: string, value: string) => {
    try {
      await api.updateOrder(orderId, { production_started_at: value || null })
      setEditingTimer(null)
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const toggleExpand = (orderId: string) => {
    const willExpand = expandedOrder !== orderId
    setExpandedOrder(prev => prev === orderId ? null : orderId)
    if (willExpand) {
      loadInvoicingStatus(orderId)
    }
  }

  const handleShowInvoiceForm = (orderId: string) => {
    setShowInvoiceForm(prev => ({ ...prev, [orderId]: !prev[orderId] }))
  }

  const handleInvoiceQtyChange = (orderId: string, itemId: string, qty: number, max: number) => {
    const clamped = Math.max(0, Math.min(qty, max))
    setInvoiceQtys(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || {}), [itemId]: clamped },
    }))
  }

  const [invoiceProgress, setInvoiceProgress] = useState<Record<string, string>>({})

  // Invoice preview hook
  const invoicePreview = useInvoicePreview({
    onError: (msg) => setError(msg),
    onDataRefresh: useCallback(async () => { await loadData() }, [loadData]),
    loadInvoicingStatus,
  })

  const handleCreateInvoice = async (orderId: string) => {
    const status = invoicingStatus[orderId]
    if (!status) return
    if (creatingInvoice[orderId]) return
    const qtys = invoiceQtys[orderId] || {}
    const selectedItems = (status.items || [])
      .filter(item => (qtys[item.id] || 0) > 0)
      .map(item => ({
        order_item_id: item.id,
        quantity: qtys[item.id] || 0,
        product_name: item.product_name || '',
        unit_price: item.unit_price?.toString() || '0',
        vat_rate: item.vat_rate?.toString() || '21',
      }))
    if (selectedItems.length === 0) {
      setError('Selecciona al menos un item con cantidad mayor a 0 para facturar')
      return
    }
    setCreatingInvoice(prev => ({ ...prev, [orderId]: true }))
    setInvoiceProgress(prev => ({ ...prev, [orderId]: 'Creando borrador...' }))
    setError(null)
    try {
      const invoice = await api.createInvoice({
        order_id: orderId,
        invoice_type: invoiceType[orderId] || 'B',
        items: selectedItems,
      })
      setShowInvoiceForm(prev => ({ ...prev, [orderId]: false }))
      await loadInvoicingStatus(orderId)
      await invoicePreview.openPreview(invoice.id, orderId)
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setCreatingInvoice(prev => ({ ...prev, [orderId]: false }))
      setInvoiceProgress(prev => ({ ...prev, [orderId]: '' }))
    }
  }

  const handleCreateNoFiscalInvoice = async (orderId: string) => {
    const status = invoicingStatus[orderId]
    if (!status) return
    if (creatingInvoice[orderId]) return
    const qtys = invoiceQtys[orderId] || {}
    const selectedItems = (status.items || [])
      .filter(item => (qtys[item.id] || 0) > 0)
      .map(item => ({
        order_item_id: item.id,
        quantity: qtys[item.id] || 0,
        product_name: item.product_name || '',
        unit_price: item.unit_price?.toString() || '0',
        vat_rate: '0',
      }))
    if (selectedItems.length === 0) {
      setError('Selecciona al menos un item con cantidad mayor a 0 para facturar')
      return
    }
    setCreatingInvoice(prev => ({ ...prev, [orderId]: true }))
    setInvoiceProgress(prev => ({ ...prev, [orderId]: 'Creando comprobante no fiscal...' }))
    setError(null)
    try {
      await api.createInvoice({
        order_id: orderId,
        fiscal_type: 'no_fiscal',
        items: selectedItems,
      })
      setShowInvoiceForm(prev => ({ ...prev, [orderId]: false }))
      await loadInvoicingStatus(orderId)
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setCreatingInvoice(prev => ({ ...prev, [orderId]: false }))
      setInvoiceProgress(prev => ({ ...prev, [orderId]: '' }))
    }
  }

  const getStatusBadge = (status: string) => {
    const s = STATUS_OPTIONS.find(o => o.value === status)
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s?.color || 'bg-gray-100 text-gray-800 dark:text-gray-200'}`}>{s?.label || status}</span>
  }

  const showBankSelector = form.payment_method === 'transferencia' || form.payment_method === 'cheque'

  useEffect(() => { setCurrentPage(1) }, [filterStatus, filterType, filterEnterprise, filterInvoice, filterPayment, dateFrom, dateTo, pageSize])

  // Client-side date filter + pagination
  const filteredOrders = useMemo(() => {
    let result = orders
    if (filterStatus.length > 0) result = result.filter(o => filterStatus.includes(o.status))
    if (filterType.length > 0) result = result.filter(o => {
      const types = (o.product_type || 'otro').split(', ').map((t: string) => t.trim())
      return types.some((t: string) => filterType.includes(t))
    })
    if (filterEnterprise.length > 0) result = result.filter(o => o.enterprise && filterEnterprise.includes(o.enterprise.id))
    if (filterInvoice.length > 0) {
      result = result.filter(o => {
        if (filterInvoice.includes('si') && o.has_invoice) return true
        if (filterInvoice.includes('no') && !o.has_invoice) return true
        return false
      })
    }
    if (filterPayment.length > 0) {
      result = result.filter(o => filterPayment.includes(o.payment_status))
    }
    if (dateFrom) result = result.filter(o => {
      const d = o.created_at ? new Date(o.created_at).toISOString().split('T')[0] : ''
      return d >= dateFrom
    })
    if (dateTo) result = result.filter(o => {
      const d = o.created_at ? new Date(o.created_at).toISOString().split('T')[0] : ''
      return d <= dateTo
    })
    return result
  }, [orders, filterStatus, filterType, filterEnterprise, filterInvoice, filterPayment, dateFrom, dateTo])

  const periodSummary = useMemo(() => {
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    let pFrom = '', pTo = today
    if (summaryPeriod === 'hoy') { pFrom = today }
    else if (summaryPeriod === 'semana') { const d = new Date(now); const dow = now.getDay(); d.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); pFrom = d.toISOString().split('T')[0] }
    else if (summaryPeriod === 'mes') { pFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0] }
    else if (summaryPeriod === '3meses') { pFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0] }
    else if (summaryPeriod === 'anual') { pFrom = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0] }

    const filtered = pFrom ? orders.filter(o => o.created_at >= pFrom) : orders
    return {
      pendientes: filtered.filter(o => o.status === 'pendiente').length,
      en_produccion: filtered.filter(o => o.status === 'en_produccion').length,
      terminados: filtered.filter(o => o.status === 'terminado').length,
      entregados: filtered.filter(o => o.status === 'entregado').length,
      total_facturado: filtered.reduce((s, o) => s + (parseFloat(o.invoiced_amount?.toString() || '0')), 0),
      total: filtered.length,
    }
  }, [orders, summaryPeriod])

  const totalPages = Math.ceil(filteredOrders.length / pageSize)
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const getDeliveryBadge = (order: any) => {
    if (!order.estimated_delivery || order.status === 'entregado' || order.status === 'cancelado') return null
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const delivery = new Date(order.estimated_delivery)
    delivery.setHours(0, 0, 0, 0)
    const diffMs = delivery.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', label: `Vencido (${Math.abs(diffDays)}d)` }
    if (diffDays === 0) return { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', label: 'Hoy' }
    if (diffDays === 1) return { className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', label: 'Manana' }
    if (diffDays <= 7) return { className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', label: `${diffDays}d` }
    return { className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', label: `${diffDays}d` }
  }

  const isFiltered = filterStatus.length > 0 || filterType.length > 0 || filterEnterprise.length > 0 || filterInvoice.length > 0 || filterPayment.length > 0 || !!search || !!dateFrom || !!dateTo

  const csvColumns = [
    { key: 'order_number', label: 'N° Pedido' },
    { key: 'created_at', label: 'Fecha', type: 'date' as const },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'title', label: 'Producto' },
    { key: 'total_amount', label: 'Total', type: 'currency' as const },
    { key: 'payment_status', label: 'Estado Pago' },
    { key: 'status', label: 'Estado' },
    { key: 'payment_method', label: 'Metodo de Pago' },
  ]
  const csvData = filteredOrders.map(o => ({
    order_number: `#${String(o.order_number).padStart(4, '0')}`,
    created_at: o.created_at,
    enterprise_name: o.enterprise?.name || o.customer?.name || '',
    title: o.title || '',
    total_amount: parseFloat(o.total_amount?.toString() || '0'),
    payment_status: o.payment_status || '',
    status: o.status || '',
    payment_method: o.payment_method || '',
  }))

  const clearFilters = () => {
    setFilterStatus([])
    setFilterType([])
    setFilterEnterprise([])
    setFilterInvoice([])
    setFilterPayment([])
    setSearch('')
    setDateFrom('')
    setDateTo('')
  }

  const formTotals = getFormTotals()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pedidos / Ventas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{summary.total || 0} pedidos registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={csvColumns} filename="pedidos" />
          <ExportExcelButton data={csvData} columns={csvColumns} filename="pedidos" />
          {hasDraft && !showForm && (
            <button onClick={() => { setShowForm(true) }} className="text-sm text-blue-600 hover:underline">
              Continuar borrador
            </button>
          )}
          {showForm && hasDraft && (
            <button onClick={clearDraft} className="text-sm text-red-600 hover:underline">
              Limpiar borrador
            </button>
          )}
          <PermissionGate module="orders" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => {
              if (showForm) {
                setShowForm(false)
                setEditingOrderId(null)
                clearDraft()
              } else {
                setShowForm(true)
              }
            }}>
              {showForm ? 'Cancelar' : '+ Nuevo Pedido'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold" aria-label="Cerrar error">x</button>
        </div>
      )}

      {/* Period Selector + Summary Cards */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">Resumen:</span>
        <PeriodSelector selected={summaryPeriod} onChange={p => {
          setSummaryPeriod(p.value)
          setDateFrom(p.dateFrom)
          setDateTo(p.dateTo)
        }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-yellow-700 dark:text-yellow-400 truncate">Pendientes</p>
            <p className="text-lg md:text-xl font-bold text-yellow-800 dark:text-yellow-300 truncate">{periodSummary.pendientes}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-blue-700 dark:text-blue-400 truncate">En Produccion</p>
            <p className="text-lg md:text-xl font-bold text-blue-800 dark:text-blue-300 truncate">{periodSummary.en_produccion}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-green-700 dark:text-green-400 truncate">Terminados</p>
            <p className="text-lg md:text-xl font-bold text-green-800 dark:text-green-300 truncate">{periodSummary.terminados}</p>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-emerald-700 dark:text-emerald-400 truncate">Entregados</p>
            <p className="text-lg md:text-xl font-bold text-emerald-800 dark:text-emerald-300 truncate">{periodSummary.entregados}</p>
          </CardContent>
        </Card>
        <Card className="border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40">
          <CardContent className="pt-3 pb-2 overflow-hidden">
            <p className="text-xs text-indigo-700 dark:text-indigo-400 truncate">Facturado</p>
            <p className="text-lg md:text-xl font-bold text-indigo-800 dark:text-indigo-300 truncate">{formatCurrency(periodSummary.total_facturado)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MultiSelectFilter
              label="Estado"
              options={STATUS_OPTIONS.filter(s => s.value !== 'todos').map(s => ({ value: s.value, label: s.label }))}
              selected={filterStatus}
              onChange={setFilterStatus}
              placeholder="Todos"
            />
            <MultiSelectFilter
              label="Tipo"
              options={[...new Set([...DEFAULT_PRODUCT_TYPES, ...productTypes])].map(t => ({ value: t, label: t }))}
              selected={filterType}
              onChange={setFilterType}
              placeholder="Todos"
            />
            <MultiSelectFilter
              label="Empresa"
              options={enterprises.map(ent => ({ value: ent.id, label: ent.name }))}
              selected={filterEnterprise}
              onChange={setFilterEnterprise}
              placeholder="Todas"
            />
            <MultiSelectFilter
              label="Pago"
              options={[{ value: 'pendiente', label: 'No pagado' }, { value: 'parcial', label: 'Parcial' }, { value: 'pagado', label: 'Pagado' }]}
              selected={filterPayment}
              onChange={setFilterPayment}
              placeholder="Todos"
            />
            <MultiSelectFilter
              label="Factura"
              options={[{ value: 'si', label: 'Con factura' }, { value: 'no', label: 'Sin factura' }]}
              selected={filterInvoice}
              onChange={setFilterInvoice}
              placeholder="Todos"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Buscar</label>
              <div className="flex gap-1">
                <input className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" placeholder="Producto, cliente..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
                <button onClick={handleSearch} className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Ir</button>
              </div>
            </div>
            <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onClear={() => { setDateFrom(''); setDateTo('') }} label="Fecha Creacion" />
          </div>
        </CardContent>
      </Card>

      {/* Create Order Form */}
      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">{editingOrderId ? 'Editar Pedido' : 'Nuevo Pedido'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleCreateOrder} className="space-y-4">

              {/* Enterprise + Customer selector */}
              <EnterpriseCustomerSelector
                enterprises={enterprises}
                customers={customers}
                selectedEnterpriseId={formEnterpriseId}
                selectedCustomerId={form.customer_id}
                onEnterpriseChange={id => setFormEnterpriseId(id)}
                onCustomerChange={id => setForm(f => ({ ...f, customer_id: id }))}
                enterpriseLabel="Empresa"
                customerLabel="Cliente / Contacto"
                enterpriseHelpText="Selecciona la empresa cliente. Si no aparece, creala desde Empresas."
              />

              {/* Title + Price Criteria */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del pedido<HelpTip text="Un nombre descriptivo para identificar este trabajo. Ej: 'Carteleria evento corporativo'." /></label>
                  <Input placeholder="Ej: Carteleria evento, Ploteo vehicular..." value={formTitle} onChange={e => setFormTitle(e.target.value)} />
                </div>
                {priceCriteriaList.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Lista de precios<HelpTip text="Al seleccionar una lista, los precios de los productos se ajustan automaticamente segun la lista elegida. Si no tiene precio en esa lista, usa el precio base." /></label>
                    <select
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={selectedPriceCriteria}
                      onChange={e => {
                        const criteria = e.target.value
                        setSelectedPriceCriteria(criteria)
                        // Re-apply prices to existing items
                        if (criteria) {
                          setFormItems(prevItems => {
                            return prevItems.map((item, idx) => {
                              if (!item.product_id || item.product_id === 'custom' || manualPriceOverride[idx]) return item
                              const cached = criteriaProductPricesCache[item.product_id]
                              if (cached && cached[criteria] !== undefined) {
                                return { ...item, unit_price: cached[criteria] }
                              }
                              // Fallback: load from API
                              const product = products.find(p => p.id === item.product_id)
                              api.getProductPrices(item.product_id).then(prices => {
                                const priceMap: Record<string, number> = {}
                                for (const pp of (Array.isArray(prices) ? prices : [])) {
                                  priceMap[pp.criteria_name] = parseFloat(pp.price) || 0
                                }
                                setCriteriaProductPricesCache(prev => ({ ...prev, [item.product_id]: priceMap }))
                                if (priceMap[criteria] !== undefined) {
                                  setFormItems(prev => {
                                    const updated = [...prev]
                                    updated[idx] = { ...updated[idx], unit_price: priceMap[criteria] }
                                    return updated
                                  })
                                }
                              }).catch(() => {})
                              return item
                            })
                          })
                        } else {
                          // Revert to base prices
                          setFormItems(prevItems => {
                            return prevItems.map((item, idx) => {
                              if (!item.product_id || item.product_id === 'custom' || manualPriceOverride[idx]) return item
                              const product = products.find(p => p.id === item.product_id)
                              if (product) {
                                return { ...item, unit_price: parseFloat(product.pricing?.final_price || '0') || 0 }
                              }
                              return item
                            })
                          })
                        }
                      }}
                    >
                      <option value="">Base (precio por defecto)</option>
                      {priceCriteriaList.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Descripcion general<HelpTip text="Detalles adicionales del trabajo que no van en los items individuales." /></label>
                  <Input placeholder="Detalles del trabajo..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>

              {/* Items section */}
              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Items del Pedido</h4>
                  <button type="button" onClick={addFormItem} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
                    + Agregar Item
                  </button>
                </div>

                <div className="space-y-3">
                  {formItems.map((item, idx) => (
                    <div key={idx} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                        {/* Product type / category filter */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Tipo/Categoria<HelpTip text="Selecciona una o mas categorias para filtrar los productos disponibles. Podes configurar categorias desde Productos > Categorias." /></label>
                          {categories.length > 0 ? (
                            <div className="relative" data-cat-dropdown>
                              <button
                                type="button"
                                className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 truncate"
                                onClick={() => setOpenCatDropdown(openCatDropdown === idx ? null : idx)}
                              >
                                {item.category_ids.length > 0
                                  ? item.category_ids.map(cid => categories.find(c => c.id === cid)?.name).filter(Boolean).join(', ')
                                  : 'Todas las categorias'}
                              </button>
                              {openCatDropdown === idx && (
                              <div
                                className="absolute z-50 mt-1 w-64 max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg"
                              >
                                {item.category_ids.length > 0 && (
                                  <button
                                    type="button"
                                    className="w-full px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-left border-b border-gray-100 dark:border-gray-700"
                                    onClick={() => {
                                      updateFormItem(idx, 'category_ids', [])
                                      updateFormItem(idx, 'product_type', 'otro')
                                    }}
                                  >
                                    Limpiar filtro
                                  </button>
                                )}
                                {categories.filter(c => !c.parent_id).map(parent => (
                                  <div key={parent.id}>
                                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={item.category_ids.includes(parent.id)}
                                        onChange={() => {
                                          const newIds = item.category_ids.includes(parent.id)
                                            ? item.category_ids.filter(id => id !== parent.id)
                                            : [...item.category_ids, parent.id]
                                          updateFormItem(idx, 'category_ids', newIds)
                                          const names = newIds.map(cid => categories.find(c => c.id === cid)?.name).filter(Boolean)
                                          updateFormItem(idx, 'product_type', names.join(', ') || 'otro')
                                        }}
                                        className="rounded border-gray-300"
                                      />
                                      <span className="text-sm font-medium" style={parent.color ? { color: parent.color } : undefined}>
                                        {parent.name}
                                      </span>
                                      {(parent.product_count || 0) > 0 && <span className="text-xs text-gray-400">({parent.product_count})</span>}
                                    </label>
                                    {categories.filter(c => c.parent_id === parent.id).map(child => (
                                      <label key={child.id} className="flex items-center gap-2 px-3 py-1.5 pl-8 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={item.category_ids.includes(child.id)}
                                          onChange={() => {
                                            const newIds = item.category_ids.includes(child.id)
                                              ? item.category_ids.filter(id => id !== child.id)
                                              : [...item.category_ids, child.id]
                                            updateFormItem(idx, 'category_ids', newIds)
                                            const names = newIds.map(cid => categories.find(c => c.id === cid)?.name).filter(Boolean)
                                            updateFormItem(idx, 'product_type', names.join(', ') || 'otro')
                                          }}
                                          className="rounded border-gray-300"
                                        />
                                        <span className="text-sm">{child.name}</span>
                                        {(child.product_count || 0) > 0 && <span className="text-xs text-gray-400">({child.product_count})</span>}
                                      </label>
                                    ))}
                                  </div>
                                ))}
                              </div>
                              )}
                            </div>
                          ) : (
                            <>
                              <input
                                list={`order-type-list-${idx}`}
                                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={item.product_type}
                                onChange={e => updateFormItem(idx, 'product_type', e.target.value)}
                                placeholder="Escribir o elegir..."
                              />
                              <datalist id={`order-type-list-${idx}`}>
                                {[...new Set([...DEFAULT_PRODUCT_TYPES, ...productTypes])].map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </datalist>
                            </>
                          )}
                        </div>
                        {/* Product selector */}
                        <div className="md:col-span-2 flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Producto</label>
                          <select
                            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={item.product_id}
                            onChange={e => updateFormItem(idx, 'product_id', e.target.value)}
                          >
                            <option value="">Seleccionar producto...</option>
                            {(() => {
                              const selectedCatIds = item.category_ids || []
                              const expandedCatIds = new Set(selectedCatIds)
                              selectedCatIds.forEach(cid => {
                                categories.filter(c => c.parent_id === cid).forEach(child => expandedCatIds.add(child.id))
                              })
                              const filtered = expandedCatIds.size > 0
                                ? products.filter(p => (p as any).category_id && expandedCatIds.has((p as any).category_id))
                                : products
                              return filtered.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.name}{p.pricing?.final_price ? ` (${formatCurrency(parseFloat(p.pricing.final_price))})` : ''}
                                </option>
                              ))
                            })()}
                            <option value="custom">Producto personalizado...</option>
                          </select>
                          {(!item.product_id || item.product_id === 'custom') && (
                            <input
                              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Nombre del producto/servicio"
                              value={item.product_name}
                              onChange={e => updateFormItem(idx, 'product_name', e.target.value)}
                              required
                            />
                          )}
                        </div>
                        {/* Quantity */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Cantidad</label>
                          <input
                            type="number" min="1"
                            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={item.quantity}
                            onChange={e => updateFormItem(idx, 'quantity', e.target.value)}
                            required
                          />
                        </div>
                        {/* Unit price */}
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-gray-500">Precio Unitario</label>
                          <input
                            type="number" step="0.01" min="0"
                            className={`px-2 py-1.5 border rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${priceResolutions[idx]?.price_list_name ? 'border-blue-400 dark:border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}
                            placeholder="0.00"
                            value={item.unit_price || ''}
                            onChange={e => updateFormItem(idx, 'unit_price', e.target.value)}
                            required
                          />
                          {selectedPriceCriteria && item.product_id && item.product_id !== 'custom' && !manualPriceOverride[idx] && (
                            <p className="text-xs text-purple-600 dark:text-purple-400">
                              Precio {selectedPriceCriteria}
                            </p>
                          )}
                          {!selectedPriceCriteria && priceResolutions[idx]?.price_list_name && (
                            <p className="text-xs text-blue-600 dark:text-blue-400">
                              {priceResolutions[idx].discount_percent !== 0
                                ? `Base: ${formatCurrency(priceResolutions[idx].base_price)} -> ${priceResolutions[idx].price_list_name}: ${formatCurrency(priceResolutions[idx].resolved_price)} (${priceResolutions[idx].discount_percent > 0 ? '-' : '+'}${Math.abs(priceResolutions[idx].discount_percent).toFixed(1)}%)`
                                : `${priceResolutions[idx].price_list_name}`}
                              {priceResolutions[idx].rule_applied === 'Precio modificado manualmente' && <span className="text-orange-500 dark:text-orange-400"> *manual</span>}
                            </p>
                          )}
                          {/* Quantity tiers display */}
                          {quantityTiers[idx] && quantityTiers[idx].length > 1 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {quantityTiers[idx].map((tier, tIdx) => {
                                const nextTier = quantityTiers[idx][tIdx + 1]
                                const rangeLabel = nextTier
                                  ? `${tier.min_quantity}-${nextTier.min_quantity - 1}`
                                  : `${tier.min_quantity}+`
                                const isActive = nextTier
                                  ? item.quantity >= tier.min_quantity && item.quantity < nextTier.min_quantity
                                  : item.quantity >= tier.min_quantity
                                return (
                                  <span
                                    key={tIdx}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${isActive ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-bold' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}
                                  >
                                    {rangeLabel}: {formatCurrency(tier.price)}
                                    {tier.discount_percent !== 0 && ` (${tier.discount_percent > 0 ? '-' : '+'}${Math.abs(tier.discount_percent).toFixed(0)}%)`}
                                  </span>
                                )
                              })}
                              {manualPriceOverride[idx] && (
                                <span className="text-[10px] text-orange-500 dark:text-orange-400 px-1">Precio manual - tiers no aplicados</span>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Cost tracked internally from product pricing, not shown to user */}
                        {/* Subtotal + remove */}
                        <div className="flex items-end gap-2">
                          <div className="flex-1 flex flex-col gap-1">
                            <label className="text-xs font-medium text-gray-500">Subtotal</label>
                            <div className="px-2 py-1.5 bg-green-50 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg text-sm font-bold text-green-800 dark:text-green-300">
                              {formatCurrency(getFormItemSubtotal(item))}
                            </div>
                          </div>
                          {formItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeFormItem(idx)}
                              className="px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors"
                              title="Eliminar item"
                            >
                              x
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Description + stock checkbox */}
                      <div className="mt-2 flex items-center gap-4">
                        <input
                          className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Descripcion adicional del item (opcional)"
                          value={item.description}
                          onChange={e => updateFormItem(idx, 'description', e.target.value)}
                        />
                        <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={item.deduct_stock}
                            onChange={e => {
                              setFormItems(prev => {
                                const updated = [...prev]
                                updated[idx] = { ...updated[idx], deduct_stock: e.target.checked }
                                return updated
                              })
                            }}
                            className="rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-500">Descontar stock<HelpTip text="Si esta activo, al crear el pedido se descuentan los materiales del inventario automaticamente." /></span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="mt-4 flex justify-end">
                  <div className="w-72 space-y-1">
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className="text-sm text-gray-600 dark:text-gray-400">% IVA:</span>
                      <input
                        type="number" step="0.01" placeholder="21"
                        list="order-vat-rate-list"
                        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm w-20 bg-white dark:bg-gray-700 dark:text-gray-100"
                        value={form.vat_rate}
                        onChange={e => setForm({ ...form, vat_rate: e.target.value })}
                      />
                      <datalist id="order-vat-rate-list">
                        <option value="0">0%</option>
                        <option value="10.5">10.5%</option>
                        <option value="21">21%</option>
                        <option value="27">27%</option>
                      </datalist>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                      <span>Subtotal Neto:</span>
                      <span className="font-medium">{formatCurrency(formTotals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                      <span>IVA ({form.vat_rate}%):</span>
                      <span className="font-medium">{formatCurrency(formTotals.vat)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold text-green-800 dark:text-green-400 pt-2 border-t border-gray-300 dark:border-gray-600">
                      <span>TOTAL:</span>
                      <span>{formatCurrency(formTotals.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment + delivery + priority */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Forma de Pago<HelpTip text="Como va a pagar el cliente. Podes cambiarlo despues." /></label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                {showBankSelector && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Banco</label>
                    <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.bank_id} onChange={e => {
                      if (e.target.value === '__new__') {
                        setShowNewBankInput(true)
                      } else {
                        setForm({ ...form, bank_id: e.target.value })
                        setShowNewBankInput(false)
                      }
                    }}>
                      <option value="">Seleccionar banco...</option>
                      {banks.map(b => <option key={b.id} value={b.id}>{b.bank_name}</option>)}
                      <option value="__new__">+ Crear nuevo banco...</option>
                    </select>
                    {showNewBankInput && (
                      <div className="flex gap-2 mt-1">
                        <input
                          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                          placeholder="Nombre del banco"
                          value={newBankName}
                          onChange={e => setNewBankName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateInlineBank() } }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={handleCreateInlineBank}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        >
                          Crear
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowNewBankInput(false); setNewBankName('') }}
                          className="px-2 py-1 text-gray-500 text-sm hover:text-gray-700 dark:text-gray-300"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <DateInput label="Fecha Estimada de Entrega" value={form.estimated_delivery} onChange={val => setForm({ ...form, estimated_delivery: val })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Prioridad<HelpTip text="Urgente sube el pedido en la cola de produccion." /></label>
                  <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                    <option value="baja">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </div>
                <Input label="Notas" placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>


              <Button type="submit" variant="success" loading={saving}>{editingOrderId ? 'Guardar Cambios' : 'Crear Pedido'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Orders Table with expandable rows */}
      {loading ? (
        <Card><CardContent><p className="text-center py-8 text-gray-500">Cargando pedidos...</p></CardContent></Card>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No hay pedidos con estos filtros' : 'No hay pedidos registrados'}
          description={isFiltered ? undefined : 'Crea el primer pedido para empezar'}
          variant={isFiltered ? 'filtered' : 'empty'}
          actionLabel={isFiltered ? 'Limpiar filtros' : '+ Nuevo Pedido'}
          onAction={isFiltered ? clearFilters : () => setShowForm(true)}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">N</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Facturado</th>
                  <th className="px-4 py-3 text-center">Pago</th>
                  <th className="px-4 py-3 text-center">Estado / Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.map(order => (
                  <React.Fragment key={order.id}>
                    {/* Compact row */}
                    <tr
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${expandedOrder === order.id ? 'bg-blue-50 dark:bg-blue-900/20 border-b-0' : 'border-b dark:border-gray-700'}`}
                      onClick={() => toggleExpand(order.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-blue-700 dark:text-blue-400">#{String(order.order_number || 0).padStart(4, '0')}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{formatDate(order.created_at)}</td>
                      <td className="px-4 py-3">
                        {order.enterprise ? (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{order.enterprise.name}</p>
                              <TagBadges tags={order.enterprise_tags || []} size="sm" />
                            </div>
                            {order.customer?.name && <p className="text-xs text-gray-500">{order.customer.name}</p>}
                          </div>
                        ) : (
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{order.customer?.name || 'Sin cliente'}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-sm">{order.title}</p>
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {(order.product_type || 'otro').split(', ').map((type: string, i: number) => (
                              <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                                {type.trim()}
                              </span>
                            ))}
                            {(() => {
                              const db = getDeliveryBadge(order)
                              return db ? <span className={`text-xs px-1.5 py-0.5 rounded ${db.className}`}>{db.label}</span> : null
                            })()}
                            {order.quote && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-mono">
                                Cot #{String(order.quote.quote_number || 0).padStart(4, '0')}
                              </span>
                            )}
                            {order.cobro && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                                Cobro: {formatCurrency(parseFloat(order.cobro.amount || '0'))}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-green-700 dark:text-green-400">{formatCurrency(parseFloat(order.total_amount || '0'))}</span>
                      </td>
                      {/* Facturado */}
                      <td className="px-4 py-2 text-center">
                        {(() => {
                          const invStatus = order.invoice_status || 'sin_facturar'
                          const invoicedAmt = parseFloat(order.invoiced_amount || '0')
                          const totalAmt = parseFloat(order.total_amount || '0')
                          if (invStatus === 'facturado') return <span className="text-xs font-medium rounded-full px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Completo</span>
                          if (invStatus === 'parcial') return (
                            <div>
                              <span className="text-xs font-medium rounded-full px-2 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">Parcial</span>
                              <p className="text-[10px] text-gray-400 mt-0.5">{formatCurrency(invoicedAmt)} / {formatCurrency(totalAmt)}</p>
                            </div>
                          )
                          return <span className="text-xs font-medium rounded-full px-2 py-1 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Sin facturar</span>
                        })()}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`text-xs font-medium rounded-full px-2 py-1 inline-block ${
                            order.payment_status === 'pagado'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                              : order.payment_status === 'parcial'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                          }`}
                        >
                          {order.payment_status === 'pagado' ? 'Pagado' : order.payment_status === 'parcial' ? 'Parcial' : 'No pagado'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <PermissionGate module="orders" action="change_status"
                            fallback={
                              <span className={`text-xs font-medium rounded-full px-2 py-1 inline-block ${
                                STATUS_OPTIONS.find(s => s.value === order.status)?.color || 'bg-gray-100 text-gray-800 dark:text-gray-200'
                              }`}>
                                {STATUS_OPTIONS.find(s => s.value === order.status)?.label || order.status}
                              </span>
                            }
                          >
                            <select
                              className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer appearance-none text-center ${
                                STATUS_OPTIONS.find(s => s.value === order.status)?.color || 'bg-gray-100 text-gray-800 dark:text-gray-200'
                              }`}
                              value={order.status}
                              onChange={e => { e.stopPropagation(); handleStatusChange(order.id, e.target.value) }}
                              onClick={e => e.stopPropagation()}
                            >
                              {STATUS_OPTIONS.filter(s => s.value !== 'todos').map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </select>
                          </PermissionGate>
                          <PermissionGate module="orders" action="edit">
                            <button
                              onClick={e => { e.stopPropagation(); handleEditOrder(order) }}
                              className="text-blue-500 hover:text-blue-700 text-xs font-medium"
                              title="Editar pedido"
                            >
                              Editar
                            </button>
                          </PermissionGate>
                          <PermissionGate module="orders" action="delete">
                            <button
                              onClick={e => { e.stopPropagation(); setDeleteTarget(order.id) }}
                              className="w-6 h-6 flex items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-700 transition-colors text-sm"
                              title="Eliminar pedido"
                            >
                              x
                            </button>
                          </PermissionGate>
                          <span className="text-gray-400 text-xs">{expandedOrder === order.id ? 'v' : 'v'}</span>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedOrder === order.id && (
                      <tr>
                        <td colSpan={7} className="px-0 py-0 border-b-2 border-blue-300">
                          <div className="mx-3 my-3 bg-blue-50 dark:bg-gray-800 border border-blue-200 dark:border-gray-600 rounded-lg shadow-sm overflow-hidden animate-slideDown">
                            <div className="border-l-4 border-blue-500 px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                                {/* Column 1: Product & Items details */}
                                <div className="space-y-2 min-w-0 overflow-hidden">
                                  <h4 className="text-sm font-semibold text-blue-800 border-b border-blue-200 pb-1">Detalle del Pedido</h4>
                                  {order.description && (
                                    <div>
                                      <p className="text-xs text-gray-500">Descripcion</p>
                                      <p className="text-sm text-gray-800 dark:text-gray-200 break-words whitespace-pre-wrap">{order.description}</p>
                                    </div>
                                  )}
                                  {/* Items list from invoicing status */}
                                  {(() => {
                                    const status = invoicingStatus[order.id]
                                    const items = status?.items || []
                                    if (items.length > 0) {
                                      return (
                                        <div className="space-y-1.5">
                                          <p className="text-xs text-gray-500 font-medium">Items ({items.length})</p>
                                          {items.map((item: any, i: number) => (
                                            <div key={item.id || i} className="bg-white border border-gray-200 rounded px-2 py-1.5 text-xs">
                                              <div className="flex justify-between items-start">
                                                <span className="font-medium text-gray-800 dark:text-gray-200">{item.product_name}</span>
                                                <span className="text-gray-600 dark:text-gray-400 whitespace-nowrap ml-2">
                                                  {item.quantity} x {formatCurrency(parseFloat(item.unit_price || '0'))}
                                                </span>
                                              </div>
                                              {item.description && (
                                                <p className="text-gray-500 mt-0.5 break-words">{item.description}</p>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )
                                    }
                                    return (
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <p className="text-xs text-gray-500">Precio Unitario</p>
                                          <p className="text-sm font-medium">{formatCurrency(parseFloat(order.unit_price || '0'))}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs text-gray-500">Cantidad</p>
                                          <p className="text-sm font-medium">{order.quantity}</p>
                                        </div>
                                      </div>
                                    )
                                  })()}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <p className="text-xs text-gray-500">IVA</p>
                                      <p className="text-sm font-medium">{order.vat_rate}%</p>
                                    </div>
                                  </div>
                                  {order.notes && (
                                    <div>
                                      <p className="text-xs text-gray-500">Notas</p>
                                      <p className="text-sm text-gray-700 dark:text-gray-300 bg-yellow-50 px-2 py-1 rounded break-words whitespace-pre-wrap">{order.notes}</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-500">Prioridad</p>
                                    <p className={`text-sm font-medium ${PRIORITY_LABELS[order.priority]?.color || ''}`}>
                                      {PRIORITY_LABELS[order.priority]?.label || order.priority}
                                    </p>
                                  </div>
                                </div>

                                {/* Column 2: Delivery & Dates */}
                                <div className="space-y-2 min-w-0 overflow-hidden">
                                  <h4 className="text-sm font-semibold text-blue-800 border-b border-blue-200 pb-1">Entrega y Fechas</h4>
                                  <div>
                                    <p className="text-xs text-gray-500">Fecha de Creacion</p>
                                    <p className="text-sm text-gray-800 dark:text-gray-200">{formatDate(order.created_at)}</p>
                                  </div>
                                  {order.estimated_delivery && (
                                    <div>
                                      <p className="text-xs text-gray-500">Entrega Estimada</p>
                                      <p className="text-sm text-gray-800 dark:text-gray-200">{formatDate(order.estimated_delivery)}</p>
                                    </div>
                                  )}
                                  {order.actual_delivery && (
                                    <div>
                                      <p className="text-xs text-gray-500">Entrega Real</p>
                                      <p className="text-sm text-green-700 font-medium">{formatDate(order.actual_delivery)}</p>
                                    </div>
                                  )}
                                  {/* Production Timer */}
                                  {order.production_started_at && (order.status === 'en_produccion' || order.status === 'terminado' || order.status === 'entregado') && (
                                    <div>
                                      <p className="text-xs text-gray-500">Tiempo de Produccion</p>
                                      {editingTimer === order.id ? (
                                        <div className="flex items-center gap-1 mt-0.5">
                                          <input
                                            type="datetime-local"
                                            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-700 dark:text-gray-100"
                                            value={editTimerValue}
                                            onChange={e => setEditTimerValue(e.target.value)}
                                          />
                                          <button
                                            onClick={() => handleProductionStartedAtChange(order.id, editTimerValue)}
                                            className="text-xs px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                                          >
                                            OK
                                          </button>
                                          <button
                                            onClick={() => setEditingTimer(null)}
                                            className="text-xs px-1.5 py-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-300"
                                          >
                                            x
                                          </button>
                                        </div>
                                      ) : (
                                        <p
                                          className={`text-sm font-bold cursor-pointer hover:underline ${order.status === 'en_produccion' ? 'text-blue-700' : 'text-green-700'}`}
                                          onClick={e => {
                                            e.stopPropagation()
                                            setEditingTimer(order.id)
                                            const d = new Date(order.production_started_at!)
                                            const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                                            setEditTimerValue(local)
                                          }}
                                        >
                                          {formatElapsedTime(
                                            order.production_started_at,
                                            order.status === 'en_produccion' ? null : (order.actual_delivery || order.created_at)
                                          )}
                                          {order.status === 'en_produccion' && <span className="ml-1 text-xs text-blue-500 font-normal">(en curso)</span>}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-500">Cliente</p>
                                    <p className="text-sm text-gray-800 dark:text-gray-200">{order.customer?.name || 'Sin cliente'}</p>
                                    {order.customer?.cuit && <p className="text-xs text-gray-500 font-mono">{order.customer.cuit}</p>}
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">Empresa</p>
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm text-gray-800 dark:text-gray-200">{order.enterprise?.name || 'Sin empresa'}</p>
                                      <TagBadges tags={order.enterprise_tags || []} size="sm" />
                                    </div>
                                  </div>
                                  {order.quote && (
                                    <div>
                                      <p className="text-xs text-gray-500">Cotizacion Asociada</p>
                                      <span className="text-sm font-mono font-semibold text-purple-700">
                                        #{String(order.quote.quote_number || 0).padStart(4, '0')}
                                      </span>
                                    </div>
                                  )}
                                  {order.cobro && (
                                    <div>
                                      <p className="text-xs text-gray-500">Cobro Asociado</p>
                                      <p className="text-sm text-green-700 font-medium">
                                        {formatCurrency(parseFloat(order.cobro.amount || '0'))} ({order.cobro.payment_method})
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* Column 3: Invoicing & Payment */}
                                <div className="space-y-2 min-w-0 overflow-hidden">
                                  <h4 className="text-sm font-semibold text-blue-800 border-b border-blue-200 pb-1">Facturacion y Pago</h4>

                                  {/* Payment method */}
                                  <div>
                                    <p className="text-xs text-gray-500">Forma de Pago</p>
                                    <PermissionGate module="orders" action="edit">
                                      <select
                                        className="text-sm border rounded px-2 py-1 w-full"
                                        value={order.payment_method || ''}
                                        onChange={e => handlePaymentMethodChange(order.id, e.target.value)}
                                      >
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </PermissionGate>
                                  </div>
                                  {order.bank && (
                                    <div>
                                      <p className="text-xs text-gray-500">Banco</p>
                                      <p className="text-sm text-gray-800 dark:text-gray-200">{order.bank.bank_name}</p>
                                    </div>
                                  )}

                                  {/* Payment status - editable */}
                                  <div>
                                    <p className="text-xs text-gray-500">Estado de Pago</p>
                                    <PermissionGate module="orders" action="edit">
                                      <select
                                        className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 mt-0.5 bg-white dark:bg-gray-700 dark:text-gray-100"
                                        value={order.payment_status || 'pendiente'}
                                        onChange={e => handlePaymentStatusChange(order.id, e.target.value)}
                                      >
                                        <option value="pendiente">No pagado</option>
                                        <option value="parcial">Parcial</option>
                                        <option value="pagado">Pagado</option>
                                      </select>
                                    </PermissionGate>
                                  </div>

                                  {/* Invoicing section */}
                                  <div className="pt-1 border-t border-blue-200">
                                    <p className="text-xs text-gray-500 mb-1.5">Facturacion</p>
                                    {invoicingLoading[order.id] ? (
                                      <p className="text-xs text-gray-400 italic">Cargando estado...</p>
                                    ) : (() => {
                                      const status = invoicingStatus[order.id]
                                      if (!status) return null

                                      return (
                                        <div className="space-y-2">
                                          {/* Status indicator + action button */}
                                          {status.invoicing_status === 'sin_facturar' && (
                                            <PermissionGate module="invoices" action="create">
                                              <button
                                                onClick={() => handleShowInvoiceForm(order.id)}
                                                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                                              >
                                                Facturar
                                              </button>
                                            </PermissionGate>
                                          )}
                                          {status.invoicing_status === 'parcial' && (
                                            <div className="space-y-1">
                                              <PermissionGate module="invoices" action="create">
                                                <button
                                                  onClick={() => handleShowInvoiceForm(order.id)}
                                                  className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-medium hover:bg-yellow-600 transition-colors"
                                                >
                                                  Facturar Restante
                                                </button>
                                              </PermissionGate>
                                              <p className="text-xs text-yellow-700 font-medium">Parcialmente facturado</p>
                                            </div>
                                          )}
                                          {status.invoicing_status === 'facturado' && (() => {
                                            const allNoFiscal = (status.invoices || []).length > 0 && status.invoices.every(inv => inv.fiscal_type === 'no_fiscal')
                                            const allInterno = (status.invoices || []).length > 0 && status.invoices.every(inv => inv.fiscal_type === 'interno')
                                            const hasAfip = (status.invoices || []).some(inv => inv.cae)
                                            if (allNoFiscal) {
                                              return (
                                                <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 dark:text-gray-300 rounded text-xs font-semibold">
                                                  Comprobante No Fiscal
                                                </span>
                                              )
                                            }
                                            if (allInterno) {
                                              return (
                                                <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 dark:text-gray-300 rounded text-xs font-semibold">
                                                  Comprobante Interno
                                                </span>
                                              )
                                            }
                                            if (hasAfip) {
                                              return (
                                                <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                                                  Facturado AFIP
                                                </span>
                                              )
                                            }
                                            return (
                                              <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                                                Facturado
                                              </span>
                                            )
                                          })()}

                                          {/* List of existing invoices */}
                                          {(status.invoices || []).length > 0 && (
                                            <div className="space-y-1">
                                              {status.invoices.map(inv => (
                                                <div key={inv.id} className="flex items-center gap-2 bg-white border border-indigo-200 rounded px-2 py-1.5">
                                                  <span className="font-mono text-xs font-semibold text-indigo-800">
                                                    {inv.fiscal_type === 'no_fiscal'
                                                      ? `NF-${String(inv.invoice_number).padStart(6, '0')}`
                                                      : inv.fiscal_type === 'interno'
                                                        ? `CI-${String(inv.invoice_number).padStart(6, '0')}`
                                                        : `${inv.invoice_type || ''} ${inv.punto_venta ? `${String(inv.punto_venta).padStart(5, '0')}-` : ''}${String(inv.invoice_number).padStart(8, '0')}`
                                                    }
                                                  </span>
                                                  <span className="text-xs text-gray-500">{formatCurrency(parseFloat(inv.total_amount || '0'))}</span>
                                                  {inv.status === 'draft' ? (
                                                    <>
                                                      <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded font-medium">Borrador</span>
                                                      <button
                                                        onClick={() => invoicePreview.openPreview(inv.id, order.id)}
                                                        className="ml-auto text-xs bg-green-600 text-white px-2 py-0.5 rounded hover:bg-green-700 transition-colors"
                                                      >
                                                        Ver / Autorizar
                                                      </button>
                                                      <button
                                                        onClick={() => invoicePreview.deleteDraft(inv.id, order.id)}
                                                        className="text-xs text-red-500 hover:text-red-700 px-1"
                                                        title="Eliminar borrador"
                                                      >
                                                        x
                                                      </button>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <span
                                                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                          inv.fiscal_type === 'no_fiscal' || inv.fiscal_type === 'interno'
                                                            ? 'bg-gray-100 text-gray-600 dark:text-gray-400'
                                                            : 'bg-green-100 text-green-800'
                                                        }`}
                                                        title={inv.cae ? `CAE: ${inv.cae}` : undefined}
                                                      >
                                                        {inv.fiscal_type === 'no_fiscal' ? 'No Fiscal'
                                                          : inv.fiscal_type === 'interno' ? 'Interno'
                                                          : inv.cae ? 'AFIP' : 'Autorizada'}
                                                      </span>
                                                      <button
                                                        onClick={() => invoicePreview.openPreview(inv.id, order.id)}
                                                        className="ml-auto text-xs bg-gray-500 text-white px-2 py-0.5 rounded hover:bg-gray-600 transition-colors"
                                                      >
                                                        Ver
                                                      </button>
                                                      <button
                                                        onClick={() => invoicePreview.downloadPdf(inv.id, inv)}
                                                        disabled={invoicePreview.downloadingPdf}
                                                        className="text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                        title="Descargar PDF"
                                                      >
                                                        {invoicePreview.downloadingPdf ? '...' : 'PDF'}
                                                      </button>
                                                    </>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}

                                          {/* Inline invoice creation form */}
                                          {showInvoiceForm[order.id] && status.invoicing_status !== 'facturado' && (
                                            <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                                              <div className="flex items-center justify-between">
                                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Crear Factura</p>
                                                <button
                                                  onClick={() => handleShowInvoiceForm(order.id)}
                                                  className="text-gray-400 hover:text-gray-600 dark:text-gray-400 text-xs"
                                                >
                                                  Cerrar
                                                </button>
                                              </div>

                                              {/* Invoice type selector */}
                                              <div className="flex items-center gap-2">
                                                <label className="text-xs text-gray-500">Tipo:</label>
                                                <select
                                                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 dark:text-gray-100"
                                                  value={invoiceType[order.id] || 'B'}
                                                  onChange={e => setInvoiceType(prev => ({ ...prev, [order.id]: e.target.value }))}
                                                >
                                                  {INVOICE_TYPES.map(t => <option key={t} value={t}>Factura {t}</option>)}
                                                </select>
                                              </div>

                                              {/* Items table */}
                                              {(status.items || []).length > 0 ? (
                                                <div className="overflow-x-auto">
                                                  <table className="w-full text-xs">
                                                    <thead>
                                                      <tr className="bg-gray-50 text-gray-500">
                                                        <th className="px-2 py-1 text-left">Producto</th>
                                                        <th className="px-2 py-1 text-center">Total</th>
                                                        <th className="px-2 py-1 text-center">Facturado</th>
                                                        <th className="px-2 py-1 text-center">Pendiente</th>
                                                        <th className="px-2 py-1 text-center">A facturar</th>
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {status.items.map(item => {
                                                        const qtyToInvoice = invoiceQtys[order.id]?.[item.id] ?? item.pending_qty
                                                        const subtotal = qtyToInvoice * parseFloat(item.unit_price || '0')
                                                        return (
                                                          <tr key={item.id} className="border-t border-gray-100">
                                                            <td className="px-2 py-1">{item.product_name}</td>
                                                            <td className="px-2 py-1 text-center">{item.quantity}</td>
                                                            <td className="px-2 py-1 text-center text-green-700">{item.invoiced_qty}</td>
                                                            <td className="px-2 py-1 text-center text-orange-600">{item.pending_qty}</td>
                                                            <td className="px-2 py-1 text-center">
                                                              <input
                                                                type="number"
                                                                min="0"
                                                                max={item.pending_qty}
                                                                value={qtyToInvoice}
                                                                onChange={e => handleInvoiceQtyChange(order.id, item.id, parseInt(e.target.value) || 0, item.pending_qty)}
                                                                className="w-16 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs text-center bg-white dark:bg-gray-700 dark:text-gray-100"
                                                                disabled={item.pending_qty === 0}
                                                              />
                                                            </td>
                                                          </tr>
                                                        )
                                                      })}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              ) : (
                                                <p className="text-xs text-gray-400 italic">No hay items pendientes</p>
                                              )}

                                              {/* Create invoice button */}
                                              {creatingInvoice[order.id] ? (
                                                <div className="w-full px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                                                  <div className="flex items-center justify-center gap-2">
                                                    <svg className="animate-spin h-4 w-4 text-indigo-600" viewBox="0 0 24 24">
                                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                                    </svg>
                                                    <span className="text-xs font-medium text-indigo-700">
                                                      {invoiceProgress[order.id] || 'Procesando...'}
                                                    </span>
                                                  </div>
                                                  <p className="text-[10px] text-indigo-500 mt-1">No cierres esta ventana</p>
                                                </div>
                                              ) : (
                                                <div className="flex gap-2">
                                                  <button
                                                    onClick={() => handleCreateInvoice(order.id)}
                                                    disabled={creatingInvoice[order.id]}
                                                    className="flex-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                  >
                                                    Crear Borrador de Factura
                                                  </button>
                                                  <button
                                                    onClick={() => handleCreateNoFiscalInvoice(order.id)}
                                                    disabled={creatingInvoice[order.id]}
                                                    className="px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    title="Crear comprobante sin autorizacion AFIP"
                                                  >
                                                    No Fiscal
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                </div>

                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredOrders.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      {/* Invoice Preview / Authorize Modal */}
      {invoicePreview.previewInvoice && (
        <InvoicePreviewModal
          invoice={invoicePreview.previewInvoice}
          loading={invoicePreview.previewLoading}
          orderId={invoicePreview.previewOrderId}
          authorizing={invoicePreview.authorizingInvoice}
          authorizeProgress={invoicePreview.authorizeProgress}
          puntoVenta={invoicePreview.previewPuntoVenta}
          invoiceType={invoicePreview.previewInvoiceType}
          items={invoicePreview.previewItems}
          authorized={invoicePreview.invoiceAuthorized}
          authFailed={invoicePreview.authFailed}
          authErrorMsg={invoicePreview.authErrorMsg}
          onClose={invoicePreview.closePreview}
          onPuntoVentaChange={invoicePreview.setPreviewPuntoVenta}
          onInvoiceTypeChange={invoicePreview.setPreviewInvoiceType}
          onItemsChange={invoicePreview.setPreviewItems}
          onAuthorize={invoicePreview.saveAndAuthorize}
          onDeleteDraft={invoicePreview.deleteDraft}
          onDownloadPdf={invoicePreview.downloadPdf}
          downloadingPdf={invoicePreview.downloadingPdf}
          pdfBlobUrl={invoicePreview.pdfBlobUrl}
          condicionIva={invoicePreview.previewCondicionIva}
          onCondicionIvaChange={invoicePreview.setPreviewCondicionIva}
          concepto={invoicePreview.previewConcepto}
          onConceptoChange={invoicePreview.setPreviewConcepto}
          onFchServDesdeChange={invoicePreview.setPreviewFchServDesde}
          onFchServHastaChange={invoicePreview.setPreviewFchServHasta}
          onFchVtoPagoChange={invoicePreview.setPreviewFchVtoPago}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar pedido"
        message="¿Seguro que querés eliminar este pedido? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleDeleteOrder}
        onCancel={() => setDeleteTarget(null)}
        loading={deletingOrder}
      />
    </div>
  )
}
