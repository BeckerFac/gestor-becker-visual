import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/shared/EmptyState'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import type { Product, StockMovement } from './types'

interface StockMovementsProps {
  products: Product[]
  onDataChanged: () => void
  onSwitchToProducts?: () => void
}

interface StockItem {
  id: string
  product: { id: string; name: string; sku: string }
  warehouse: { id: string; name: string }
  quantity: string
  min_level: string
  max_level: string
  used_in_products?: { name: string; sku: string }[]
}

export const StockMovements: React.FC<StockMovementsProps> = ({ products, onDataChanged, onSwitchToProducts }) => {
  const [stock, setStock] = useState<StockItem[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [movementsPage, setMovementsPage] = useState(1)
  const [movementsTotal, setMovementsTotal] = useState(0)
  const [view, setView] = useState<'stock' | 'movements'>('stock')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Movement form
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ product_id: '', movement_type: 'purchase', quantity: '', notes: '' })
  const [saving, setSaving] = useState(false)

  // Adjust form
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [adjustForm, setAdjustForm] = useState({ product_id: '', quantity_change: '', reason: '' })

  // Threshold editing
  const [editingThreshold, setEditingThreshold] = useState<string | null>(null)
  const [thresholdValue, setThresholdValue] = useState('')

  // Show ALL products in dropdown, not just controls_stock ones
  const allProducts = products

  const loadStock = useCallback(async () => {
    setLoading(true)
    try {
      const stockRes = await api.getInventory().catch((err: any) => {
        setError(`Error cargando inventario: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
        return { items: [] }
      })
      setStock(Array.isArray(stockRes) ? stockRes : stockRes?.items || [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const loadMovements = useCallback(async () => {
    try {
      const res = await api.getStockMovements({ skip: (movementsPage - 1) * 50, limit: 50 })
      setMovements(res.items || [])
      setMovementsTotal(res.total || 0)
    } catch { setMovements([]) }
  }, [movementsPage])

  useEffect(() => { loadStock() }, [loadStock])
  useEffect(() => { if (view === 'movements') loadMovements() }, [view, loadMovements])

  const getProductThreshold = (productId: string): number => {
    const product = products.find(p => p.id === productId) as any
    if (!product) return 0
    return parseFloat(String(product.low_stock_threshold || '0'))
  }

  const handleSaveThreshold = async (productId: string) => {
    try {
      await api.updateProduct(productId, { low_stock_threshold: parseFloat(thresholdValue) || 0 })
      toast.success('Umbral actualizado')
      onDataChanged()
    } catch (e: any) { toast.error(e.message || 'Error al actualizar umbral') }
    finally { setEditingThreshold(null) }
  }

  const handleSubmitMovement = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.createInventoryMovement({
        product_id: form.product_id,
        movement_type: form.movement_type,
        quantity: parseFloat(form.quantity),
        notes: form.notes || null,
      })
      toast.success('Movimiento de stock registrado correctamente')
      setShowForm(false)
      setForm({ product_id: '', movement_type: 'purchase', quantity: '', notes: '' })
      await loadStock()
      if (view === 'movements') await loadMovements()
      onDataChanged()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.adjustStock({
        product_id: adjustForm.product_id,
        quantity_change: parseFloat(adjustForm.quantity_change),
        reason: adjustForm.reason,
      })
      toast.success('Ajuste de stock registrado correctamente')
      setShowAdjustForm(false)
      setAdjustForm({ product_id: '', quantity_change: '', reason: '' })
      await loadStock()
      if (view === 'movements') await loadMovements()
      onDataChanged()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const filteredStock = stock.filter(s =>
    s.product?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.product?.sku?.toLowerCase().includes(search.toLowerCase())
  )

  const lowStockCount = stock.filter(s => {
    const q = parseFloat(s.quantity || '0')
    const m = parseFloat(s.min_level || '0')
    const threshold = getProductThreshold(s.product?.id)
    return q > 0 && (q <= m || (threshold > 0 && q <= threshold))
  }).length

  const movementTypeLabels: Record<string, string> = {
    purchase: 'Compra',
    adjustment: 'Ajuste',
    return_customer: 'Dev. Cliente',
    return_supplier: 'Dev. Proveedor',
    sale: 'Venta',
    production: 'Produccion',
  }

  const movementsTotalPages = Math.ceil(movementsTotal / 50) || 1

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('stock')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${view === 'stock' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            Stock actual
          </button>
          <button
            onClick={() => setView('movements')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${view === 'movements' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            Historial movimientos
          </button>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filteredStock.map(s => {
              const qty = parseFloat(s.quantity || '0')
              const min = parseFloat(s.min_level || '0')
              const threshold = getProductThreshold(s.product?.id)
              return {
                producto: s.product?.name || '-',
                sku: s.product?.sku || '-',
                deposito: s.warehouse?.name || 'Principal',
                cantidad: qty,
                nivel_minimo: min,
                estado: qty <= 0 ? 'Sin Stock' : (qty <= min || (threshold > 0 && qty <= threshold)) ? 'Stock Bajo' : 'OK',
              }
            })}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'sku', label: 'SKU' },
              { key: 'deposito', label: 'Deposito' },
              { key: 'cantidad', label: 'Cantidad' },
              { key: 'nivel_minimo', label: 'Nivel Minimo' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="inventario"
          />
          <ExportExcelButton
            data={filteredStock.map(s => {
              const qty = parseFloat(s.quantity || '0')
              const min = parseFloat(s.min_level || '0')
              const threshold = getProductThreshold(s.product?.id)
              return {
                producto: s.product?.name || '-',
                sku: s.product?.sku || '-',
                deposito: s.warehouse?.name || 'Principal',
                cantidad: qty,
                nivel_minimo: min,
                estado: qty <= 0 ? 'Sin Stock' : (qty <= min || (threshold > 0 && qty <= threshold)) ? 'Stock Bajo' : 'OK',
              }
            })}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'sku', label: 'SKU' },
              { key: 'deposito', label: 'Deposito' },
              { key: 'cantidad', label: 'Cantidad', type: 'number' as const },
              { key: 'nivel_minimo', label: 'Nivel Minimo', type: 'number' as const },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="inventario"
          />
          <PermissionGate module="inventory" action="create">
            <Button variant="secondary" onClick={() => { setShowAdjustForm(!showAdjustForm); if (showForm) setShowForm(false) }}>
              {showAdjustForm ? 'Cancelar Ajuste' : 'Ajustar stock'}
            </Button>
          </PermissionGate>
          {/* Removed "+ Movimiento" button - redundant with "Ajustar stock" */}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Summary cards */}
      {view === 'stock' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
            <CardContent className="pt-4">
              <p className="text-sm text-green-700 dark:text-green-400">Stock Normal</p>
              <p className="text-2xl font-bold text-green-800 dark:text-green-300">{stock.filter(s => {
                const q = parseFloat(s.quantity || '0')
                const m = parseFloat(s.min_level || '0')
                const threshold = getProductThreshold(s.product?.id)
                return q > 0 && q > m && (threshold <= 0 || q > threshold)
              }).length}</p>
            </CardContent>
          </Card>
          <Card className="border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20">
            <CardContent className="pt-4">
              <p className="text-sm text-orange-700 dark:text-orange-400">Stock Bajo</p>
              <p className="text-2xl font-bold text-orange-800 dark:text-orange-300">{lowStockCount}</p>
            </CardContent>
          </Card>
          <Card className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
            <CardContent className="pt-4">
              <p className="text-sm text-red-700 dark:text-red-400">Sin Stock</p>
              <p className="text-2xl font-bold text-red-800 dark:text-red-300">{stock.filter(s => parseFloat(s.quantity || '0') <= 0).length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Adjust stock form */}
      {showAdjustForm && (
        <Card className="border-orange-200 dark:border-orange-800">
          <CardHeader><h3 className="text-lg font-semibold dark:text-gray-100">Ajustar Stock</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleAdjust} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Producto *</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={adjustForm.product_id} onChange={e => setAdjustForm({ ...adjustForm, product_id: e.target.value })} required>
                  <option value="">Seleccionar producto...</option>
                  {allProducts.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Cambio de cantidad *</label>
                <input type="number" step="0.01" placeholder="Ej: 5 o -3" className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={adjustForm.quantity_change} onChange={e => setAdjustForm({ ...adjustForm, quantity_change: e.target.value })} required />
              </div>
              <Input label="Motivo *" placeholder="Razon del ajuste..." value={adjustForm.reason} onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })} required />
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving}>Registrar Ajuste</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Movement form */}
      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold dark:text-gray-100">Registrar Movimiento de Stock</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmitMovement} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Producto *</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} required>
                  <option value="">Seleccionar producto...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Movimiento</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={form.movement_type} onChange={e => setForm({ ...form, movement_type: e.target.value })}>
                  <option value="purchase">Compra (Ingreso)</option>
                  <option value="adjustment">Ajuste</option>
                  <option value="return_customer">Devolucion Cliente</option>
                  <option value="return_supplier">Devolucion Proveedor</option>
                </select>
              </div>
              <Input label="Cantidad *" type="number" step="0.01" placeholder="0" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
              <Input label="Notas" placeholder="Observaciones..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              <div className="flex items-end lg:col-span-4">
                <Button type="submit" variant="success" loading={saving}>Registrar Movimiento</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Input placeholder="Buscar por producto o SKU..." value={search} onChange={e => setSearch(e.target.value)} />

      {/* Stock view - summary + link to products tab */}
      {view === 'stock' && (
        <div className="text-center py-4">
          {onSwitchToProducts && (
            <button
              onClick={onSwitchToProducts}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Ver stock en tabla de productos
            </button>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            El detalle de stock por producto se muestra en la tabla principal de Productos.
          </p>
        </div>
      )}

      {/* Movements view */}
      {view === 'movements' && (
        movements.length === 0 ? (
          <EmptyState
            title="Sin movimientos"
            description="No hay movimientos de stock registrados"
          />
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Fecha</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Producto</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Tipo</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Cantidad</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Deposito</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map(m => (
                    <tr key={m.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{new Date(m.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        <span className="font-mono text-xs text-gray-400 mr-1">{m.product?.sku}</span>
                        {m.product?.name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          {movementTypeLabels[m.movement_type] || m.movement_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={`font-bold ${parseFloat(m.quantity) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {parseFloat(m.quantity) >= 0 ? '+' : ''}{parseFloat(m.quantity)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{m.warehouse?.name || 'Principal'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{m.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movementsTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <span className="text-sm text-gray-500 dark:text-gray-400">{movementsTotal} movimiento{movementsTotal !== 1 ? 's' : ''}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMovementsPage(p => Math.max(1, p - 1))} disabled={movementsPage <= 1} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">Anterior</button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Pagina {movementsPage} de {movementsTotalPages}</span>
                    <button onClick={() => setMovementsPage(p => Math.min(movementsTotalPages, p + 1))} disabled={movementsPage >= movementsTotalPages} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">Siguiente</button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      )}
    </div>
  )
}
