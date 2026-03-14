import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { Pagination } from '@/components/shared/Pagination'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { TagBadges } from '@/components/shared/TagBadges'
import { formatCurrency, formatDate } from '@/lib/utils'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'

interface Purchase {
  id: string
  purchase_number: number
  date: string
  enterprise_name: string | null
  enterprise_cuit: string | null
  enterprise_id: string | null
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
  notes: string | null
  enterprise_tags?: { id: string; name: string; color: string }[]
  status: string
  created_at: string
}

interface Enterprise { id: string; name: string; cuit: string | null }
interface Bank { id: string; bank_name: string }

interface PurchaseItem {
  id?: string
  product_id?: string
  product_name: string
  description: string
  quantity: number | string
  unit_price: number | string
  subtotal?: number | string
}

interface ProductOption { id: string; name: string; sku: string; pricing?: { cost: string; final_price: string } }

const PAYMENT_METHODS = [
  { value: '', label: 'Sin especificar' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta' },
]

const STATUS_OPTIONS = [
  { value: 'activa', label: 'Activa', color: 'bg-blue-100 text-blue-800' },
  { value: 'recibida', label: 'Recibida', color: 'bg-green-100 text-green-800' },
  { value: 'cancelada', label: 'Cancelada', color: 'bg-red-100 text-red-800' },
]

export const Purchases: React.FC = () => {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [availableProducts, setAvailableProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterEnterprise, setFilterEnterprise] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<Purchase | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingToInventory, setAddingToInventory] = useState<string | null>(null)

  const [form, setForm] = useState({
    enterprise_id: '', date: new Date().toISOString().split('T')[0],
    payment_method: '', bank_id: '', notes: '',
    invoice_type: '', invoice_number: '', invoice_cae: '',
    vat_rate: '21',
  })
  const [items, setItems] = useState<PurchaseItem[]>([
    { product_id: '', product_name: '', description: '', quantity: 1, unit_price: 0 },
  ])

  const loadData = async () => {
    try {
      setLoading(true)
      const [purchRes, entRes, bankRes, prodRes] = await Promise.all([
        api.getPurchases(filterEnterprise ? { enterprise_id: filterEnterprise } : undefined),
        api.getEnterprises(),
        api.getBanks(),
        api.getProducts().catch(() => ({ items: [] })),
      ])
      setPurchases(purchRes || [])
      setEnterprises(entRes || [])
      setBanks(bankRes || [])
      setAvailableProducts(prodRes.items || prodRes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [filterEnterprise])

  const calcSubtotal = () => items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)
  const calcVat = () => calcSubtotal() * (Number(form.vat_rate) / 100)
  const calcTotal = () => calcSubtotal() + calcVat()

  const handleEdit = async (purchase: Purchase) => {
    try {
      const detail = await api.getPurchase(purchase.id)
      setForm({
        enterprise_id: detail.enterprise_id || '',
        date: detail.date ? detail.date.split('T')[0] : '',
        payment_method: detail.payment_method || '',
        bank_id: detail.bank_id || '',
        notes: detail.notes || '',
        invoice_type: detail.invoice_type || '',
        invoice_number: detail.invoice_number || '',
        invoice_cae: detail.invoice_cae || '',
        vat_rate: '21',
      })
      setItems(detail.items?.map((i: any) => ({
        product_id: i.product_id || '',
        product_name: i.product_name || '',
        description: i.description || '',
        quantity: i.quantity?.toString() || '1',
        unit_price: i.unit_price?.toString() || '0',
      })) || [{ product_id: '', product_name: '', description: '', quantity: '1', unit_price: '0' }])
      setEditingId(purchase.id)
      setShowForm(true)
    } catch (e: any) {
      toast.error('Error al cargar compra: ' + e.message)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = items.filter(i => i.product_name.trim())
    if (validItems.length === 0) { setError('Agregá al menos un item'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        enterprise_id: form.enterprise_id || null,
        date: form.date || null,
        payment_method: form.payment_method || null,
        bank_id: form.bank_id || null,
        notes: form.notes || null,
        invoice_type: form.invoice_type || null,
        invoice_number: form.invoice_number || null,
        invoice_cae: form.invoice_cae || null,
        subtotal: calcSubtotal(),
        vat_amount: calcVat(),
        total_amount: calcTotal(),
        items: validItems.map(i => ({
          ...i,
          product_id: i.product_id && i.product_id !== 'custom' ? i.product_id : null,
        })),
      }
      if (editingId) {
        await api.updatePurchase(editingId, payload)
      } else {
        await api.createPurchase(payload)
      }
      toast.success(editingId ? 'Compra actualizada' : 'Compra registrada')
      setShowForm(false)
      setEditingId(null)
      setForm({ enterprise_id: '', date: new Date().toISOString().split('T')[0], payment_method: '', bank_id: '', notes: '', invoice_type: '', invoice_number: '', invoice_cae: '', vat_rate: '21' })
      setItems([{ product_id: '', product_name: '', description: '', quantity: 1, unit_price: 0 }])
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (p: Purchase) => {
    setDeleteTarget(p)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deletePurchase(deleteTarget.id)
      toast.success('Compra eliminada correctamente')
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const handlePaymentStatusChange = async (purchaseId: string, status: string) => {
    try {
      await api.updatePurchasePaymentStatus(purchaseId, status)
      await loadData()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleAddToInventory = async (purchase: Purchase) => {
    if (!purchase.items || purchase.items.length === 0) {
      // Need to fetch detail first
      try {
        setAddingToInventory(purchase.id)
        const detail = await api.getPurchase(purchase.id)
        const purchaseItems = (detail.items || []).map((i: any) => ({
          product_id: i.product_id || i.id || '',
          quantity: parseFloat(i.quantity || '0'),
        })).filter((i: any) => i.product_id && i.quantity > 0)
        if (purchaseItems.length === 0) {
          toast.error('No hay items con productos asociados en esta compra')
          return
        }
        await api.addStockFromPurchase(purchase.id, purchaseItems)
        toast.success('Stock agregado al inventario desde la compra')
      } catch (e: any) {
        toast.error(e.message || 'Error al agregar stock')
      } finally {
        setAddingToInventory(null)
      }
      return
    }

    try {
      setAddingToInventory(purchase.id)
      const purchaseItems = purchase.items.map(i => ({
        product_id: (i as any).product_id || '',
        quantity: parseFloat(String(i.quantity || '0')),
      })).filter(i => i.product_id && i.quantity > 0)
      if (purchaseItems.length === 0) {
        toast.error('No hay items con productos asociados en esta compra')
        return
      }
      await api.addStockFromPurchase(purchase.id, purchaseItems)
      toast.success('Stock agregado al inventario desde la compra')
    } catch (e: any) {
      toast.error(e.message || 'Error al agregar stock')
    } finally {
      setAddingToInventory(null)
    }
  }

  const addItem = () => setItems([...items, { product_id: '', product_name: '', description: '', quantity: 1, unit_price: 0 }])
  const removeItem = (idx: number) => { if (items.length > 1) setItems(items.filter((_, i) => i !== idx)) }
  const updateItem = (idx: number, field: keyof PurchaseItem, value: any) => {
    const newItems = [...items]
    newItems[idx] = { ...newItems[idx], [field]: value }
    setItems(newItems)
  }

  const showBankSelector = form.payment_method === 'transferencia' || form.payment_method === 'cheque'

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

  useEffect(() => { setCurrentPage(1) }, [filterEnterprise, dateFrom, dateTo, pageSize])

  const filteredPurchases = useMemo(() => {
    let result = purchases
    if (dateFrom) result = result.filter(p => p.date >= dateFrom)
    if (dateTo) result = result.filter(p => p.date <= dateTo + 'T23:59:59')
    return result
  }, [purchases, dateFrom, dateTo])

  const totalCompras = filteredPurchases.reduce((sum, p) => sum + parseFloat(p.total_amount || '0'), 0)
  const pendientes = filteredPurchases.filter(p => p.payment_status === 'pendiente').length
  const pagadas = filteredPurchases.filter(p => p.payment_status === 'pagado').length
  const totalPages = Math.ceil(filteredPurchases.length / pageSize)
  const paginatedPurchases = filteredPurchases.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const isFiltered = !!filterEnterprise || !!dateFrom || !!dateTo

  const csvColumns = [
    { key: 'purchase_number', label: 'N° Compra' },
    { key: 'date', label: 'Fecha' },
    { key: 'enterprise_name', label: 'Empresa' },
    { key: 'item_count', label: 'Items' },
    { key: 'total_amount', label: 'Total' },
    { key: 'payment_status', label: 'Estado Pago' },
    { key: 'payment_method', label: 'Método' },
  ]

  const clearFilters = () => {
    setFilterEnterprise('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compras</h1>
          <p className="text-sm text-gray-500 mt-1">{purchases.length} compra{purchases.length !== 1 ? 's' : ''} registrada{purchases.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={filteredPurchases} columns={csvColumns} filename="compras" />
          <PermissionGate module="purchases" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setShowForm(!showForm); if (showForm) { setEditingId(null); setForm({ enterprise_id: '', date: new Date().toISOString().split('T')[0], payment_method: '', bank_id: '', notes: '', invoice_type: '', invoice_number: '', invoice_cae: '', vat_rate: '21' }); setItems([{ product_id: '', product_name: '', description: '', quantity: 1, unit_price: 0 }]) } }}>
              {showForm ? 'Cancelar' : '+ Nueva Compra'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border border-orange-200 bg-orange-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-orange-700">Total Compras</p>
            <p className="text-xl font-bold text-orange-800">{formatCurrency(totalCompras)}</p>
          </CardContent>
        </Card>
        <Card className="border border-yellow-200 bg-yellow-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-yellow-700">Pago Pendiente</p>
            <p className="text-xl font-bold text-yellow-800">{pendientes}</p>
          </CardContent>
        </Card>
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-green-700">Pagadas</p>
            <p className="text-xl font-bold text-green-800">{pagadas}</p>
          </CardContent>
        </Card>
        <Card className="border border-blue-200 bg-blue-50">
          <CardContent className="pt-3 pb-2">
            <p className="text-xs text-blue-700">Empresas</p>
            <p className="text-xl font-bold text-blue-800">{new Set(purchases.map(p => p.enterprise_id).filter(Boolean)).size}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Empresa / Proveedor</label>
              <select className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" value={filterEnterprise} onChange={e => setFilterEnterprise(e.target.value)}>
                <option value="">Todas las empresas</option>
                {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
              </select>
            </div>
            <div className="col-span-2 md:col-span-2">
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} onClear={() => { setDateFrom(''); setDateTo('') }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {showForm && (
        <Card className="animate-fadeIn">
          <CardHeader><h3 className="text-lg font-semibold">{editingId ? 'Editar Compra' : 'Nueva Compra'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Empresa / Proveedor</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.enterprise_id} onChange={e => setForm({ ...form, enterprise_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {enterprises.map(ent => <option key={ent.id} value={ent.id}>{ent.name} {ent.cuit ? `(${ent.cuit})` : ''}</option>)}
                  </select>
                </div>
                <Input label="Fecha" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Método de Pago</label>
                  <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_id: '' })}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
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
              </div>

              {/* Optional Invoice */}
              <div className="border-t pt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Factura recibida (opcional)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm text-gray-600">Tipo</label>
                    <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
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
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium text-gray-700">Items de la compra</p>
                  <button type="button" onClick={addItem} className="text-blue-600 text-sm hover:underline">+ Agregar item</button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <div className="flex flex-col gap-1">
                          <select
                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                            value={item.product_id || ''}
                            onChange={e => {
                              const pid = e.target.value
                              const prod = availableProducts.find(p => p.id === pid)
                              if (prod) {
                                const newItems = [...items]
                                newItems[idx] = {
                                  ...newItems[idx],
                                  product_id: pid,
                                  product_name: prod.name,
                                  unit_price: parseFloat(prod.pricing?.cost || '0'),
                                }
                                setItems(newItems)
                              } else {
                                updateItem(idx, 'product_id', pid)
                              }
                            }}
                          >
                            <option value="">Seleccionar producto...</option>
                            {availableProducts.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                            <option value="custom">Producto manual...</option>
                          </select>
                          {(!item.product_id || item.product_id === 'custom') && (
                            <Input placeholder="Nombre del producto" value={item.product_name} onChange={e => updateItem(idx, 'product_name', e.target.value)} />
                          )}
                        </div>
                      </div>
                      <div className="col-span-3">
                        <Input placeholder="Descripcion" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input type="number" placeholder="Cant." value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input type="number" placeholder="Precio unit." value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} />
                      </div>
                      <div className="col-span-1">
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-lg px-2">x</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t pt-4 flex justify-between items-center">
                <div className="flex gap-4 items-center">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm text-gray-600">IVA %</label>
                    <input
                      type="number" step="0.01" placeholder="21"
                      list="purchase-vat-rate-list"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-24"
                      value={form.vat_rate}
                      onChange={e => setForm({ ...form, vat_rate: e.target.value })}
                    />
                    <datalist id="purchase-vat-rate-list">
                      <option value="0">0%</option>
                      <option value="10.5">10.5%</option>
                      <option value="21">21%</option>
                      <option value="27">27%</option>
                    </datalist>
                  </div>
                  <div className="text-sm text-gray-600">
                    <div>Subtotal: <strong>{formatCurrency(calcSubtotal())}</strong></div>
                    <div>IVA: <strong>{formatCurrency(calcVat())}</strong></div>
                    <div className="text-lg text-green-700 font-bold">Total: {formatCurrency(calcTotal())}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <textarea className="px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y w-64" rows={2} placeholder="Notas..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                  <Button type="submit" variant="success" loading={saving}>{editingId ? 'Guardar Cambios' : 'Crear Compra'}</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Purchases Table with expandable rows */}
      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={5} /></CardContent></Card>
      ) : filteredPurchases.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title={isFiltered ? 'No hay compras con estos filtros' : 'No hay compras registradas'}
            description={isFiltered ? 'Proba ajustando los filtros de busqueda' : 'Registra la primera compra para empezar'}
            action={{ label: isFiltered ? 'Limpiar filtros' : '+ Nueva Compra', onClick: isFiltered ? clearFilters : () => setShowForm(true) }}
          />
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-sm font-medium text-gray-500">
                  <th className="px-4 py-3">N°</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Pago</th>
                  <th className="px-4 py-3 text-center">Estado / Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPurchases.map(purchase => (
                  <React.Fragment key={purchase.id}>
                    <tr
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${expandedPurchase === purchase.id ? 'bg-orange-50 border-b-0' : 'border-b'}`}
                      onClick={() => toggleExpand(purchase.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-orange-700">#{String(purchase.purchase_number || 0).padStart(4, '0')}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(purchase.date)}</td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{purchase.enterprise_name || '-'}</p>
                          {purchase.enterprise_cuit && <p className="text-xs text-gray-500">{purchase.enterprise_cuit}</p>}
                          <TagBadges tags={purchase.enterprise_tags || []} size="sm" />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">{purchase.item_count} item{Number(purchase.item_count) !== 1 ? 's' : ''}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-bold text-red-700">{formatCurrency(parseFloat(purchase.total_amount || '0'))}</span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer appearance-none text-center ${
                            purchase.payment_status === 'pagado'
                              ? 'bg-green-100 text-green-800'
                              : purchase.payment_status === 'parcial'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                          value={purchase.payment_status}
                          onChange={e => { e.stopPropagation(); handlePaymentStatusChange(purchase.id, e.target.value) }}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="pendiente">Pendiente</option>
                          <option value="parcial">Parcial</option>
                          <option value="pagado">Pagado</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {purchase.invoice_type && (
                            <span className="text-xs font-mono bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                              Fc {purchase.invoice_type}
                            </span>
                          )}
                          <PermissionGate module="purchases" action="edit">
                            <button
                              onClick={e => { e.stopPropagation(); handleEdit(purchase) }}
                              className="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors mr-1"
                              title="Editar compra"
                            >
                              Editar
                            </button>
                          </PermissionGate>
                          <PermissionGate module="purchases" action="delete">
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(purchase) }}
                              className="w-6 h-6 flex items-center justify-center rounded-full text-red-400 hover:bg-red-100 hover:text-red-700 transition-colors text-sm"
                              title="Eliminar compra"
                            >
                              ×
                            </button>
                          </PermissionGate>
                          <span className="text-gray-400 text-xs">{expandedPurchase === purchase.id ? '▲' : '▼'}</span>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedPurchase === purchase.id && (
                      <tr>
                        <td colSpan={7} className="px-0 py-0 border-b-2 border-orange-300">
                          <div className="mx-3 my-3 bg-orange-50 border border-orange-200 rounded-lg shadow-sm overflow-hidden animate-slideDown">
                            <div className="border-l-4 border-orange-500 px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Column 1: Items */}
                                <div className="space-y-2">
                                  <h4 className="text-sm font-semibold text-orange-800 border-b border-orange-200 pb-1">Items de la Compra</h4>
                                  {expandedDetail?.items && expandedDetail.items.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {expandedDetail.items.map((item: any, idx: number) => (
                                        <div key={idx} className="bg-white rounded px-2 py-1.5 border border-orange-100">
                                          <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
                                          {item.description && <p className="text-xs text-gray-500">{item.description}</p>}
                                          <div className="flex gap-3 text-xs text-gray-600 mt-0.5">
                                            <span>Cant: {item.quantity}</span>
                                            <span>P/U: {formatCurrency(parseFloat(item.unit_price || '0'))}</span>
                                            <span className="font-medium text-gray-800">Sub: {formatCurrency(parseFloat(item.subtotal || '0'))}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-400">{purchase.item_count} item(s) - cargando...</p>
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

                                {/* Column 2: Empresa & Notas */}
                                <div className="space-y-2">
                                  <h4 className="text-sm font-semibold text-orange-800 border-b border-orange-200 pb-1">Proveedor y Detalles</h4>
                                  <div>
                                    <p className="text-xs text-gray-500">Empresa</p>
                                    <p className="text-sm text-gray-800 font-medium">{purchase.enterprise_name || 'Sin empresa'}</p>
                                    {purchase.enterprise_cuit && <p className="text-xs text-gray-500 font-mono">{purchase.enterprise_cuit}</p>}
                                    <TagBadges tags={purchase.enterprise_tags || []} size="sm" />
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">Fecha</p>
                                    <p className="text-sm text-gray-800">{formatDate(purchase.date)}</p>
                                  </div>
                                  {purchase.notes && (
                                    <div>
                                      <p className="text-xs text-gray-500">Notas</p>
                                      <p className="text-sm text-gray-700 bg-yellow-50 px-2 py-1 rounded">{purchase.notes}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Column 3: Payment & Invoice */}
                                <div className="space-y-2">
                                  <h4 className="text-sm font-semibold text-orange-800 border-b border-orange-200 pb-1">Facturación y Pago</h4>
                                  <div>
                                    <p className="text-xs text-gray-500">Método de Pago</p>
                                    <p className="text-sm font-medium text-gray-800">
                                      {PAYMENT_METHODS.find(m => m.value === purchase.payment_method)?.label || 'Sin especificar'}
                                    </p>
                                  </div>
                                  {purchase.bank_name && (
                                    <div>
                                      <p className="text-xs text-gray-500">Banco</p>
                                      <p className="text-sm text-gray-800">{purchase.bank_name}</p>
                                    </div>
                                  )}
                                  {purchase.invoice_type ? (
                                    <div className="space-y-1.5">
                                      <div>
                                        <p className="text-xs text-gray-500">Comprobante AFIP</p>
                                        <span className="font-mono text-sm font-semibold text-purple-800 bg-purple-50 border border-purple-200 px-2 py-1 rounded inline-block mt-0.5">
                                          {purchase.invoice_type} {purchase.invoice_number || ''}
                                        </span>
                                      </div>
                                      {purchase.invoice_cae && (
                                        <div>
                                          <p className="text-xs text-gray-500">CAE</p>
                                          <p className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded inline-block">{purchase.invoice_cae}</p>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div>
                                      <p className="text-xs text-gray-500">Comprobante AFIP</p>
                                      <p className="text-sm text-gray-400 italic">Sin factura registrada</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-500">Estado de Pago</p>
                                    <select
                                      className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${
                                        purchase.payment_status === 'pagado' ? 'bg-green-100 text-green-800'
                                        : purchase.payment_status === 'parcial' ? 'bg-yellow-100 text-yellow-800'
                                        : 'bg-red-100 text-red-800'
                                      }`}
                                      value={purchase.payment_status}
                                      onChange={e => handlePaymentStatusChange(purchase.id, e.target.value)}
                                    >
                                      <option value="pendiente">Pendiente</option>
                                      <option value="parcial">Parcial</option>
                                      <option value="pagado">Pagado</option>
                                    </select>
                                  </div>
                                  <div className="pt-2 border-t border-orange-200">
                                    <PermissionGate module="inventory" action="create">
                                      <button
                                        onClick={() => handleAddToInventory(purchase)}
                                        disabled={addingToInventory === purchase.id}
                                        className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                                      >
                                        {addingToInventory === purchase.id ? 'Agregando...' : 'Agregar al inventario'}
                                      </button>
                                      <p className="text-xs text-gray-400 mt-1">Suma stock de los productos que controlan inventario</p>
                                    </PermissionGate>
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
            totalItems={filteredPurchases.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar Compra"
        message={`¿Eliminar compra #${String(deleteTarget?.purchase_number || 0).padStart(4, '0')}?`}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
