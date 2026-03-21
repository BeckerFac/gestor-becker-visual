import React, { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { HelpTip } from '@/components/shared/HelpTip'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { Product, ProductType, Category, ProductForm as ProductFormType, Material, ProductMaterial } from './types'
import { VAT_OPTIONS, DEFAULT_TYPES, emptyForm } from './types'

interface ProductFormProps {
  editingId: string | null
  initialForm?: ProductFormType
  productTypes: ProductType[]
  products: Product[]
  categories?: Category[]
  onSaved: () => void
  onCancel: () => void
}

export const ProductForm: React.FC<ProductFormProps> = ({
  editingId,
  initialForm,
  productTypes,
  products,
  categories = [],
  onSaved,
  onCancel,
}) => {
  const [form, setForm] = useState<ProductFormType>(initialForm || emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastEdited, setLastEdited] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>((initialForm as any)?.category_id || '')
  const [categoryDefaultApplied, setCategoryDefaultApplied] = useState<string | null>(null)

  // Price criteria state
  const [priceCriteria, setPriceCriteria] = useState<{ id: string; name: string; sort_order: number }[]>([])
  const [criteriaProductPrices, setCriteriaProductPrices] = useState<Record<string, string>>({})
  const [newCriteriaName, setNewCriteriaName] = useState('')
  const [creatingCriteria, setCreatingCriteria] = useState(false)

  // BOM state (materials-based)
  const [bomMaterials, setBomMaterials] = useState<ProductMaterial[]>([])
  const [bomCost, setBomCost] = useState<number | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [bomNew, setBomNew] = useState({ material_id: '', quantity: '1', unit: 'unidad' })
  const [availableMaterials, setAvailableMaterials] = useState<Material[]>([])

  const typeNames = productTypes.map(t => typeof t === 'string' ? t : t.name)
  const allTypes = [...new Set([...DEFAULT_TYPES, ...typeNames])].sort()

  const loadBOM = useCallback(async (productId: string) => {
    setBomLoading(true)
    try {
      const [mats, costData, allMats] = await Promise.all([
        api.getProductMaterials(productId).catch(() => []),
        api.getProductMaterialBOMCost(productId).catch(() => null),
        api.getMaterials().catch(() => ({ items: [] })),
      ])
      setBomMaterials(mats || [])
      setBomCost(costData?.bom_cost ? parseFloat(costData.bom_cost) : null)
      setAvailableMaterials(allMats?.items || allMats || [])
    } catch { setBomMaterials([]); setBomCost(null) }
    finally { setBomLoading(false) }
  }, [])

  const loadPriceCriteria = useCallback(async (productId?: string) => {
    try {
      const criteria = await api.getPriceCriteria().catch(() => [])
      setPriceCriteria(Array.isArray(criteria) ? criteria : [])
      if (productId) {
        const productPrices = await api.getProductPrices(productId).catch(() => [])
        const priceMap: Record<string, string> = {}
        for (const pp of (Array.isArray(productPrices) ? productPrices : [])) {
          priceMap[pp.criteria_name] = String(pp.price)
        }
        setCriteriaProductPrices(priceMap)
      }
    } catch { setPriceCriteria([]); setCriteriaProductPrices({}) }
  }, [])

  useEffect(() => {
    if (editingId) {
      loadBOM(editingId)
      loadPriceCriteria(editingId)
    } else {
      loadPriceCriteria()
      // Load materials list even for new products
      api.getMaterials().then(res => setAvailableMaterials(res?.items || res || [])).catch(() => {})
    }
  }, [editingId, loadBOM, loadPriceCriteria])

  const recalcFrom = useCallback((field: string, value: string, currentForm: ProductFormType) => {
    const cost = field === 'cost' ? (parseFloat(value) || 0) : (parseFloat(currentForm.cost) || 0)
    const margin = field === 'margin_percent' ? (parseFloat(value) || 0) : (parseFloat(currentForm.margin_percent) || 0)
    const vat = field === 'vat_rate' ? (parseFloat(value) || 0) : (parseFloat(currentForm.vat_rate) || 0)
    const finalPrice = field === 'final_price' ? (parseFloat(value) || 0) : (parseFloat(currentForm.final_price) || 0)

    const updated = { ...currentForm, [field]: value }

    if (field === 'final_price') {
      if (cost > 0 && vat >= 0) {
        const priceWithoutVat = finalPrice / (1 + vat / 100)
        const newMargin = ((priceWithoutVat / cost) - 1) * 100
        updated.margin_percent = isFinite(newMargin) && newMargin >= 0 ? newMargin.toFixed(2) : '0'
      }
    } else if (field === 'margin_percent') {
      const newFinal = cost * (1 + margin / 100) * (1 + vat / 100)
      updated.final_price = isFinite(newFinal) ? newFinal.toFixed(2) : '0'
    } else if (field === 'cost') {
      const newCost = parseFloat(value) || 0
      const newFinal = newCost * (1 + margin / 100) * (1 + vat / 100)
      updated.final_price = isFinite(newFinal) ? newFinal.toFixed(2) : '0'
    } else if (field === 'vat_rate') {
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

  const handleCategoryChange = async (newCategoryId: string) => {
    setCategoryId(newCategoryId)
    // Only auto-fill defaults for NEW products (not editing)
    if (!editingId && newCategoryId) {
      try {
        const defaults = await api.getCategoryDefaults(newCategoryId)
        if (defaults) {
          const updates: Partial<ProductFormType> = {}
          let applyHint = ''
          if (defaults.vat_rate !== undefined && defaults.vat_rate !== null) {
            updates.vat_rate = String(defaults.vat_rate)
            applyHint += `IVA: ${defaults.vat_rate}%`
          }
          if (defaults.margin_percent !== undefined && defaults.margin_percent !== null) {
            updates.margin_percent = String(defaults.margin_percent)
            if (applyHint) applyHint += ', '
            applyHint += `Margen: ${defaults.margin_percent}%`
          }
          if (Object.keys(updates).length > 0) {
            setForm(prev => {
              let updated = { ...prev, ...updates }
              // Recalc final price if cost exists
              if (prev.cost) {
                const cost = parseFloat(prev.cost) || 0
                const margin = parseFloat(updates.margin_percent || prev.margin_percent) || 0
                const vat = parseFloat(updates.vat_rate || prev.vat_rate) || 0
                const newFinal = cost * (1 + margin / 100) * (1 + vat / 100)
                updated = { ...updated, final_price: isFinite(newFinal) ? newFinal.toFixed(2) : '0' }
              }
              return updated
            })
            setCategoryDefaultApplied(applyHint)
          } else {
            setCategoryDefaultApplied(null)
          }
        }
      } catch { /* ignore */ }
    } else {
      setCategoryDefaultApplied(null)
    }
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
        category_id: categoryId || null,
        cost: cost,
        margin_percent: margin,
        vat_rate: vat,
        final_price: Math.round(finalPrice * 100) / 100,
        controls_stock: form.controls_stock,
        low_stock_threshold: form.controls_stock ? parseFloat(form.low_stock_threshold) || 0 : 0,
      }
      let productId = editingId
      if (editingId) {
        await api.updateProduct(editingId, payload)
      } else {
        const created = await api.createProduct(payload)
        productId = created?.id || created?.product?.id
      }

      // Save criteria prices if any
      if (productId) {
        const pricesObj: Record<string, number> = {}
        for (const [name, val] of Object.entries(criteriaProductPrices)) {
          if (val !== '' && val !== undefined) {
            pricesObj[name] = parseFloat(val) || 0
          }
        }
        if (Object.keys(pricesObj).length > 0) {
          await api.setProductPrices(productId, pricesObj).catch(() => {})
        }
      }

      toast.success(editingId ? 'Producto actualizado' : 'Producto creado')
      onSaved()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAddMaterial = async () => {
    if (!editingId || !bomNew.material_id) return
    try {
      const currentMats = bomMaterials.map(m => ({
        material_id: m.material_id,
        quantity: parseFloat(String(m.quantity)),
        unit: m.unit,
      }))
      // Check if already exists
      if (currentMats.some(m => m.material_id === bomNew.material_id)) {
        toast.error('Este material ya esta en la composicion')
        return
      }
      currentMats.push({
        material_id: bomNew.material_id,
        quantity: parseFloat(bomNew.quantity) || 1,
        unit: bomNew.unit || 'unidad',
      })
      await api.setProductMaterials(editingId, currentMats)
      setBomNew({ material_id: '', quantity: '1', unit: 'unidad' })
      await loadBOM(editingId)
      toast.success('Material agregado')
    } catch (e: any) { toast.error(e.response?.data?.error || e.message) }
  }

  const handleRemoveMaterial = async (materialId: string) => {
    if (!editingId) return
    try {
      const updatedMats = bomMaterials
        .filter(m => m.material_id !== materialId)
        .map(m => ({
          material_id: m.material_id,
          quantity: parseFloat(String(m.quantity)),
          unit: m.unit,
        }))
      await api.setProductMaterials(editingId, updatedMats)
      await loadBOM(editingId)
      toast.success('Material eliminado de la composicion')
    } catch (e: any) { toast.error(e.response?.data?.error || e.message) }
  }

  return (
    <Card>
      <CardHeader><h3 className="text-lg font-semibold dark:text-gray-100">{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h3></CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mb-4">
            {error}
            <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SKU *<HelpTip text="Codigo unico del producto. Se genera automaticamente pero podes editarlo." /></label>
              <Input placeholder="PROD-001" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} required />
            </div>
            <Input label="Nombre *" placeholder="Nombre del producto" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Codigo de Barras<HelpTip text="Opcional. Escaneable desde lectores de barras." /></label>
              <Input placeholder="7790001234567" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} />
            </div>
            {/* Tipo is now determined by category - shown as read-only info if category is selected */}
            {categoryId && categories.length > 0 && (() => {
              const cat = categories.find(c => c.id === categoryId)
              return cat ? (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                  <div className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-base bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    {cat.name}
                  </div>
                </div>
              ) : null
            })()}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Descripcion" placeholder="Descripcion del producto" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            {categories.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Categoria
                  <HelpTip text="Asigna una categoria al producto. Los defaults de IVA y margen de la categoria se aplican automaticamente al crear." />
                </label>
                <select
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={categoryId}
                  onChange={e => handleCategoryChange(e.target.value)}
                >
                  <option value="">Sin categoria</option>
                  {categories.filter(c => !c.parent_id).map(c => (
                    <React.Fragment key={c.id}>
                      <option value={c.id}>{c.name}</option>
                      {categories.filter(sub => sub.parent_id === c.id).map(sub => (
                        <option key={sub.id} value={sub.id}>{'  -- '}{sub.name}</option>
                      ))}
                    </React.Fragment>
                  ))}
                </select>
                {categoryDefaultApplied && (
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    Defaults de categoria aplicados: {categoryDefaultApplied}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Stock control */}
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.controls_stock}
                  onChange={e => setForm({ ...form, controls_stock: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Controla stock<HelpTip text="Activa para llevar control de inventario. El stock se descuenta automaticamente en pedidos y se suma en compras." /></span>
              </label>
              {form.controls_stock && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 dark:text-gray-400">Alerta stock bajo:</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-24 bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    value={form.low_stock_threshold}
                    onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })}
                    placeholder="0"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {form.controls_stock
                ? 'Este producto se descontara del inventario en pedidos y se sumara en compras'
                : 'Activar para gestionar el stock de este producto'}
            </p>
          </div>

          {/* Bidirectional Price Fields */}
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Precios -- todos los campos se relacionan entre si</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Costo (ARS) *<HelpTip text="Precio al que compras este producto. Se usa para calcular el margen." /></label>
                <input
                  type="number" step="0.01" placeholder="0.00" required
                  className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 ${lastEdited === 'cost' ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100' : 'border-gray-300 dark:border-gray-600'}`}
                  value={form.cost}
                  onChange={e => handlePriceField('cost', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Margen %<HelpTip text="Porcentaje de ganancia sobre el costo. Modifica el precio final automaticamente." /></label>
                <input
                  type="number" step="0.01" placeholder="30"
                  className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 ${lastEdited === 'margin_percent' ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100' : 'border-gray-300 dark:border-gray-600'}`}
                  value={form.margin_percent}
                  onChange={e => handlePriceField('margin_percent', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">IVA %</label>
                <select
                  className={`px-3 py-2 border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 ${lastEdited === 'vat_rate' ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100' : 'border-gray-300 dark:border-gray-600'}`}
                  value={form.vat_rate}
                  onChange={e => handlePriceField('vat_rate', e.target.value)}
                >
                  {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Precio Final (ARS)</label>
                <input
                  type="number" step="0.01" placeholder="0.00"
                  className={`px-3 py-2 border rounded-lg text-lg font-bold focus:outline-none focus:ring-2 focus:ring-green-500 ${lastEdited === 'final_price' ? 'border-green-400 bg-green-50 text-green-800 dark:border-green-600 dark:bg-green-900/30 dark:text-green-100' : 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-100'}`}
                  value={form.final_price}
                  onChange={e => handlePriceField('final_price', e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">Modifica cualquier campo y los otros se recalculan automaticamente</p>
          </div>

          {/* Price Criteria Section */}
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Precios por lista</h4>

            {/* Base price (read-only) */}
            <div className="flex items-center justify-between py-2 px-3 bg-green-50 dark:bg-green-900/20 rounded-lg mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Base</span>
              <span className="text-sm font-bold text-green-700 dark:text-green-400">
                {formatCurrency(parseFloat(form.final_price) || 0)}
              </span>
            </div>

            {/* Criteria rows */}
            {priceCriteria.map(c => (
              <div key={c.id} className="flex items-center gap-2 py-1.5 px-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg mb-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{c.name}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Usar precio base"
                    className="w-32 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100 text-right"
                    value={criteriaProductPrices[c.name] ?? ''}
                    onChange={e => setCriteriaProductPrices(prev => ({ ...prev, [c.name]: e.target.value }))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCriteriaProductPrices(prev => {
                      const next = { ...prev }
                      delete next[c.name]
                      return next
                    })
                  }}
                  className="text-red-400 hover:text-red-600 text-xs px-1"
                  title="Quitar precio (usar base)"
                >
                  x
                </button>
              </div>
            ))}

            {/* Add criteria inline */}
            <div className="flex items-center gap-2 mt-2">
              <input
                className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                placeholder="Nuevo criterio (ej: Mayorista)"
                value={newCriteriaName}
                onChange={e => setNewCriteriaName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (!newCriteriaName.trim()) return
                    setCreatingCriteria(true)
                    api.createPriceCriteria(newCriteriaName.trim())
                      .then(() => { setNewCriteriaName(''); loadPriceCriteria(editingId || undefined) })
                      .catch((err: any) => toast.error(err.message || 'Error al crear criterio'))
                      .finally(() => setCreatingCriteria(false))
                  }
                }}
              />
              <button
                type="button"
                disabled={creatingCriteria || !newCriteriaName.trim()}
                onClick={() => {
                  if (!newCriteriaName.trim()) return
                  setCreatingCriteria(true)
                  api.createPriceCriteria(newCriteriaName.trim())
                    .then(() => { setNewCriteriaName(''); loadPriceCriteria(editingId || undefined) })
                    .catch((err: any) => toast.error(err.message || 'Error al crear criterio'))
                    .finally(() => setCreatingCriteria(false))
                }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {creatingCriteria ? '...' : '+ Agregar criterio'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Los precios por lista se guardan junto con el producto</p>
          </div>

          {/* BOM Section (Materials) */}
          {editingId ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-3">
                Composicion (BOM)
                <HelpTip text="Selecciona los materiales necesarios para fabricar 1 unidad de este producto. Al agregar stock del producto, los materiales se descuentan automaticamente." />
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                <select
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={bomNew.material_id}
                  onChange={e => setBomNew({ ...bomNew, material_id: e.target.value })}
                >
                  <option value="">Seleccionar material...</option>
                  {availableMaterials.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.sku ? `${m.sku} - ` : ''}{m.name} ({m.unit})</option>
                  ))}
                </select>
                <input
                  type="number" step="0.0001" min="0.0001" placeholder="Cantidad"
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={bomNew.quantity}
                  onChange={e => setBomNew({ ...bomNew, quantity: e.target.value })}
                />
                <input
                  placeholder="Unidad (unidad, metro, kg...)"
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={bomNew.unit}
                  onChange={e => setBomNew({ ...bomNew, unit: e.target.value })}
                />
                <Button type="button" variant="primary" onClick={handleAddMaterial} disabled={!bomNew.material_id}>+ Agregar</Button>
              </div>
              {availableMaterials.length === 0 && !bomLoading && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                  No hay materiales cargados. Crealos primero en la pestana "Materiales".
                </p>
              )}
              {bomLoading ? (
                <p className="text-xs text-gray-400">Cargando composicion...</p>
              ) : bomMaterials.length > 0 ? (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-amber-100/50 dark:bg-amber-900/30 text-xs text-amber-700 dark:text-amber-400">
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
                    {bomMaterials.map((mat: any) => {
                      const matCost = parseFloat(mat.material_cost || '0')
                      const matStock = parseFloat(mat.material_stock || '0')
                      const qty = parseFloat(mat.quantity || '0')
                      return (
                        <tr key={mat.id} className="border-t border-amber-200/50 dark:border-amber-800/50">
                          <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200">{mat.material_name}</td>
                          <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 font-mono text-xs">{mat.material_sku || '-'}</td>
                          <td className="px-3 py-1.5 text-right dark:text-gray-300">{qty}</td>
                          <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{mat.material_unit || mat.unit || 'unidad'}</td>
                          <td className="px-3 py-1.5 text-right dark:text-gray-300">{formatCurrency(matCost)}</td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={matStock >= qty ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {matStock}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <button type="button" onClick={() => handleRemoveMaterial(mat.material_id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs">x</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-amber-300 dark:border-amber-700">
                      <td colSpan={4} className="px-3 py-1.5 text-right text-xs font-semibold text-amber-700 dark:text-amber-400">Total BOM:</td>
                      <td className="px-3 py-1.5 text-right text-xs font-bold text-amber-800 dark:text-amber-300">
                        {formatCurrency(bomMaterials.reduce((acc: number, m: any) => acc + (parseFloat(m.material_cost || '0') * parseFloat(m.quantity || '0')), 0))}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <p className="text-xs text-gray-400">Sin materiales. Este producto no tiene lista de materiales.</p>
              )}
              {bomCost !== null && bomCost > 0 && (
                <div className="mt-2 flex gap-4 text-xs">
                  <span className="text-amber-700 dark:text-amber-400">Costo BOM: <strong>{formatCurrency(bomCost)}</strong></span>
                  <span className="text-gray-500 dark:text-gray-400">Costo manual: <strong>{formatCurrency(parseFloat(form.cost || '0'))}</strong></span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Guarda el producto primero para agregar composicion de materiales.</p>
          )}

          <div className="flex gap-3">
            <Button type="submit" variant="success" loading={saving}>{editingId ? 'Guardar Cambios' : 'Crear Producto'}</Button>
            <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
