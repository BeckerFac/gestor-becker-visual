import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { DataTable } from '@/components/shared/DataTable'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'

interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  product_type: string | null
  active: boolean
  pricing?: { cost: string; margin_percent: string; vat_rate: string; final_price: string }
}

const PRODUCT_TYPES = [
  { value: 'portabanner', label: 'Portabanner' },
  { value: 'bandera', label: 'Bandera' },
  { value: 'ploteo', label: 'Ploteo' },
  { value: 'carteleria', label: 'Cartelería' },
  { value: 'vinilo', label: 'Vinilo' },
  { value: 'lona', label: 'Lona' },
  { value: 'backing', label: 'Backing' },
  { value: 'senaletica', label: 'Señalética' },
  { value: 'vehicular', label: 'Vehicular' },
  { value: 'textil', label: 'Textil' },
  { value: 'otro', label: 'Otro' },
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

  const loadProducts = async () => {
    try {
      setLoading(true)
      const res = await api.getProducts()
      setProducts(res.items || res || [])
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
      } else {
        await api.createProduct(payload)
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      await loadProducts()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
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
  }

  const handleDelete = async (product: Product) => {
    if (!confirm(`¿Eliminar producto "${product.name}"?`)) return
    try {
      await api.deleteProduct(product.id)
      await loadProducts()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    (p.barcode || '').includes(search)
  )

  const columns = [
    { key: 'sku' as const, label: 'SKU' },
    { key: 'name' as const, label: 'Producto' },
    { key: 'product_type' as const, label: 'Tipo', render: (v: any) => {
      const t = PRODUCT_TYPES.find(pt => pt.value === v)
      return <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 font-medium">{t?.label || v || '-'}</span>
    }},
    { key: 'pricing' as const, label: 'Costo', render: (v: any) => v ? formatCurrency(parseFloat(v.cost)) : '-' },
    { key: 'pricing' as const, label: 'Margen', render: (v: any) => v ? `${v.margin_percent}%` : '-' },
    { key: 'pricing' as const, label: 'IVA', render: (v: any) => v ? `${v.vat_rate}%` : '-' },
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
        <button onClick={(e) => { e.stopPropagation(); handleEdit(row) }} className="text-blue-600 hover:underline text-sm">Editar</button>
        <button onClick={(e) => { e.stopPropagation(); handleDelete(row) }} className="text-red-600 hover:underline text-sm">Eliminar</button>
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
        <Button variant={showForm ? 'danger' : 'primary'} onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(!showForm) }}>
          {showForm ? 'Cancelar' : '+ Nuevo Producto'}
        </Button>
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
                    {PRODUCT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                    <input
                      type="number" step="0.01" placeholder="21"
                      list="vat-rate-list"
                      className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 ${lastEdited === 'vat_rate' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
                      value={form.vat_rate}
                      onChange={e => handlePriceField('vat_rate', e.target.value)}
                    />
                    <datalist id="vat-rate-list">
                      <option value="0">0%</option>
                      <option value="10.5">10.5%</option>
                      <option value="21">21%</option>
                      <option value="27">27%</option>
                    </datalist>
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

              <Button type="submit" variant="success" loading={saving}>{editingId ? 'Guardar Cambios' : 'Crear Producto'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Input placeholder="Buscar por nombre, SKU o código de barras..." value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <Card><CardContent><p className="text-center py-8 text-gray-500">Cargando productos...</p></CardContent></Card>
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}
    </div>
  )
}
