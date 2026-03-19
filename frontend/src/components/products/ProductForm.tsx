import React, { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { HelpTip } from '@/components/shared/HelpTip'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { Product, ProductType, Category, ProductForm as ProductFormType } from './types'
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

  // BOM state
  const [bomComponents, setBomComponents] = useState<any[]>([])
  const [bomCost, setBomCost] = useState<number | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [bomNew, setBomNew] = useState({ product_id: '', quantity: '1', unit: 'unidad' })

  const typeNames = productTypes.map(t => typeof t === 'string' ? t : t.name)
  const allTypes = [...new Set([...DEFAULT_TYPES, ...typeNames])].sort()

  const loadBOM = useCallback(async (productId: string) => {
    setBomLoading(true)
    try {
      const [comps, costData] = await Promise.all([
        api.getProductComponents(productId).catch(() => []),
        api.getProductBOMCost(productId).catch(() => null),
      ])
      setBomComponents(comps || [])
      setBomCost(costData?.bom_cost ? parseFloat(costData.bom_cost) : null)
    } catch { setBomComponents([]); setBomCost(null) }
    finally { setBomLoading(false) }
  }, [])

  useEffect(() => {
    if (editingId) loadBOM(editingId)
  }, [editingId, loadBOM])

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
      if (editingId) {
        await api.updateProduct(editingId, payload)
        toast.success('Producto actualizado')
      } else {
        await api.createProduct(payload)
        toast.success('Producto creado')
      }
      onSaved()
    } catch (e: any) {
      toast.error(e.message)
      setError(e.message)
    } finally {
      setSaving(false)
    }
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
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Producto<HelpTip text="Categoria del producto. Configura los tipos disponibles en 'Gestionar tipos' mas abajo." /></label>
              <input
                list="product-types-list"
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.product_type}
                onChange={e => setForm({ ...form, product_type: e.target.value })}
                placeholder="Escribir o elegir tipo..."
              />
              <datalist id="product-types-list">
                {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </datalist>
            </div>
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

          {/* BOM Section */}
          {editingId ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-3">Composicion (BOM)<HelpTip text="Lista de materiales necesarios para fabricar este producto. Cuando se produce, estos materiales se descuentan del inventario." /></h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={bomNew.product_id} onChange={e => setBomNew({ ...bomNew, product_id: e.target.value })}>
                  <option value="">Seleccionar material...</option>
                  {products.filter(p => p.id !== editingId).map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                </select>
                <input type="number" step="0.0001" min="0.0001" placeholder="Cantidad" className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={bomNew.quantity} onChange={e => setBomNew({ ...bomNew, quantity: e.target.value })} />
                <input placeholder="Unidad (unidad, metro, kg...)" className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100" value={bomNew.unit} onChange={e => setBomNew({ ...bomNew, unit: e.target.value })} />
                <Button type="button" variant="primary" onClick={handleAddComponent} disabled={!bomNew.product_id}>+ Agregar</Button>
              </div>
              {bomLoading ? (
                <p className="text-xs text-gray-400">Cargando composicion...</p>
              ) : bomComponents.length > 0 ? (
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
                    {bomComponents.map((comp: any) => (
                      <tr key={comp.id} className="border-t border-amber-200/50 dark:border-amber-800/50">
                        <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200">{comp.component_name}</td>
                        <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 font-mono text-xs">{comp.component_sku}</td>
                        <td className="px-3 py-1.5 text-right dark:text-gray-300">{parseFloat(comp.quantity_required)}</td>
                        <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{comp.unit || 'unidad'}</td>
                        <td className="px-3 py-1.5 text-right dark:text-gray-300">{formatCurrency(parseFloat(comp.component_cost || '0'))}</td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={parseFloat(comp.stock_available || '0') >= parseFloat(comp.quantity_required) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            {parseFloat(comp.stock_available || '0')}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <button type="button" onClick={() => handleRemoveComponent(comp.id)} className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs">x</button>
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
