import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DateInput } from '@/components/ui/DateInput'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EnterpriseCustomerSelector } from '@/components/shared/EnterpriseCustomerSelector'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { TagBadges } from '@/components/shared/TagBadges'
import { formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { RemitoPreviewModal } from '@/components/shared/RemitoPreviewModal'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ContextMenuBase } from '@/components/ui/ContextMenuBase'
import type { ContextMenuItem } from '@/components/ui/ContextMenuBase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RemitoItem {
  product_name: string
  description: string
  quantity: number
  unit: string
  product_id?: string
  unit_price?: number
  vat_rate?: number
  order_item_id?: string
  invoice_item_id?: string
  // UI-only fields for item picker
  source?: 'order' | 'invoice' | 'manual'
  source_ref?: string       // "Pedido #0003" or "Factura B-002"
  source_id?: string        // order_id or invoice_id
  qty_available?: number    // max selectable
  localId?: string          // unique key for React rendering
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
  enterprise_tags?: { id: string; name: string; color: string }[]
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

const EMPTY_ITEM: RemitoItem = {
  product_name: '', description: '', quantity: 1, unit: 'unidades',
  source: 'manual', source_ref: 'Manual', localId: crypto.randomUUID(),
}

const CSV_COLUMNS = [
  { key: 'remito_number', label: 'N° Remito' },
  { key: 'date',          label: 'Fecha', type: 'date' as const },
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

function getTipoBadge(tipo: string) {
  const found = TIPO_OPTIONS.find(o => o.value === tipo)
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${found?.color ?? 'bg-gray-100 text-gray-700 dark:text-gray-300'}`}>
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
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

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

  // Confirm dialog for delete
  const [deleteTarget, setDeleteTarget] = useState<Remito | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)

  // Preview modal
  const [previewRemitoId, setPreviewRemitoId] = useState<string | null>(null)
  const [expandedRemitoId, setExpandedRemitoId] = useState<string | null>(null)
  const [expandedRemitoDetail, setExpandedRemitoDetail] = useState<Record<string, any>>({})

  // Item importers
  const [showOrderImporter, setShowOrderImporter] = useState(false)
  const [showInvoiceImporter, setShowInvoiceImporter] = useState(false)
  const [importerItems, setImporterItems] = useState<any[]>([])
  const [importerLoading, setImporterLoading] = useState(false)

  // Context menu
  const contextMenu = useContextMenu<Remito>()
  const [contextData, setContextData] = useState<Record<string, any>>({})

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
    setEnterprises(Array.isArray(entRes) ? entRes : entRes?.items ?? [])
    setCustomers(Array.isArray(custRes) ? custRes : custRes?.items ?? [])
    setOrders(Array.isArray(ordRes) ? ordRes : ordRes?.items ?? [])
  }, [])

  useEffect(() => {
    loadStaticData()
  }, [loadStaticData])

  useEffect(() => {
    setCurrentPage(1)
    loadRemitos(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEnterprise, filterStatus, filterTipo, filterSearch, filterDateFrom, filterDateTo, loadRemitos])

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

  // ── Enterprise change: clear items from different enterprise (FIX review) ──

  const handleEnterpriseChange = (id: string) => {
    const hadItems = items.some(it => it.source && it.source !== 'manual')
    if (hadItems && id !== form.enterprise_id) {
      // Clear linked items when switching enterprise
      setItems([{ ...EMPTY_ITEM, localId: crypto.randomUUID() }])
    }
    setForm(prev => ({ ...prev, enterprise_id: id, order_id: '' }))
  }

  // ── Import items from order ────────────────────────────────────────────────

  const handleImportFromOrder = async () => {
    if (!form.enterprise_id) return
    setShowOrderImporter(true)
    setImporterLoading(true)
    try {
      const data = await api.getAvailableOrderItemsForRemitoByEnterprise(form.enterprise_id)
      setImporterItems(data || [])
    } catch { setImporterItems([]) }
    finally { setImporterLoading(false) }
  }

  const handleConfirmOrderImport = (selected: Array<{ item: any; qty: number }>) => {
    const existingIds = new Set(items.filter(i => i.order_item_id).map(i => i.order_item_id))
    const newItems: RemitoItem[] = selected
      .filter(s => !existingIds.has(s.item.order_item_id)) // prevent duplicates
      .map(s => ({
        product_name: s.item.product_name,
        description: s.item.description || '',
        quantity: s.qty,
        unit: 'unidades',
        product_id: s.item.product_id || undefined,
        unit_price: parseFloat(s.item.unit_price || '0'),
        vat_rate: s.item.vat_rate || 21,
        order_item_id: s.item.order_item_id,
        source: 'order' as const,
        source_ref: `Pedido #${String(s.item.order_number).padStart(4, '0')}`,
        source_id: s.item.order_id,
        qty_available: parseFloat(s.item.qty_available || '0'),
        localId: crypto.randomUUID(),
      }))
    // Replace default empty item if it's the only one
    setItems(prev => {
      const filtered = prev.filter(i => i.product_name.trim() || i.source !== 'manual')
      return [...filtered, ...newItems]
    })
    setShowOrderImporter(false)
  }

  // ── Import items from invoice ──────────────────────────────────────────────

  const handleImportFromInvoice = async () => {
    if (!form.enterprise_id) return
    setShowInvoiceImporter(true)
    setImporterLoading(true)
    try {
      const data = await api.getInvoicesWithPendingDelivery(form.enterprise_id)
      setImporterItems(data || [])
    } catch { setImporterItems([]) }
    finally { setImporterLoading(false) }
  }

  const handleConfirmInvoiceImport = (selected: Array<{ item: any; qty: number }>) => {
    const existingIds = new Set(items.filter(i => i.invoice_item_id).map(i => i.invoice_item_id))
    const newItems: RemitoItem[] = selected
      .filter(s => !existingIds.has(s.item.invoice_item_id))
      .map(s => ({
        product_name: s.item.product_name,
        description: '',
        quantity: s.qty,
        unit: 'unidades',
        unit_price: parseFloat(s.item.unit_price || '0'),
        vat_rate: s.item.vat_rate || 21,
        invoice_item_id: s.item.invoice_item_id,
        order_item_id: s.item.order_item_id || undefined,
        source: 'invoice' as const,
        source_ref: `Factura ${s.item.invoice_type || ''}-${s.item.invoice_number || ''}`,
        qty_available: parseFloat(s.item.qty_available || '0'),
        localId: crypto.randomUUID(),
      }))
    setItems(prev => {
      const filtered = prev.filter(i => i.product_name.trim() || i.source !== 'manual')
      return [...filtered, ...newItems]
    })
    setShowInvoiceImporter(false)
  }

  // ── URL params: pre-load from order/invoice/expand ─────────────────────────

  useEffect(() => {
    const preloadOrderId = searchParams.get('order_id')
    const preloadInvoiceId = searchParams.get('invoice_id')
    const expandId = searchParams.get('expand')
    const shouldOpen = searchParams.get('nuevo') === 'true'

    if (expandId) {
      setPreviewRemitoId(expandId)
      setSearchParams({}, { replace: true })
      return
    }

    if (shouldOpen) {
      setShowForm(true)
      if (preloadOrderId) {
        api.getAvailableOrderItemsForRemito(preloadOrderId).then(data => {
          if (data?.length > 0) {
            setForm(prev => ({ ...prev, enterprise_id: data[0].enterprise_id || '' }))
            setItems(data.map((i: any) => ({
              product_name: i.product_name, description: i.description || '',
              quantity: parseFloat(i.qty_available), unit: 'unidades',
              product_id: i.product_id, unit_price: parseFloat(i.unit_price || '0'),
              vat_rate: i.vat_rate || 21, order_item_id: i.order_item_id,
              source: 'order' as const,
              source_ref: `Pedido #${String(i.order_number).padStart(4, '0')}`,
              qty_available: parseFloat(i.qty_available), localId: crypto.randomUUID(),
            })))
          } else {
            toast.info('Todos los items de este pedido ya fueron remitados')
          }
        }).catch(() => toast.error('No se pudieron cargar los items del pedido'))
      }
      if (preloadInvoiceId) {
        api.getAvailableInvoiceItemsForRemito(preloadInvoiceId).then(data => {
          if (data?.length > 0) {
            setForm(prev => ({ ...prev, enterprise_id: data[0].enterprise_id || '' }))
            setItems(data.map((i: any) => ({
              product_name: i.product_name, description: '',
              quantity: parseFloat(i.qty_available), unit: 'unidades',
              unit_price: parseFloat(i.unit_price || '0'), vat_rate: i.vat_rate || 21,
              invoice_item_id: i.invoice_item_id, order_item_id: i.order_item_id,
              source: 'invoice' as const,
              source_ref: `Factura ${i.invoice_type}-${i.invoice_number}`,
              qty_available: parseFloat(i.qty_available), localId: crypto.randomUUID(),
            })))
          } else {
            toast.info('Todos los items de esta factura ya fueron remitados')
          }
        }).catch(() => toast.error('No se pudieron cargar los items de la factura'))
      }
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-calculated references ─────────────────────────────────────────────

  const autoPedidoRef = useMemo(() => {
    const refs = [...new Set(items.filter(i => i.source === 'order' && i.source_ref).map(i => i.source_ref!))]
    return refs.join(', ')
  }, [items])

  const autoFacturaRef = useMemo(() => {
    const refs = [...new Set(items.filter(i => i.source === 'invoice' && i.source_ref).map(i => i.source_ref!))]
    return refs.join(', ')
  }, [items])

  // ── Auto-calculate form.order_id from items (FIX review: orphaned order_id) ──

  const derivedOrderId = useMemo(() => {
    const orderIds = [...new Set(items.filter(i => i.source_id).map(i => i.source_id!))]
    return orderIds.length === 1 ? orderIds[0] : ''
  }, [items])

  // ── Item helpers ───────────────────────────────────────────────────────────

  const handleAddManualItem = () => {
    setItems(prev => [...prev, { ...EMPTY_ITEM, localId: crypto.randomUUID() }])
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
        order_id:         derivedOrderId         || null,
        delivery_address: form.delivery_address || null,
        receiver_name:    form.receiver_name    || null,
        transport:        form.transport        || null,
        notes:            form.notes            || null,
        date:             form.date             || null,
        tipo:             form.tipo,
        pedido_ref:       autoPedidoRef          || null,
        factura_ref:      autoFacturaRef         || null,
        items: validItems.map(it => ({
          product_name:   it.product_name,
          description:    it.description || null,
          quantity:       it.quantity,
          unit:           it.unit,
          product_id:     it.product_id || null,
          unit_price:     it.unit_price || null,
          vat_rate:       it.vat_rate || 21,
          order_item_id:  it.order_item_id || null,
          invoice_item_id: it.invoice_item_id || null,
        })),
      })
      toast.success('Remito creado correctamente')
      setShowForm(false)
      setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] })
      setItems([{ ...EMPTY_ITEM }])
      await loadRemitos(currentPage)
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Status change ──────────────────────────────────────────────────────────

  const handleStatusChange = async (remitoId: string, newStatus: string) => {
    try {
      await api.updateRemitoStatus(remitoId, newStatus)
      toast.success('Estado actualizado')
      await loadRemitos(currentPage)
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDeleteRemito = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteRemito(deleteTarget.id)
      toast.success('Remito eliminado correctamente')
      await loadRemitos(currentPage)
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  // ── PDF download ───────────────────────────────────────────────────────────

  const handleDownloadPdf = async (remitoId: string, remitoNumber: number) => {
    try {
      setDownloadingPdfId(remitoId)
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
    } finally {
      setDownloadingPdfId(null)
    }
  }

  // ── Signed PDF upload/download ─────────────────────────────────────────────

  const handleUploadSignedPdf = async (remitoId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo no puede superar 5 MB')
      return
    }
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1]
          await api.uploadSignedRemitoPdf(remitoId, base64)
          toast.success('PDF firmado subido correctamente')
          await loadRemitos(currentPage)
        } catch (err: any) {
          setError(err.message)
          toast.error('Error al subir PDF firmado')
        }
      }
      reader.onerror = () => {
        setError('Error al leer el archivo')
      }
      reader.readAsDataURL(file)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDownloadSignedPdf = async (remitoId: string, remitoNumber: number) => {
    try {
      const { base64 } = await api.getSignedRemitoPdf(remitoId)
      const byteCharacters = atob(base64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Remito_${String(remitoNumber).padStart(6, '0')}_firmado.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Preview modal ─────────────────────────────────────────────────────────

  const handlePreviewRemito = (remitoId: string) => {
    setPreviewRemitoId(remitoId)
  }

  const handleClosePreview = () => {
    setPreviewRemitoId(null)
  }

  const handlePreviewSaved = () => {
    loadRemitos(currentPage)
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Remitos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} remito{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={csvData} columns={CSV_COLUMNS} filename="remitos" />
          <ExportExcelButton data={csvData} columns={CSV_COLUMNS} filename="remitos" />
          <PermissionGate module="remitos" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => setShowForm(v => !v)}>
              {showForm ? 'Cancelar' : '+ Nuevo Remito'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-center justify-between">
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
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Nuevo Remito</h3>
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
                onEnterpriseChange={handleEnterpriseChange}
                onCustomerChange={id => setForm(prev => ({ ...prev, customer_id: id }))}
                enterpriseLabel="Empresa"
                customerLabel={form.tipo === 'recepcion' ? 'Proveedor / Remitente' : 'Cliente / Destinatario'}
              />

              {/* Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DateInput
                  label="Fecha"
                  value={form.date}
                  onChange={val => setForm(prev => ({ ...prev, date: val }))}
                />
                {(autoPedidoRef || autoFacturaRef) && (
                  <div className="space-y-1">
                    {autoPedidoRef && (
                      <div className="text-sm"><span className="font-medium text-gray-700">Pedido(s):</span> <span className="text-blue-600">{autoPedidoRef}</span></div>
                    )}
                    {autoFacturaRef && (
                      <div className="text-sm"><span className="font-medium text-gray-700">Factura(s):</span> <span className="text-green-600">{autoFacturaRef}</span></div>
                    )}
                  </div>
                )}
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
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Items a {form.tipo === 'recepcion' ? 'recepcionar' : 'entregar'}
                  </label>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleImportFromOrder}
                      disabled={!form.enterprise_id}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                      + Desde Pedido
                    </button>
                    <button type="button" onClick={handleImportFromInvoice}
                      disabled={!form.enterprise_id}
                      className="text-sm text-green-600 hover:text-green-800 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                      + Desde Factura
                    </button>
                    <button type="button" onClick={handleAddManualItem}
                      className="text-sm text-gray-600 hover:text-gray-800 font-medium">
                      + Item manual
                    </button>
                  </div>
                </div>

                {/* Order Items Importer */}
                {showOrderImporter && (
                  <div className="border-2 border-blue-200 rounded-lg p-4 bg-blue-50 mb-3 animate-fadeIn">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-medium text-blue-800">Importar items de pedidos</h4>
                      <button type="button" onClick={() => setShowOrderImporter(false)} className="text-gray-500 hover:text-gray-700">x</button>
                    </div>
                    {importerLoading ? <p className="text-sm text-gray-500">Cargando items disponibles...</p> :
                     importerItems.length === 0 ? <p className="text-sm text-amber-600">No hay items disponibles para remitar en los pedidos de esta empresa</p> :
                    (() => {
                      // Group by order
                      const grouped = importerItems.reduce((acc: any, item: any) => {
                        const key = item.order_id || 'unknown'
                        if (!acc[key]) acc[key] = { order_number: item.order_number, title: item.order_title, items: [] }
                        acc[key].items.push(item)
                        return acc
                      }, {})
                      return (
                        <div className="space-y-3">
                          {Object.entries(grouped).map(([orderId, group]: [string, any]) => (
                            <div key={orderId}>
                              <div className="text-sm font-medium text-blue-700 mb-1">
                                Pedido #{String(group.order_number).padStart(4, '0')} — {group.title}
                              </div>
                              {group.items.map((item: any) => {
                                const alreadyImported = items.some(i => i.order_item_id === item.order_item_id)
                                return (
                                  <div key={item.order_item_id} className={`flex items-center gap-2 py-1 ${alreadyImported ? 'opacity-40' : ''}`}>
                                    <span className="text-sm flex-1">{item.product_name}</span>
                                    <span className="text-xs text-gray-500">disp: {parseFloat(item.qty_available)}</span>
                                    {!alreadyImported && (
                                      <button type="button"
                                        className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700"
                                        onClick={() => handleConfirmOrderImport([{ item, qty: parseFloat(item.qty_available) }])}>
                                        Agregar
                                      </button>
                                    )}
                                    {alreadyImported && <span className="text-xs text-blue-500">Ya importado</span>}
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Invoice Items Importer */}
                {showInvoiceImporter && (
                  <div className="border-2 border-green-200 rounded-lg p-4 bg-green-50 mb-3 animate-fadeIn">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-medium text-green-800">Importar items de facturas</h4>
                      <button type="button" onClick={() => setShowInvoiceImporter(false)} className="text-gray-500 hover:text-gray-700">x</button>
                    </div>
                    {importerLoading ? <p className="text-sm text-gray-500">Cargando facturas...</p> :
                     importerItems.length === 0 ? <p className="text-sm text-amber-600">No hay facturas con items pendientes de remitar</p> :
                    (
                      <div className="space-y-3">
                        {importerItems.map((inv: any) => (
                          <div key={inv.id}>
                            <div className="text-sm font-medium text-green-700 mb-1">
                              Factura {inv.invoice_type}-{String(inv.invoice_number).padStart(8, '0')}
                            </div>
                            {(inv.items || []).map((item: any) => {
                              const alreadyImported = items.some(i => i.invoice_item_id === item.invoice_item_id)
                              return (
                                <div key={item.invoice_item_id} className={`flex items-center gap-2 py-1 ${alreadyImported ? 'opacity-40' : ''}`}>
                                  <span className="text-sm flex-1">{item.product_name}</span>
                                  <span className="text-xs text-gray-500">disp: {parseFloat(item.qty_available)}</span>
                                  {!alreadyImported && (
                                    <button type="button"
                                      className="text-xs bg-green-600 text-white px-2 py-0.5 rounded hover:bg-green-700"
                                      onClick={() => handleConfirmInvoiceImport([{ item, qty: parseFloat(item.qty_available) }])}>
                                      Agregar
                                    </button>
                                  )}
                                  {alreadyImported && <span className="text-xs text-green-500">Ya importado</span>}
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Items list */}
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={item.localId || idx} className="flex gap-2 items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                      {/* Source badge */}
                      <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                        item.source === 'order' ? 'bg-blue-100 text-blue-700' :
                        item.source === 'invoice' ? 'bg-green-100 text-green-700' :
                        'bg-gray-200 text-gray-600'
                      }`}>
                        {item.source_ref || 'Manual'}
                      </span>

                      {/* Product name */}
                      <div className="flex-1 min-w-0">
                        <input
                          className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          placeholder="Nombre del producto *"
                          value={item.product_name}
                          onChange={e => handleItemChange(idx, 'product_name', e.target.value)}
                          disabled={item.source !== 'manual' && item.source !== undefined}
                          required
                        />
                      </div>

                      {/* Qty available indicator */}
                      {item.qty_available != null && (
                        <span className="text-xs text-gray-400 shrink-0 w-12 text-right">
                          max:{item.qty_available}
                        </span>
                      )}

                      {/* Quantity */}
                      <div className="w-20 shrink-0">
                        <input
                          type="number"
                          min="0.01"
                          max={item.qty_available ?? undefined}
                          step="any"
                          className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm text-center bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-1 focus:ring-blue-500"
                          placeholder="Cant."
                          value={item.quantity}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0
                            handleItemChange(idx, 'quantity', item.qty_available ? Math.min(val, item.qty_available) : val)
                          }}
                        />
                      </div>

                      {/* Price (read-only if from source) */}
                      {item.unit_price != null && item.unit_price > 0 && (
                        <span className="text-xs text-gray-500 shrink-0 w-20 text-right">
                          ${item.unit_price.toLocaleString('es-AR')}
                        </span>
                      )}

                      {/* Unit */}
                      <div className="w-24 shrink-0">
                        <select
                          className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-1 focus:ring-blue-500"
                          value={item.unit}
                          onChange={e => handleItemChange(idx, 'unit', e.target.value)}
                        >
                          {UNIT_OPTIONS.map(u => (
                            <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                          ))}
                        </select>
                      </div>

                      {/* Remove */}
                      <button type="button" onClick={() => handleRemoveItem(idx)}
                        disabled={items.length <= 1}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Quitar item">
                        x
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
                <Button type="submit" variant="success" loading={saving}>
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
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-100 transition-colors"
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
            <SkeletonTable rows={6} cols={9} />
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
                  <React.Fragment key={remito.id}>
                  <tr
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${expandedRemitoId === remito.id ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                    onClick={() => {
                      const newId = expandedRemitoId === remito.id ? null : remito.id
                      setExpandedRemitoId(newId)
                      if (newId && !expandedRemitoDetail[newId]) {
                        api.getRemito(newId).then(data => {
                          setExpandedRemitoDetail(prev => ({ ...prev, [newId]: data }))
                        }).catch(() => {})
                      }
                    }}
                    onContextMenu={(e) => {
                      contextMenu.openMenu(e, remito)
                      if (!contextData[remito.id]) {
                        api.getRemitoContextData(remito.id).then(data => {
                          setContextData(prev => ({ ...prev, [remito.id]: data }))
                        }).catch(() => {})
                      }
                    }}>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-blue-700 text-sm">
                        {fmtRemitoNumber(remito.remito_number)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {formatDate(remito.date)}
                    </td>
                    <td className="px-4 py-3">
                      {getTipoBadge(remito.tipo)}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      <div className="flex items-center gap-1.5">
                        {remito.enterprise?.name ?? <span className="text-gray-400">-</span>}
                        <TagBadges tags={remito.enterprise_tags || []} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
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
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {remito.item_count} item{remito.item_count !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <PermissionGate module="remitos" action="edit">
                        <select
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer appearance-none text-center ${
                            STATUS_OPTIONS.find(s => s.value === remito.status)?.color || 'bg-gray-100 text-gray-700 dark:text-gray-300'
                          }`}
                          value={remito.status}
                          onChange={e => handleStatusChange(remito.id, e.target.value)}
                          title="Cambiar estado"
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </PermissionGate>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handlePreviewRemito(remito.id)}
                          className="px-2 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors"
                          title="Ver remito"
                        >
                          Ver
                        </button>
                        <button
                          onClick={() => handleDownloadPdf(remito.id, remito.remito_number)}
                          disabled={downloadingPdfId === remito.id}
                          className="px-2 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          title="Descargar PDF"
                        >
                          {downloadingPdfId === remito.id ? 'Generando...' : 'PDF'}
                        </button>
                        <label
                          className="px-2 py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600 transition-colors cursor-pointer"
                          title="Subir PDF firmado"
                        >
                          Firmado
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={e => handleUploadSignedPdf(remito.id, e)}
                          />
                        </label>
                        {(remito as any).signed_pdf_url && (
                          <button
                            onClick={() => handleDownloadSignedPdf(remito.id, remito.remito_number)}
                            className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 transition-colors"
                            title="Descargar PDF firmado"
                          >
                            Ver Firmado
                          </button>
                        )}
                        <PermissionGate module="remitos" action="delete">
                          <button
                            onClick={() => setDeleteTarget(remito)}
                            className="w-7 h-7 flex items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-700 transition-colors text-base font-bold"
                            title="Eliminar remito"
                          >
                            ×
                          </button>
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                  {/* Expandible row */}
                  {expandedRemitoId === remito.id && (
                    <tr>
                      <td colSpan={10} className="px-4 py-3 bg-gray-50/80 dark:bg-gray-800/30 border-b">
                        {!expandedRemitoDetail[remito.id] ? (
                          <p className="text-xs text-gray-400 italic">Cargando detalle...</p>
                        ) : (() => {
                          const detail = expandedRemitoDetail[remito.id]
                          const detailItems = detail.items || []
                          const ctx = contextData[remito.id]
                          return (
                            <div className="space-y-3">
                              {/* Info del remito */}
                              <div className="flex gap-6 text-xs">
                                {detail.receiver_name && (
                                  <div><span className="font-semibold text-gray-600">Receptor:</span> {detail.receiver_name}</div>
                                )}
                                {detail.delivery_address && (
                                  <div><span className="font-semibold text-gray-600">Direccion:</span> {detail.delivery_address}</div>
                                )}
                                {detail.transport && (
                                  <div><span className="font-semibold text-gray-600">Transporte:</span> {detail.transport}</div>
                                )}
                                {detail.notes && (
                                  <div><span className="font-semibold text-gray-600">Notas:</span> {detail.notes}</div>
                                )}
                              </div>

                              {/* Items table */}
                              {detailItems.length > 0 && (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-[10px] text-gray-500 uppercase">
                                      <th className="text-left pb-1">Origen</th>
                                      <th className="text-left pb-1">Producto</th>
                                      <th className="text-right pb-1">Cantidad</th>
                                      <th className="text-right pb-1">Facturado</th>
                                      <th className="text-left pb-1 pl-2">Estado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailItems.map((item: any, idx: number) => {
                                      const qtyInv = parseFloat(item.qty_invoiced || '0')
                                      const qty = parseFloat(item.quantity || '0')
                                      const sourceRef = item.source_ref || (item.order_item_id ? 'Pedido' : item.invoice_item_id ? 'Factura' : 'Manual')
                                      return (
                                        <tr key={idx} className="border-t border-gray-200/50 dark:border-gray-700">
                                          <td className="py-1.5">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                              sourceRef.includes('Pedido') ? 'bg-blue-100 text-blue-700' :
                                              sourceRef.includes('Factura') ? 'bg-green-100 text-green-700' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>{sourceRef}</span>
                                          </td>
                                          <td className="py-1.5 font-medium text-gray-800 dark:text-gray-200">{item.product_name}</td>
                                          <td className="py-1.5 text-right">{qty} {item.unit || ''}</td>
                                          <td className="py-1.5 text-right">
                                            <span className={qtyInv >= qty ? 'text-green-600' : qtyInv > 0 ? 'text-amber-600' : 'text-gray-400'}>
                                              {qtyInv}/{qty}
                                            </span>
                                          </td>
                                          <td className="py-1.5 pl-2">
                                            <span className={`text-[10px] font-medium ${
                                              qtyInv >= qty ? 'text-green-600' : qtyInv > 0 ? 'text-amber-600' : 'text-gray-400'
                                            }`}>
                                              {qtyInv >= qty ? 'Facturado' : qtyInv > 0 ? 'Parcial' : 'Pendiente'}
                                            </span>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              )}

                              {/* Facturas vinculadas */}
                              {ctx?.invoices?.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap text-xs">
                                  <span className="text-gray-500 font-medium">Facturas:</span>
                                  {ctx.invoices.map((inv: any) => (
                                    <button key={inv.id}
                                      onClick={(e) => { e.stopPropagation(); navigate(`/invoices?expand=${inv.id}`) }}
                                      className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono hover:bg-blue-100">
                                      {inv.invoice_type}-{inv.invoice_number} (${parseFloat(inv.total_amount).toLocaleString('es-AR')})
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Actions */}
                              <div className="flex gap-2">
                                {detailItems.some((i: any) => parseFloat(i.qty_invoiced || '0') < parseFloat(i.quantity || '0')) && (
                                  <button onClick={(e) => { e.stopPropagation(); navigate(`/invoices?nuevo=true&remito_id=${remito.id}`) }}
                                    className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                                    Crear factura de items pendientes
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })()}
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
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar remito"
        message={`¿Eliminar el remito ${deleteTarget ? fmtRemitoNumber(deleteTarget.remito_number) : ''}? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteRemito}
        onCancel={() => setDeleteTarget(null)}
      />

      {previewRemitoId && (
        <RemitoPreviewModal
          remitoId={previewRemitoId}
          customers={customers}
          enterprises={enterprises}
          onClose={handleClosePreview}
          onSaved={handlePreviewSaved}
        />
      )}

      {/* Context menu */}
      {contextMenu.menu && (
        <ContextMenuBase
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          header={{
            title: `Remito ${fmtRemitoNumber(contextMenu.menu.item.remito_number)}`,
            subtitle: contextMenu.menu.item.enterprise?.name || '',
          }}
          items={(() => {
            const remito = contextMenu.menu.item
            const data = contextData[remito.id]
            const menuItems: ContextMenuItem[] = []

            if (!data) {
              menuItems.push({ id: 'loading', label: 'Cargando...', disabled: true })
            } else {
              if (data.invoices?.length > 0) {
                menuItems.push({ id: 'inv-label', label: `Facturas vinculadas (${data.invoices.length}):`, disabled: true })
                for (const inv of data.invoices) {
                  menuItems.push({
                    id: `inv-${inv.id}`, label: `Factura ${inv.invoice_type}-${inv.invoice_number} ($${parseFloat(inv.total_amount).toLocaleString('es-AR')})`,
                    onClick: () => { navigate(`/invoices?expand=${inv.id}`); contextMenu.closeMenu() },
                  })
                }
                menuItems.push({ id: 'sep1', label: '', separator: true })
              }
              const pending = data.items_status?.filter((i: any) => i.qty_pending > 0) || []
              if (pending.length > 0) {
                menuItems.push({ id: 'pend-label', label: `${pending.length} items pendientes de facturar`, disabled: true })
                menuItems.push({ id: 'sep2', label: '', separator: true })
              }
            }

            menuItems.push({ id: 'crear-factura', label: 'Crear factura de este remito',
              onClick: () => { navigate(`/invoices?nuevo=true&remito_id=${remito.id}`); contextMenu.closeMenu() },
            })
            menuItems.push({ id: 'ver', label: 'Ver detalle',
              onClick: () => { setPreviewRemitoId(remito.id); contextMenu.closeMenu() },
            })
            menuItems.push({ id: 'pdf', label: 'Descargar PDF',
              onClick: () => { handleDownloadPdf(remito.id, remito.remito_number); contextMenu.closeMenu() },
            })
            menuItems.push({ id: 'sep3', label: '', separator: true })
            menuItems.push({ id: 'delete', label: 'Eliminar remito', danger: true,
              onClick: () => { setDeleteTarget(remito); contextMenu.closeMenu() },
            })

            return menuItems
          })()}
          onClose={contextMenu.closeMenu}
        />
      )}
    </div>
  )
}
