import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { toast } from '@/hooks/useToast'
import { DataTable } from '@/components/shared/DataTable'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { api } from '@/services/api'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { HelpTip } from '@/components/shared/HelpTip'

interface StockItem {
  id: string
  product: { id: string; name: string; sku: string }
  warehouse: { id: string; name: string }
  quantity: string
  min_level: string
  max_level: string
}

interface Product {
  id: string
  sku: string
  name: string
  controls_stock?: boolean
  low_stock_threshold?: string | number
}

export const Inventory: React.FC = () => {
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ product_id: '', movement_type: 'purchase', quantity: '', notes: '' })
  const [adjustForm, setAdjustForm] = useState({ product_id: '', quantity_change: '', reason: '' })
  const [editingThreshold, setEditingThreshold] = useState<string | null>(null)
  const [thresholdValue, setThresholdValue] = useState('')

  const loadData = async () => {
    try {
      setLoading(true)
      const [stockRes, prodRes] = await Promise.all([
        api.getInventory().catch((err: any) => {
          setError(`Error cargando inventario: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
          return { items: [] }
        }),
        api.getProducts().catch(() => ({ items: [] }))
      ])
      setStock(Array.isArray(stockRes) ? stockRes : stockRes?.items || [])
      setProducts(Array.isArray(prodRes) ? prodRes : prodRes?.items || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
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
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
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
      await loadData()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const stockControlProducts = products.filter((p: any) => p.controls_stock)

  const getProductThreshold = (productId: string): number => {
    const product = products.find(p => p.id === productId) as any
    if (!product) return 0
    return parseFloat(String(product.low_stock_threshold || '0'))
  }

  const handleSaveThreshold = async (productId: string) => {
    try {
      await api.updateProduct(productId, { low_stock_threshold: parseFloat(thresholdValue) || 0 })
      const prodRes = await api.getProducts().catch(() => ({ items: [] }))
      setProducts(Array.isArray(prodRes) ? prodRes : prodRes.items || [])
      toast.success('Umbral actualizado')
    } catch (e: any) {
      toast.error(e.message || 'Error al actualizar umbral')
    } finally {
      setEditingThreshold(null)
    }
  }

  const filtered = stock.filter(s =>
    s.product?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.product?.sku?.toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'product' as const, label: 'SKU', render: (v: any) => v?.sku || '-' },
    { key: 'product' as const, label: 'Producto', render: (v: any) => v?.name || '-' },
    { key: 'warehouse' as const, label: 'Deposito', render: (v: any) => v?.name || 'Principal' },
    { key: 'quantity' as const, label: 'Cantidad', render: (_: any, row: StockItem) => {
      const qty = parseFloat(row.quantity || '0')
      const threshold = getProductThreshold(row.product?.id)
      const isBelowThreshold = threshold > 0 && qty <= threshold && qty > 0
      return (
        <span className={`font-bold ${qty <= 0 ? 'text-red-600' : isBelowThreshold ? 'text-orange-500' : qty < 10 ? 'text-orange-500' : 'text-green-600'}`}>
          {qty}
          {isBelowThreshold && (
            <span className="ml-1 text-xs font-normal text-orange-600" title={`Umbral: ${threshold}`}>
              (bajo umbral)
            </span>
          )}
        </span>
      )
    }},
    { key: 'min_level' as const, label: 'Min.', headerRender: () => <span>Min.<HelpTip text="Stock minimo. Si la cantidad baja de este numero, se muestra una alerta en rojo." /></span>, render: (_: any, row: StockItem) => {
      const productId = row.product?.id
      if (editingThreshold === productId) {
        return (
          <input
            type="number"
            step="0.01"
            className="w-20 px-1 py-0.5 border border-blue-300 rounded text-sm text-right"
            value={thresholdValue}
            onChange={e => setThresholdValue(e.target.value)}
            onBlur={() => handleSaveThreshold(productId)}
            onKeyDown={e => e.key === 'Enter' && handleSaveThreshold(productId)}
            autoFocus
          />
        )
      }
      const threshold = getProductThreshold(productId)
      return (
        <span
          className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded"
          onClick={(e) => {
            e.stopPropagation()
            setEditingThreshold(productId)
            setThresholdValue(String(threshold))
          }}
          title="Click para editar umbral"
        >
          {threshold || '0'}
        </span>
      )
    }},
    { key: 'id' as const, label: 'Usado en', render: (_: any, row: any) => {
      const usedIn = row.used_in_products || []
      if (!usedIn.length) return <span className="text-gray-300 text-xs">-</span>
      return <div className="flex flex-wrap gap-1">{usedIn.map((p: any, i: number) => (
        <span key={i} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-xs border border-amber-200">{p.name}</span>
      ))}</div>
    }},
    { key: 'quantity' as const, label: 'Estado', render: (_: any, row: StockItem) => {
      const qty = parseFloat(row.quantity || '0')
      const min = parseFloat(row.min_level || '0')
      const threshold = getProductThreshold(row.product?.id)
      if (qty <= 0) return <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Sin Stock</span>
      if (threshold > 0 && qty <= threshold) return <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Stock Bajo</span>
      if (qty <= min) return <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Stock Bajo</span>
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">OK</span>
    }},
  ]

  const lowStockCount = stock.filter(s => {
    const q = parseFloat(s.quantity || '0')
    const m = parseFloat(s.min_level || '0')
    const threshold = getProductThreshold(s.product?.id)
    return q > 0 && (q <= m || (threshold > 0 && q <= threshold))
  }).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Inventario</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{stock.length} productos en stock</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filtered.map(s => {
              const qty = parseFloat(s.quantity || '0')
              const min = parseFloat(s.min_level || '0')
              const max = parseFloat((s as any).max_level || '0')
              const threshold = getProductThreshold(s.product?.id)
              return {
                producto: s.product?.name || '-',
                sku: s.product?.sku || '-',
                deposito: s.warehouse?.name || 'Principal',
                cantidad: qty,
                nivel_minimo: min,
                nivel_maximo: max,
                estado: qty <= 0 ? 'Sin Stock' : (qty <= min || (threshold > 0 && qty <= threshold)) ? 'Stock Bajo' : 'OK',
              }
            })}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'sku', label: 'SKU' },
              { key: 'deposito', label: 'Deposito' },
              { key: 'cantidad', label: 'Cantidad' },
              { key: 'nivel_minimo', label: 'Nivel Minimo' },
              { key: 'nivel_maximo', label: 'Nivel Maximo' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="inventario"
          />
          <ExportExcelButton
            data={filtered.map(s => {
              const qty = parseFloat(s.quantity || '0')
              const min = parseFloat(s.min_level || '0')
              const max = parseFloat((s as any).max_level || '0')
              const threshold = getProductThreshold(s.product?.id)
              return {
                producto: s.product?.name || '-',
                sku: s.product?.sku || '-',
                deposito: s.warehouse?.name || 'Principal',
                cantidad: qty,
                nivel_minimo: min,
                nivel_maximo: max,
                estado: qty <= 0 ? 'Sin Stock' : (qty <= min || (threshold > 0 && qty <= threshold)) ? 'Stock Bajo' : 'OK',
              }
            })}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'sku', label: 'SKU' },
              { key: 'deposito', label: 'Deposito' },
              { key: 'cantidad', label: 'Cantidad', type: 'number' as const },
              { key: 'nivel_minimo', label: 'Nivel Minimo', type: 'number' as const },
              { key: 'nivel_maximo', label: 'Nivel Maximo', type: 'number' as const },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="inventario"
          />
          <PermissionGate module="inventory" action="create">
            <Button variant="secondary" onClick={() => { setShowAdjustForm(!showAdjustForm); if (showForm) setShowForm(false) }}>
              {showAdjustForm ? 'Cancelar Ajuste' : 'Ajustar stock'}
            </Button>
          </PermissionGate>
          <PermissionGate module="inventory" action="create">
            <Button variant="primary" onClick={() => { setShowForm(!showForm); if (showAdjustForm) setShowAdjustForm(false) }}>
              {showForm ? 'Cancelar' : '+ Movimiento de Stock'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Stock summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <p className="text-sm text-green-700">Stock Normal</p>
            <p className="text-2xl font-bold text-green-800">{stock.filter(s => {
              const q = parseFloat(s.quantity || '0')
              const m = parseFloat(s.min_level || '0')
              const threshold = getProductThreshold(s.product?.id)
              return q > 0 && q > m && (threshold <= 0 || q > threshold)
            }).length}</p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 bg-orange-50">
          <CardContent className="pt-4">
            <p className="text-sm text-orange-700">Stock Bajo</p>
            <p className="text-2xl font-bold text-orange-800">{lowStockCount}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700">Sin Stock</p>
            <p className="text-2xl font-bold text-red-800">{stock.filter(s => parseFloat(s.quantity || '0') <= 0).length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Adjust stock form */}
      {showAdjustForm && (
        <Card className="border-orange-200">
          <CardHeader><h3 className="text-lg font-semibold">Ajustar Stock</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleAdjust} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Producto *</label>
                <select className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100" value={adjustForm.product_id} onChange={e => setAdjustForm({ ...adjustForm, product_id: e.target.value })} required>
                  <option value="">Seleccionar producto...</option>
                  {stockControlProducts.length > 0
                    ? stockControlProducts.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)
                    : products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)
                  }
                </select>
                {stockControlProducts.length > 0 && (
                  <p className="text-xs text-gray-400">Solo productos que controlan stock</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Cambio de cantidad *</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ej: 5 o -3"
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-gray-100"
                  value={adjustForm.quantity_change}
                  onChange={e => setAdjustForm({ ...adjustForm, quantity_change: e.target.value })}
                  required
                />
                <p className="text-xs text-gray-400">Positivo para sumar, negativo para restar</p>
              </div>
              <Input label="Motivo *" placeholder="Razon del ajuste..." value={adjustForm.reason} onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })} required />
              <div className="flex items-end">
                <Button type="submit" variant="success" loading={saving}>Registrar Ajuste</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">Registrar Movimiento de Stock</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {loading ? (
        <Card><CardContent><SkeletonTable rows={5} cols={4} /></CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent>
          <EmptyState
            title={search ? 'Sin resultados' : 'Sin productos en stock'}
            description={search ? 'No se encontraron productos con esa busqueda' : 'Registra un movimiento de stock para empezar'}
            actionLabel={!search ? '+ Movimiento de Stock' : undefined}
            onAction={!search ? () => setShowForm(true) : undefined}
          />
        </CardContent></Card>
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}
    </div>
  )
}
