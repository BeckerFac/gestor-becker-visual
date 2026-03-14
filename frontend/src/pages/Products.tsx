import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DataTable } from '@/components/shared/DataTable'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'

interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  product_type: string | null
  category_id: string | null
  active: boolean
  pricing?: { cost: string; margin_percent: string; vat_rate: string; final_price: string }
}

interface Category {
  id: string
  name: string
  parent_id: string | null
  product_count: number
}

const DEFAULT_TYPES = [
  'portabanner', 'bandera', 'ploteo', 'carteleria', 'vinilo',
  'lona', 'backing', 'senaletica', 'vehicular', 'textil', 'otro',
]

const VAT_OPTIONS = [
  { value: '0', label: '0%' },
  { value: '10.5', label: '10.5%' },
  { value: '21', label: '21%' },
  { value: '27', label: '27%' },
]

const emptyForm = {
  sku: '', name: '', description: '', barcode: '', product_type: 'otro',
  cost: '', margin_percent: '30', vat_rate: '21', final_price: '',
}

export const Products: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastEdited, setLastEdited] = useState<string>('')
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Product types & categories
  const [productTypes, setProductTypes] = useState<string[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParent, setNewCategoryParent] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  // Bulk price update
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkPercent, setBulkPercent] = useState('')
  const [bulkUpdating, setBulkUpdating] = useState(false)

  // Price Lists state
  const [priceLists, setPriceLists] = useState<any[]>([])
  const [expandedListId, setExpandedListId] = useState<string | null>(null)
  const [expandedListItems, setExpandedListItems] = useState<any[]>([])
  const [plForm, setPlForm] = useState({ name: '', type: 'default' })
  const [plSaving, setPlSaving] = useState(false)
  const [plAddProduct, setPlAddProduct] = useState({ product_id: '', price: '', discount_percent: '0' })

  // BOM state
  const [bomComponents, setBomComponents] = useState<any[]>([])
  const [bomCost, setBomCost] = useState<number | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [bomNew, setBomNew] = useState({ product_id: '', quantity: '1', unit: 'unidad' })

  const loadProducts = async () => {
    try {
      setLoading(true)
      const [res, typesRes, catsRes, plRes] = await Promise.all([
        api.getProducts(),
        api.getProductTypes().catch(() => []),
        api.getCategories().catch(() => []),
        api.getPriceLists().catch(() => []),
      ])
      setProducts(res.items || res || [])
      setProductTypes(Array.isArray(typesRes) ? typesRes : [])
      setCategories(Array.isArray(catsRes) ? catsRes : [])
      setPriceLists(Array.isArray(plRes) ? plRes : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProducts() }, [])

  // Bidirectional price calculation
  const recalcFrom = useCallback((field: string, value: string, currentForm: typeof emptyForm) => {
    const cost = field === 'cost' ? (parseFloat(value) || 0) : (parseFloat(currentForm.cost) || 0)
    const margin = field === 'margin_percent' ? (parseFloat(value) || 0) : (parseFloat(currentForm.margin_percent) || 0)
    const vat = field === 'vat_rate' ? (parseFloat(value) || 0) : (parseFloat(currentForm.vat_rate) || 0)
    const finalPrice = field === 'final_price' ? (parseFloat(value) || 0) : (parseFloat(currentForm.final_price) || 0)

    const updated = { ...currentForm, [field]: value }

    if (field === 'final_price') {
      // User changed final price -> recalc margin
      if (cost > 0 && vat >= 0) {
        const priceWithoutVat = finalPrice / (1 + vat / 100)
        const newMargin = ((priceWithoutVat / cost) - 1) * 100
        updated.margin_percent = isFinite(newMargin) && newMargin >= 0 ? newMargin.toFixed(2) : '0'
      }
    } else if (field === 'margin_percent') {
      // User changed margin -> recalc final price
      const newFinal = cost * (1 + margin / 100) * (1 + vat / 100)
      updated.final_price = isFinite(newFinal) ? newFinal.toFixed(2) : '0'
    } else if (field === 'cost') {
      // User changed cost -> recalc final price
      const newCost = parseFloat(value) || 0
      const newFinal = newCost * (1 + margin / 100) * (1 + vat / 100)
      updated.final_price = isFinite(newFinal) ? newFinal.toFixed(2) : '0'
    } else if (field === 'vat_rate') {
      // User changed VAT -> recalc final price
      const newVat = parseFloat(value) || 0
      const newFinal = cost * (1 + margin / 100) * (1 + newVat / 100)
      updated.final_price = isFinite(newFinal) ? newFinal.toFixed(2) : '0'
    }

    return updated
  }, [])

  const handlePriceField = (field: string, value: string) => {
    setLastEdited(field)
    setForm(prev => recalcFrom(field, value, prev))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const cost = parseFloat(form.cost) || 0
      const margin = parseFloat(form.margin_percent) || 0
      const vat = parseFloat(form.vat_rate) || 0
      const finalPrice = parseFloat(form.final_price) || cost * (1 + margin / 100) * (1 + vat / 100)

      const payload = {
        sku: form.sku,
        name: form.name,
        description: form.description || null,
        barcode: form.barcode || null,
        product_type: form.product_type || 'otro',
        cost: cost,
        margin_percent: margin,
        vat_rate: vat,
        final_price: Math.round(finalPrice * 100) / 100,
      }
      if (editingId) {
        await api.updateProduct(editingId, payload)
        toast.success('Producto actualizado')
      } else {
        await api.createProduct(payload)
        toast.success('Producto creado')
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      await loadProducts()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const loadBOM = async (productId: string) => {
    setBomLoading(true)
    try {
      const [comps, costData] = await Promise.all([
        api.getProductComponents(productId),
        api.getProductBOMCost(productId),
      ])
      setBomComponents(comps || [])
      setBomCost(costData?.bom_cost ? parseFloat(costData.bom_cost) : null)
    } catch { setBomComponents([]); setBomCost(null) }
    finally { setBomLoading(false) }
  }

  const handleAddComponent = async () => {
    if (!editingId || !bomNew.product_id) return
    try {
      await api.addProductComponent(editingId, {
        component_product_id: bomNew.product_id,
        quantity_required: parseFloat(bomNew.quantity) || 1,
        unit: bomNew.unit || 'unidad',
      })
      setBomNew({ product_id: '', quantity: '1', unit: 'unidad' })
      await loadBOM(editingId)
      toast.success('Componente agregado')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleRemoveComponent = async (componentId: string) => {
    if (!editingId) return
    try {
      await api.removeProductComponent(editingId, componentId)
      await loadBOM(editingId)
      toast.success('Componente eliminado')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleEdit = (product: Product) => {
    const pricing = product.pricing
    const cost = pricing?.cost || '0'
    const margin = pricing?.margin_percent || '30'
    const vatRate = pricing?.vat_rate || '21'
    const finalPrice = pricing?.final_price || '0'

    setForm({
      sku: product.sku, name: product.name, description: product.description || '',
      barcode: product.barcode || '', product_type: (product as any).product_type || 'otro',
      cost, margin_percent: margin, vat_rate: vatRate, final_price: finalPrice,
    })
    setEditingId(product.id)
    setShowForm(true)
    loadBOM(product.id)
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      await api.createCategory({ name: newCategoryName.trim(), parent_id: newCategoryParent || undefined })
      setNewCategoryName('')
      setNewCategoryParent('')
      const catsRes = await api.getCategories().catch(() => [])
      setCategories(Array.isArray(catsRes) ? catsRes : [])
      toast.success('Categoria creada')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleDeleteCategory = async (catId: string) => {
    try {
      await api.deleteCategory(catId)
      const catsRes = await api.getCategories().catch(() => [])
      setCategories(Array.isArray(catsRes) ? catsRes : [])
      toast.success('Categoria eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  // Price List handlers
  const handleCreatePriceList = async () => {
    if (!plForm.name.trim()) return
    setPlSaving(true)
    try {
      await api.createPriceList({ name: plForm.name.trim(), type: plForm.type })
      setPlForm({ name: '', type: 'default' })
      const plRes = await api.getPriceLists().catch(() => [])
      setPriceLists(Array.isArray(plRes) ? plRes : [])
      toast.success('Lista de precios creada')
    } catch (e: any) { toast.error(e.message) }
    finally { setPlSaving(false) }
  }

  const handleDeletePriceList = async (listId: string) => {
    try {
      await api.deletePriceList(listId)
      if (expandedListId === listId) { setExpandedListId(null); setExpandedListItems([]) }
      const plRes = await api.getPriceLists().catch(() => [])
      setPriceLists(Array.isArray(plRes) ? plRes : [])
      toast.success('Lista de precios eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleExpandPriceList = async (listId: string) => {
    if (expandedListId === listId) { setExpandedListId(null); setExpandedListItems([]); return }
    try {
      const detail = await api.getPriceList(listId)
      setExpandedListItems(detail.items || [])
      setExpandedListId(listId)
    } catch (e: any) { toast.error(e.message) }
  }

  const handleAddProductToList = async () => {
    if (!expandedListId || !plAddProduct.product_id || !plAddProduct.price) return
    try {
      const newItems = [
        ...expandedListItems.map((it: any) => ({
          product_id: it.product_id,
          price: parseFloat(it.price),
          discount_percent: parseFloat(it.discount_percent || '0'),
        })),
        {
          product_id: plAddProduct.product_id,
          price: parseFloat(plAddProduct.price),
          discount_percent: parseFloat(plAddProduct.discount_percent || '0'),
        },
      ]
      const updated = await api.setPriceListItems(expandedListId, newItems)
      setExpandedListItems(updated || [])
      setPlAddProduct({ product_id: '', price: '', discount_percent: '0' })
      const plRes = await api.getPriceLists().catch(() => [])
      setPriceLists(Array.isArray(plRes) ? plRes : [])
      toast.success('Producto agregado a la lista')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleRemoveProductFromList = async (productId: string) => {
    if (!expandedListId) return
    try {
      const newItems = expandedListItems
        .filter((it: any) => it.product_id !== productId)
        .map((it: any) => ({
          product_id: it.product_id,
          price: parseFloat(it.price),
          discount_percent: parseFloat(it.discount_percent || '0'),
        }))
      const updated = await api.setPriceListItems(expandedListId, newItems)
      setExpandedListItems(updated || [])
      const plRes = await api.getPriceLists().catch(() => [])
      setPriceLists(Array.isArray(plRes) ? plRes : [])
      toast.success('Producto removido de la lista')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleBulkPriceUpdate = async () => {
    const pct = parseFloat(bulkPercent)
    if (!pct || selectedIds.size === 0) return
    setBulkUpdating(true)
    try {
      await api.bulkUpdatePrice(Array.from(selectedIds), pct)
      toast.success(`${selectedIds.size} productos actualizados (${pct > 0 ? '+' : ''}${pct}%)`)
      setSelectedIds(new Set())
      setShowBulkModal(false)
      setBulkPercent('')
      await loadProducts()
    } catch (e: any) { toast.error(e.message) }
    finally { setBulkUpdating(false) }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(p => p.id)))
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteProduct(deleteTarget.id)
      toast.success('Producto eliminado')
      await loadProducts()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const allTypes = [...new Set([...DEFAULT_TYPES, ...productTypes])].sort()

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode || '').includes(search)
    const matchCategory = !filterCategory || p.category_id === filterCategory
    return matchSearch && matchCategory
  })

  const getPriceWithoutVat = (pricing: Product['pricing']) => {
    if (!pricing) return null
    const final = parseFloat(pricing.final_price)
    const vat = parseFloat(pricing.vat_rate) || 0
    return final / (1 + vat / 100)
  }

  const columns = [
    { key: 'id' as const, label: '', render: (_: any, row: Product) => (
      <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} onClick={e => e.stopPropagation()} className="rounded border-gray-300" />
    )},
    { key: 'sku' as const, label: 'SKU' },
    { key: 'name' as const, label: 'Producto' },
    { key: 'product_type' as const, label: 'Tipo', render: (v: any) => (
      <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-medium">{v || '-'}</span>
    )},
    { key: 'pricing' as const, label: 'Costo', render: (v: any) => v ? formatCurrency(parseFloat(v.cost)) : '-' },
    { key: 'pricing' as const, label: 'Margen', render: (v: any) => v ? `${v.margin_percent}%` : '-' },
    { key: 'pricing' as const, label: 'IVA', render: (v: any) => v ? `${v.vat_rate}%` : '-' },
    { key: 'pricing' as const, label: 'Sin IVA', render: (v: any) => {
      const p = getPriceWithoutVat(v)
      return p !== null ? <span className="text-gray-600">{formatCurrency(p)}</span> : '-'
    }},
    { key: 'pricing' as const, label: 'Precio Final', render: (v: any) => v ? (
      <span className="font-bold text-green-700">{formatCurrency(parseFloat(v.final_price))}</span>
    ) : '-' },
    { key: 'active' as const, label: 'Estado', render: (v: any) => (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${v ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {v ? 'Activo' : 'Inactivo'}
      </span>
    )},
    { key: 'id' as const, label: 'Acciones', render: (_: any, row: Product) => (
      <div className="flex gap-2">
        <PermissionGate module="products" action="edit">
          <button onClick={(e) => { e.stopPropagation(); handleEdit(row) }} className="text-blue-600 hover:underline text-sm">Editar</button>
        </PermissionGate>
        <PermissionGate module="products" action="delete">
          <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(row) }} className="text-red-600 hover:underline text-sm">Eliminar</button>
        </PermissionGate>
      </div>
    )},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productos</h1>
          <p className="text-sm text-gray-500 mt-1">{products.length} productos registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filtered.map(p => ({
              sku: p.sku,
              nombre: p.name,
              tipo: p.product_type || '-',
              costo: p.pricing ? parseFloat(p.pricing.cost) : '-',
              margen: p.pricing ? `${p.pricing.margin_percent}%` : '-',
              iva: p.pricing ? `${p.pricing.vat_rate}%` : '-',
              precio_final: p.pricing ? parseFloat(p.pricing.final_price) : '-',
              estado: p.active ? 'Activo' : 'Inactivo',
            }))}
            columns={[
              { key: 'sku', label: 'SKU' },
              { key: 'nombre', label: 'Producto' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'costo', label: 'Costo' },
              { key: 'margen', label: 'Margen' },
              { key: 'iva', label: 'IVA' },
              { key: 'precio_final', label: 'Precio Final' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="productos"
          />
          <PermissionGate module="products" action="create">
            <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(!showForm) }}>
              {showForm ? 'Cancelar' : '+ Nuevo Producto'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Input label="SKU *" placeholder="PROD-001" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required />
                <Input label="Nombre *" placeholder="Nombre del producto" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                <Input label="Código de Barras" placeholder="7790001234567" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Tipo de Producto</label>
                  <input
                    list="product-types-list"
                    className="px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.product_type}
                    onChange={e => setForm({ ...form, product_type: e.target.value })}
                    placeholder="Escribir o elegir tipo..."
                  />
                  <datalist id="product-types-list">
                    {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </datalist>
                </div>
              </div>
              <Input label="Descripción" placeholder="Descripción del producto" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />

              {/* Bidirectional Price Fields */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Precios — todos los campos se relacionan entre sí</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Costo (ARS) *</label>
                    <input
                      type="number" step="0.01" placeholder="0.00" required
                      className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 ${lastEdited === 'cost' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
                      value={form.cost}
                      onChange={e => handlePriceField('cost', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Margen %</label>
                    <input
                      type="number" step="0.01" placeholder="30"
                      className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 ${lastEdited === 'margin_percent' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
                      value={form.margin_percent}
                      onChange={e => handlePriceField('margin_percent', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">IVA %</label>
                    <select
                      className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 ${lastEdited === 'vat_rate' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
                      value={form.vat_rate}
                      onChange={e => handlePriceField('vat_rate', e.target.value)}
                    >
                      {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700">Precio Final (ARS)</label>
                    <input
                      type="number" step="0.01" placeholder="0.00"
                      className={`px-3 py-2 border rounded-lg text-lg font-bold focus:outline-none focus:ring-2 focus:ring-green-500 ${lastEdited === 'final_price' ? 'border-green-400 bg-green-50 text-green-800' : 'border-green-300 bg-green-50 text-green-800'}`}
                      value={form.final_price}
                      onChange={e => handlePriceField('final_price', e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">Modificá cualquier campo y los otros se recalculan automáticamente</p>
              </div>

              {/* BOM Section */}
              {editingId ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-amber-800 mb-3">Composicion (Lista de Materiales)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                    <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={bomNew.product_id} onChange={e => setBomNew({ ...bomNew, product_id: e.target.value })}>
                      <option value="">Seleccionar material...</option>
                      {products.filter(p => p.id !== editingId).map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                    </select>
                    <input type="number" step="0.0001" min="0.0001" placeholder="Cantidad" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={bomNew.quantity} onChange={e => setBomNew({ ...bomNew, quantity: e.target.value })} />
                    <input placeholder="Unidad (unidad, metro, kg...)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={bomNew.unit} onChange={e => setBomNew({ ...bomNew, unit: e.target.value })} />
                    <Button type="button" variant="primary" onClick={handleAddComponent} disabled={!bomNew.product_id}>+ Agregar</Button>
                  </div>
                  {bomLoading ? (
                    <p className="text-xs text-gray-400">Cargando composicion...</p>
                  ) : bomComponents.length > 0 ? (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-amber-100/50 text-xs text-amber-700">
                          <th className="px-3 py-1.5 text-left">Material</th>
                          <th className="px-3 py-1.5 text-left">SKU</th>
                          <th className="px-3 py-1.5 text-right">Cantidad</th>
                          <th className="px-3 py-1.5 text-left">Unidad</th>
                          <th className="px-3 py-1.5 text-right">Costo Unit.</th>
                          <th className="px-3 py-1.5 text-right">Stock</th>
                          <th className="px-3 py-1.5 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomComponents.map((comp: any) => (
                          <tr key={comp.id} className="border-t border-amber-200/50">
                            <td className="px-3 py-1.5 text-gray-800">{comp.component_name}</td>
                            <td className="px-3 py-1.5 text-gray-500 font-mono text-xs">{comp.component_sku}</td>
                            <td className="px-3 py-1.5 text-right">{parseFloat(comp.quantity_required)}</td>
                            <td className="px-3 py-1.5 text-gray-600">{comp.unit || 'unidad'}</td>
                            <td className="px-3 py-1.5 text-right">{formatCurrency(parseFloat(comp.component_cost || '0'))}</td>
                            <td className="px-3 py-1.5 text-right">
                              <span className={parseFloat(comp.stock_available || '0') >= parseFloat(comp.quantity_required) ? 'text-green-600' : 'text-red-600'}>
                                {parseFloat(comp.stock_available || '0')}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              <button type="button" onClick={() => handleRemoveComponent(comp.id)} className="text-red-500 hover:text-red-700 text-xs">x</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-gray-400">Sin componentes. Este producto no tiene lista de materiales.</p>
                  )}
                  {bomCost !== null && bomCost > 0 && (
                    <div className="mt-2 flex gap-4 text-xs">
                      <span className="text-amber-700">Costo BOM: <strong>{formatCurrency(bomCost)}</strong></span>
                      <span className="text-gray-500">Costo manual: <strong>{formatCurrency(parseFloat(form.cost || '0'))}</strong></span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">Guarda el producto primero para agregar composicion de materiales.</p>
              )}

              <Button type="submit" variant="success" loading={saving}>{editingId ? 'Guardar Cambios' : 'Crear Producto'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters row */}
      <div className="flex items-center gap-3">
        <Input placeholder="Buscar por nombre, SKU o codigo de barras..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1" />
        {categories.length > 0 && (
          <select
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="">Todas las categorias</option>
            {categories.filter(c => !c.parent_id).map(c => (
              <React.Fragment key={c.id}>
                <option value={c.id}>{c.name} ({c.product_count})</option>
                {categories.filter(sub => sub.parent_id === c.id).map(sub => (
                  <option key={sub.id} value={sub.id}>&nbsp;&nbsp;{sub.name} ({sub.product_count})</option>
                ))}
              </React.Fragment>
            ))}
          </select>
        )}
        {selectedIds.size > 0 && (
          <Button variant="secondary" onClick={() => setShowBulkModal(true)}>
            Aumentar precio ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* Categories management (collapsible) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Gestionar categorias ({categories.length})</summary>
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input placeholder="Nombre categoria..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1" />
            <select value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
              <option value="">Sin padre</option>
              {categories.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="primary" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>+ Crear</Button>
          </div>
          {categories.length > 0 && (
            <div className="space-y-1">
              {categories.filter(c => !c.parent_id).map(c => (
                <div key={c.id}>
                  <div className="flex items-center justify-between py-1 px-2 bg-white rounded">
                    <span className="font-medium">{c.name} <span className="text-gray-400 text-xs">({c.product_count})</span></span>
                    <button onClick={() => handleDeleteCategory(c.id)} className="text-red-500 text-xs hover:underline">Eliminar</button>
                  </div>
                  {categories.filter(sub => sub.parent_id === c.id).map(sub => (
                    <div key={sub.id} className="flex items-center justify-between py-1 px-2 ml-6 bg-white rounded">
                      <span className="text-gray-600">{sub.name} <span className="text-gray-400 text-xs">({sub.product_count})</span></span>
                      <button onClick={() => handleDeleteCategory(sub.id)} className="text-red-500 text-xs hover:underline">Eliminar</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Price Lists management (collapsible) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Listas de precios ({priceLists.length})</summary>
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input placeholder="Nombre de la lista..." value={plForm.name} onChange={e => setPlForm({ ...plForm, name: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1" />
            <select value={plForm.type} onChange={e => setPlForm({ ...plForm, type: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
              <option value="default">General</option>
              <option value="customer">Cliente</option>
              <option value="channel">Canal</option>
              <option value="promo">Promocion</option>
            </select>
            <Button variant="primary" onClick={handleCreatePriceList} loading={plSaving} disabled={!plForm.name.trim()}>+ Crear</Button>
          </div>
          {priceLists.length > 0 && (
            <div className="space-y-2">
              {priceLists.map((pl: any) => (
                <div key={pl.id} className="bg-white border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleExpandPriceList(pl.id)}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{expandedListId === pl.id ? '▼' : '▶'}</span>
                      <span className="font-medium">{pl.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{pl.type}</span>
                      <span className="text-gray-400 text-xs">{pl.item_count} producto{Number(pl.item_count) !== 1 ? 's' : ''}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleDeletePriceList(pl.id) }} className="text-red-500 text-xs hover:underline">Eliminar</button>
                  </div>
                  {expandedListId === pl.id && (
                    <div className="border-t border-gray-200 px-3 py-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <select value={plAddProduct.product_id} onChange={e => {
                          const pid = e.target.value
                          const prod = products.find(p => p.id === pid)
                          setPlAddProduct({
                            ...plAddProduct,
                            product_id: pid,
                            price: prod?.pricing?.final_price || '',
                          })
                        }} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm flex-1">
                          <option value="">Agregar producto...</option>
                          {products.filter(p => !expandedListItems.some((it: any) => it.product_id === p.id)).map(p => (
                            <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
                          ))}
                        </select>
                        <input type="number" step="0.01" placeholder="Precio" value={plAddProduct.price} onChange={e => setPlAddProduct({ ...plAddProduct, price: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-28" />
                        <input type="number" step="0.01" placeholder="Dto %" value={plAddProduct.discount_percent} onChange={e => setPlAddProduct({ ...plAddProduct, discount_percent: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm w-20" />
                        <Button variant="primary" onClick={handleAddProductToList} disabled={!plAddProduct.product_id || !plAddProduct.price}>+</Button>
                      </div>
                      {expandedListItems.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 text-xs border-b">
                              <th className="pb-1 font-medium">SKU</th>
                              <th className="pb-1 font-medium">Producto</th>
                              <th className="pb-1 font-medium text-right">Precio Lista</th>
                              <th className="pb-1 font-medium text-right">Dto %</th>
                              <th className="pb-1 font-medium text-right">Precio Base</th>
                              <th className="pb-1 w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {expandedListItems.map((item: any) => (
                              <tr key={item.id} className="border-b border-gray-100">
                                <td className="py-1 font-mono text-xs text-gray-500">{item.product_sku}</td>
                                <td className="py-1 text-gray-800">{item.product_name}</td>
                                <td className="py-1 text-right font-semibold text-green-700">{formatCurrency(parseFloat(item.price))}</td>
                                <td className="py-1 text-right text-gray-600">{parseFloat(item.discount_percent || '0')}%</td>
                                <td className="py-1 text-right text-gray-400">{item.current_price ? formatCurrency(parseFloat(item.current_price)) : '-'}</td>
                                <td className="py-1">
                                  <button onClick={() => handleRemoveProductFromList(item.product_id)} className="text-red-500 hover:text-red-700 text-xs">x</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-xs text-gray-400 text-center py-2">Sin productos en esta lista.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Bulk price modal */}
      {showBulkModal && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4">
            <h4 className="text-sm font-semibold text-blue-800 mb-3">Aumento masivo de precios — {selectedIds.size} producto{selectedIds.size > 1 ? 's' : ''}</h4>
            <div className="flex items-center gap-3">
              <input type="number" step="0.1" placeholder="Ej: 15 para +15%" value={bulkPercent} onChange={e => setBulkPercent(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-40" />
              <span className="text-sm text-gray-600">%</span>
              <Button variant="success" onClick={handleBulkPriceUpdate} loading={bulkUpdating} disabled={!bulkPercent}>Aplicar</Button>
              <Button variant="secondary" onClick={() => { setShowBulkModal(false); setBulkPercent('') }}>Cancelar</Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Usa valores negativos para disminuir (ej: -10 para -10%)</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? 'Sin resultados' : 'Sin productos'}
          description={search ? `No se encontraron productos para "${search}"` : 'Crea tu primer producto para empezar.'}
          action={!search ? { label: '+ Nuevo Producto', onClick: () => setShowForm(true) } : undefined}
        />
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar producto"
        message={`¿Seguro que querés eliminar "${deleteTarget?.name}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
