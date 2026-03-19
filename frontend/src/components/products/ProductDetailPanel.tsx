import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { HelpTip } from '@/components/shared/HelpTip'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { Product, StockMovement } from './types'
import { VAT_OPTIONS } from './types'

interface ProductDetailPanelProps {
  product: Product
  products: Product[]
  onClose: () => void
  onSaved: () => void
}

export const ProductDetailPanel: React.FC<ProductDetailPanelProps> = ({
  product,
  products,
  onClose,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'precios' | 'stock' | 'composicion'>('general')
  const [saving, setSaving] = useState(false)

  // General form
  const [generalForm, setGeneralForm] = useState({
    sku: product.sku,
    name: product.name,
    description: product.description || '',
    barcode: product.barcode || '',
    product_type: product.product_type || 'otro',
    active: product.active,
    controls_stock: !!product.controls_stock,
  })

  // Pricing form
  const [pricingForm, setPricingForm] = useState({
    cost: product.pricing?.cost || '0',
    margin_percent: product.pricing?.margin_percent || '30',
    vat_rate: product.pricing?.vat_rate || '21',
    final_price: product.pricing?.final_price || '0',
  })
  const [lastEdited, setLastEdited] = useState('')

  // Stock
  const [stockQty] = useState(parseFloat(String(product.stock_quantity ?? 0)))
  const [lowThreshold, setLowThreshold] = useState(String(product.low_stock_threshold || '0'))
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [movementsLoading, setMovementsLoading] = useState(false)

  // Adjust stock form
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  // BOM
  const [bomComponents, setBomComponents] = useState<any[]>([])
  const [bomCost, setBomCost] = useState<number | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [bomNew, setBomNew] = useState({ product_id: '', quantity: '1', unit: 'unidad' })

  // Price lists for this product
  const [productPriceLists, setProductPriceLists] = useState<any[]>([])

  // Price history
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [priceHistoryTotal, setPriceHistoryTotal] = useState(0)
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false)
  const [priceHistoryLimit, setPriceHistoryLimit] = useState(20)

  // Load stock movements
  const loadMovements = useCallback(async () => {
    setMovementsLoading(true)
    try {
      const res = await api.getStockMovements({ product_id: product.id, limit: 10 })
      setMovements(res.items || [])
    } catch { setMovements([]) }
    finally { setMovementsLoading(false) }
  }, [product.id])

  // Load BOM
  const loadBOM = useCallback(async () => {
    setBomLoading(true)
    try {
      const [comps, costData] = await Promise.all([
        api.getProductComponents(product.id).catch(() => []),
        api.getProductBOMCost(product.id).catch(() => null),
      ])
      setBomComponents(comps || [])
      setBomCost(costData?.bom_cost ? parseFloat(costData.bom_cost) : null)
    } catch { setBomComponents([]); setBomCost(null) }
    finally { setBomLoading(false) }
  }, [product.id])

  // Load price lists
  const loadPriceLists = useCallback(async () => {
    try {
      const lists = await api.getPriceLists()
      const relevant: any[] = []
      for (const list of (Array.isArray(lists) ? lists : [])) {
        try {
          const detail = await api.getPriceList(list.id)
          const found = (detail.items || []).find((it: any) => it.product_id === product.id)
          if (found) {
            relevant.push({ list_name: list.name, list_type: list.type, price: found.price, discount_percent: found.discount_percent })
          }
        } catch { /* skip */ }
      }
      setProductPriceLists(relevant)
    } catch { setProductPriceLists([]) }
  }, [product.id])

  // Load price history
  const loadPriceHistory = useCallback(async (limit: number = 20) => {
    setPriceHistoryLoading(true)
    try {
      const res = await api.getPriceHistory(product.id, limit)
      setPriceHistory(res.items || [])
      setPriceHistoryTotal(res.total || 0)
    } catch { setPriceHistory([]); setPriceHistoryTotal(0) }
    finally { setPriceHistoryLoading(false) }
  }, [product.id])

  useEffect(() => {
    if (activeTab === 'stock') loadMovements()
    if (activeTab === 'composicion') loadBOM()
    if (activeTab === 'precios') {
      loadPriceLists()
      loadPriceHistory(10)
    }
  }, [activeTab, loadMovements, loadBOM, loadPriceLists, loadPriceHistory])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Bidirectional pricing
  const recalcFrom = (field: string, value: string) => {
    const cost = field === 'cost' ? (parseFloat(value) || 0) : (parseFloat(pricingForm.cost) || 0)
    const margin = field === 'margin_percent' ? (parseFloat(value) || 0) : (parseFloat(pricingForm.margin_percent) || 0)
    const vat = field === 'vat_rate' ? (parseFloat(value) || 0) : (parseFloat(pricingForm.vat_rate) || 0)
    const finalPrice = field === 'final_price' ? (parseFloat(value) || 0) : (parseFloat(pricingForm.final_price) || 0)

    const updated = { ...pricingForm, [field]: value }

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

    setPricingForm(updated)
    setLastEdited(field)
  }

  const handleSaveGeneral = async () => {
    setSaving(true)
    try {
      await api.updateProduct(product.id, {
        sku: generalForm.sku,
        name: generalForm.name,
        description: generalForm.description || null,
        barcode: generalForm.barcode || null,
        product_type: generalForm.product_type,
        controls_stock: generalForm.controls_stock,
      })
      toast.success('Producto actualizado')
      onSaved()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleSavePricing = async () => {
    setSaving(true)
    try {
      const cost = parseFloat(pricingForm.cost) || 0
      const margin = parseFloat(pricingForm.margin_percent) || 0
      const vat = parseFloat(pricingForm.vat_rate) || 0
      const finalPrice = parseFloat(pricingForm.final_price) || cost * (1 + margin / 100) * (1 + vat / 100)
      await api.updateProduct(product.id, {
        cost, margin_percent: margin, vat_rate: vat, final_price: Math.round(finalPrice * 100) / 100,
      })
      toast.success('Precios actualizados')
      onSaved()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleSaveThreshold = async () => {
    setSaving(true)
    try {
      await api.updateProduct(product.id, { low_stock_threshold: parseFloat(lowThreshold) || 0 })
      toast.success('Umbral actualizado')
      onSaved()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleAdjustStock = async () => {
    if (!adjustQty || !adjustReason) return
    setSaving(true)
    try {
      await api.adjustStock({
        product_id: product.id,
        quantity_change: parseFloat(adjustQty),
        reason: adjustReason,
      })
      toast.success('Stock ajustado')
      setShowAdjust(false)
      setAdjustQty('')
      setAdjustReason('')
      await loadMovements()
      onSaved()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleAddComponent = async () => {
    if (!bomNew.product_id) return
    try {
      await api.addProductComponent(product.id, {
        component_product_id: bomNew.product_id,
        quantity_required: parseFloat(bomNew.quantity) || 1,
        unit: bomNew.unit || 'unidad',
      })
      setBomNew({ product_id: '', quantity: '1', unit: 'unidad' })
      await loadBOM()
      toast.success('Componente agregado')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleRemoveComponent = async (componentId: string) => {
    try {
      await api.removeProductComponent(product.id, componentId)
      await loadBOM()
      toast.success('Componente eliminado')
    } catch (e: any) { toast.error(e.message) }
  }

  const movementTypeLabels: Record<string, string> = {
    purchase: 'Compra',
    adjustment: 'Ajuste',
    return_customer: 'Dev. Cliente',
    return_supplier: 'Dev. Proveedor',
    sale: 'Venta',
    production: 'Produccion',
  }

  const tabs = [
    { key: 'general' as const, label: 'General' },
    { key: 'precios' as const, label: 'Precios' },
    ...(product.controls_stock ? [{ key: 'stock' as const, label: 'Stock' }] : []),
    { key: 'composicion' as const, label: 'Composicion' },
  ]

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full md:w-[45%] lg:w-[40%] bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{product.name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{product.sku}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 bg-white dark:bg-gray-900">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">SKU</label>
                  <input className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 text-sm" value={generalForm.sku} onChange={e => setGeneralForm({ ...generalForm, sku: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nombre</label>
                  <input className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 text-sm" value={generalForm.name} onChange={e => setGeneralForm({ ...generalForm, name: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                  <input className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 text-sm" value={generalForm.product_type} onChange={e => setGeneralForm({ ...generalForm, product_type: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Codigo de Barras</label>
                  <input className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 text-sm" value={generalForm.barcode} onChange={e => setGeneralForm({ ...generalForm, barcode: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Descripcion</label>
                <textarea className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 text-sm min-h-[80px]" value={generalForm.description} onChange={e => setGeneralForm({ ...generalForm, description: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={generalForm.controls_stock}
                  onChange={e => setGeneralForm({ ...generalForm, controls_stock: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Controla stock</span>
              </label>
              <Button variant="success" onClick={handleSaveGeneral} loading={saving}>Guardar General</Button>
            </div>
          )}

          {/* PRECIOS TAB */}
          {activeTab === 'precios' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Costo (ARS)</label>
                  <input
                    type="number" step="0.01"
                    className={`px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 ${lastEdited === 'cost' ? 'border-blue-400' : 'border-gray-300 dark:border-gray-600'}`}
                    value={pricingForm.cost}
                    onChange={e => recalcFrom('cost', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Margen %</label>
                  <input
                    type="number" step="0.01"
                    className={`px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 ${lastEdited === 'margin_percent' ? 'border-blue-400' : 'border-gray-300 dark:border-gray-600'}`}
                    value={pricingForm.margin_percent}
                    onChange={e => recalcFrom('margin_percent', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">IVA %</label>
                  <select
                    className={`px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 ${lastEdited === 'vat_rate' ? 'border-blue-400' : 'border-gray-300 dark:border-gray-600'}`}
                    value={pricingForm.vat_rate}
                    onChange={e => recalcFrom('vat_rate', e.target.value)}
                  >
                    {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Precio Final</label>
                  <input
                    type="number" step="0.01"
                    className="px-3 py-2 border border-green-300 dark:border-green-700 rounded-lg text-lg font-bold bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-100"
                    value={pricingForm.final_price}
                    onChange={e => recalcFrom('final_price', e.target.value)}
                  />
                </div>
              </div>
              <Button variant="success" onClick={handleSavePricing} loading={saving}>Guardar Precios</Button>

              {/* Price lists for this product */}
              {productPriceLists.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Listas de precios que incluyen este producto</h4>
                  <div className="space-y-1">
                    {productPriceLists.map((pl, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 dark:bg-gray-800 rounded text-sm">
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">{pl.list_name}</span>
                          <span className="text-xs text-gray-400 ml-2">({pl.list_type})</span>
                        </div>
                        <span className="font-bold text-green-700 dark:text-green-400">{formatCurrency(parseFloat(pl.price))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Price History Timeline */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Historial de precios</h4>
                  {priceHistory.length === 0 && !priceHistoryLoading && (
                    <button
                      onClick={() => loadPriceHistory(10)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Cargar historial
                    </button>
                  )}
                </div>
                {priceHistoryLoading ? (
                  <p className="text-xs text-gray-400">Cargando historial...</p>
                ) : priceHistory.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin cambios de precio registrados</p>
                ) : (
                  <div className="space-y-0">
                    {priceHistory.slice(0, priceHistoryLimit > 10 ? priceHistoryLimit : 10).map((entry: any, idx: number) => {
                      const oldVal = parseFloat(entry.old_value || '0')
                      const newVal = parseFloat(entry.new_value || '0')
                      const pctChange = oldVal > 0 ? ((newVal - oldVal) / oldVal * 100) : 0
                      const isIncrease = newVal > oldVal
                      const fieldLabels: Record<string, string> = {
                        cost: 'Costo',
                        final_price: 'Precio final',
                        margin: 'Margen',
                        vat_rate: 'IVA',
                      }
                      const sourceLabels: Record<string, string> = {
                        manual: 'Manual',
                        bulk_update: 'Masivo',
                        supplier_import: 'Import. proveedor',
                        undo_bulk: 'Deshacer masivo',
                      }
                      return (
                        <div key={entry.id || idx} className="flex items-start gap-3 py-2 border-l-2 border-gray-200 dark:border-gray-700 pl-3 relative">
                          <div className="absolute -left-[5px] top-3 w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {fieldLabels[entry.field_changed] || entry.field_changed}
                              </span>
                              <span className="text-xs text-gray-400">
                                {formatCurrency(oldVal)} {'→'} {formatCurrency(newVal)}
                              </span>
                              {pctChange !== 0 && (
                                <span className={`text-xs font-medium ${isIncrease ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {isIncrease ? '+' : ''}{pctChange.toFixed(1)}%
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-gray-400">
                                {new Date(entry.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                {sourceLabels[entry.change_source] || entry.change_source}
                              </span>
                              {entry.changed_by_name && (
                                <span className="text-[10px] text-gray-400">{entry.changed_by_name}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {priceHistoryTotal > 10 && priceHistoryLimit <= 10 && (
                      <button
                        onClick={() => { setPriceHistoryLimit(50); loadPriceHistory(50) }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 pl-3"
                      >
                        Ver mas ({priceHistoryTotal - 10} restantes)
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STOCK TAB */}
          {activeTab === 'stock' && product.controls_stock && (
            <div className="space-y-4">
              {/* Current quantity */}
              <div className="text-center py-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <p className="text-sm text-gray-500 dark:text-gray-400">Stock actual</p>
                <p className={`text-4xl font-bold ${stockQty <= 0 ? 'text-red-600 dark:text-red-400' : stockQty <= parseFloat(lowThreshold) && parseFloat(lowThreshold) > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                  {stockQty}
                </p>
              </div>

              {/* Threshold */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 dark:text-gray-400">Alerta stock bajo:</label>
                <input
                  type="number" step="0.01" min="0"
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-24 bg-white dark:bg-gray-800 dark:text-gray-100"
                  value={lowThreshold}
                  onChange={e => setLowThreshold(e.target.value)}
                />
                <Button variant="secondary" onClick={handleSaveThreshold} loading={saving}>Guardar</Button>
              </div>

              {/* Adjust stock */}
              <div>
                <Button variant="primary" onClick={() => setShowAdjust(!showAdjust)}>
                  {showAdjust ? 'Cancelar ajuste' : 'Ajustar stock'}
                </Button>
                {showAdjust && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400">Cambio de cantidad</label>
                      <input type="number" step="0.01" placeholder="Ej: 5 o -3" className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400">Motivo</label>
                      <input placeholder="Razon del ajuste..." className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} />
                    </div>
                    <div className="flex items-end">
                      <Button variant="success" onClick={handleAdjustStock} loading={saving} disabled={!adjustQty || !adjustReason}>
                        Aplicar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Last movements */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Ultimos movimientos</h4>
                {movementsLoading ? (
                  <p className="text-xs text-gray-400">Cargando...</p>
                ) : movements.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin movimientos registrados</p>
                ) : (
                  <div className="space-y-1">
                    {movements.map(m => (
                      <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-800 rounded text-sm">
                        <div>
                          <span className="font-medium text-gray-800 dark:text-gray-200">
                            {movementTypeLabels[m.movement_type] || m.movement_type}
                          </span>
                          {m.notes && <span className="text-xs text-gray-400 ml-2">{m.notes}</span>}
                        </div>
                        <div className="text-right">
                          <span className={`font-bold ${parseFloat(m.quantity) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {parseFloat(m.quantity) >= 0 ? '+' : ''}{parseFloat(m.quantity)}
                          </span>
                          <p className="text-xs text-gray-400">{new Date(m.created_at).toLocaleDateString('es-AR')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COMPOSICION TAB */}
          {activeTab === 'composicion' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100" value={bomNew.product_id} onChange={e => setBomNew({ ...bomNew, product_id: e.target.value })}>
                  <option value="">Seleccionar material...</option>
                  {products.filter(p => p.id !== product.id).map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                </select>
                <input type="number" step="0.0001" min="0.0001" placeholder="Cantidad" className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100" value={bomNew.quantity} onChange={e => setBomNew({ ...bomNew, quantity: e.target.value })} />
                <input placeholder="Unidad" className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100" value={bomNew.unit} onChange={e => setBomNew({ ...bomNew, unit: e.target.value })} />
                <Button variant="primary" onClick={handleAddComponent} disabled={!bomNew.product_id}>+ Agregar</Button>
              </div>

              {bomLoading ? (
                <p className="text-xs text-gray-400">Cargando...</p>
              ) : bomComponents.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-700 dark:text-amber-400">
                        <th className="px-3 py-1.5 text-left">Material</th>
                        <th className="px-3 py-1.5 text-right">Cantidad</th>
                        <th className="px-3 py-1.5 text-left">Unidad</th>
                        <th className="px-3 py-1.5 text-right">Costo</th>
                        <th className="px-3 py-1.5 text-right">Stock</th>
                        <th className="px-3 py-1.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bomComponents.map((comp: any) => (
                        <tr key={comp.id} className="border-t border-amber-200/50 dark:border-amber-800/50">
                          <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200">{comp.component_name} <span className="text-gray-400 text-xs">({comp.component_sku})</span></td>
                          <td className="px-3 py-1.5 text-right dark:text-gray-300">{parseFloat(comp.quantity_required)}</td>
                          <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{comp.unit || 'unidad'}</td>
                          <td className="px-3 py-1.5 text-right dark:text-gray-300">{formatCurrency(parseFloat(comp.component_cost || '0'))}</td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={parseFloat(comp.stock_available || '0') >= parseFloat(comp.quantity_required) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {parseFloat(comp.stock_available || '0')}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <button onClick={() => handleRemoveComponent(comp.id)} className="text-red-500 hover:text-red-700 text-xs">x</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Sin componentes.</p>
              )}
              {bomCost !== null && bomCost > 0 && (
                <div className="flex gap-4 text-xs">
                  <span className="text-amber-700 dark:text-amber-400">Costo BOM: <strong>{formatCurrency(bomCost)}</strong></span>
                  <span className="text-gray-500">Costo manual: <strong>{formatCurrency(parseFloat(pricingForm.cost || '0'))}</strong></span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
