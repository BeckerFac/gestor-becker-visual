import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/hooks/useToast'
import { DataTable } from '@/components/shared/DataTable'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { api } from '@/services/api'

interface StockItem {
  id: string
  product: { id: string; name: string; sku: string }
  warehouse: { id: string; name: string }
  quantity: string
  min_level: string
  max_level: string
}

interface Product { id: string; sku: string; name: string }

export const Inventory: React.FC = () => {
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ product_id: '', movement_type: 'purchase', quantity: '', notes: '' })

  const loadData = async () => {
    try {
      setLoading(true)
      const [stockRes, prodRes] = await Promise.all([
        api.getInventory().catch(() => ({ items: [] })),
        api.getProducts().catch(() => ({ items: [] }))
      ])
      setStock(stockRes.items || stockRes || [])
      setProducts(prodRes.items || prodRes || [])
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

  const filtered = stock.filter(s =>
    s.product?.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.product?.sku?.toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'product' as const, label: 'SKU', render: (v: any) => v?.sku || '-' },
    { key: 'product' as const, label: 'Producto', render: (v: any) => v?.name || '-' },
    { key: 'warehouse' as const, label: 'Depósito', render: (v: any) => v?.name || 'Principal' },
    { key: 'quantity' as const, label: 'Cantidad', render: (v: any) => {
      const qty = parseFloat(v || '0')
      return <span className={`font-bold ${qty <= 0 ? 'text-red-600' : qty < 10 ? 'text-orange-500' : 'text-green-600'}`}>{qty}</span>
    }},
    { key: 'min_level' as const, label: 'Mín.', render: (v: any) => v || '0' },
    { key: 'id' as const, label: 'Estado', render: (_: any, row: StockItem) => {
      const qty = parseFloat(row.quantity || '0')
      const min = parseFloat(row.min_level || '0')
      if (qty <= 0) return <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Sin Stock</span>
      if (qty <= min) return <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Stock Bajo</span>
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">OK</span>
    }},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500 mt-1">{stock.length} productos en stock</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton
            data={filtered.map(s => {
              const qty = parseFloat(s.quantity || '0')
              const min = parseFloat(s.min_level || '0')
              return {
                sku: s.product?.sku || '-',
                producto: s.product?.name || '-',
                deposito: s.warehouse?.name || 'Principal',
                cantidad: qty,
                minimo: min,
                estado: qty <= 0 ? 'Sin Stock' : qty <= min ? 'Stock Bajo' : 'OK',
              }
            })}
            columns={[
              { key: 'sku', label: 'SKU' },
              { key: 'producto', label: 'Producto' },
              { key: 'deposito', label: 'Deposito' },
              { key: 'cantidad', label: 'Cantidad' },
              { key: 'minimo', label: 'Minimo' },
              { key: 'estado', label: 'Estado' },
            ]}
            filename="inventario"
          />
          <Button variant="primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Movimiento de Stock'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}<button onClick={() => setError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Stock summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <p className="text-sm text-green-700">Stock Normal</p>
            <p className="text-2xl font-bold text-green-800">{stock.filter(s => parseFloat(s.quantity || '0') > parseFloat(s.min_level || '0')).length}</p>
          </CardContent>
        </Card>
        <Card className="border border-orange-200 bg-orange-50">
          <CardContent className="pt-4">
            <p className="text-sm text-orange-700">Stock Bajo</p>
            <p className="text-2xl font-bold text-orange-800">{stock.filter(s => { const q = parseFloat(s.quantity || '0'); const m = parseFloat(s.min_level || '0'); return q > 0 && q <= m; }).length}</p>
          </CardContent>
        </Card>
        <Card className="border border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700">Sin Stock</p>
            <p className="text-2xl font-bold text-red-800">{stock.filter(s => parseFloat(s.quantity || '0') <= 0).length}</p>
          </CardContent>
        </Card>
      </div>

      {showForm && (
        <Card>
          <CardHeader><h3 className="text-lg font-semibold">Registrar Movimiento de Stock</h3></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Producto *</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} required>
                  <option value="">Seleccionar producto...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Tipo de Movimiento</label>
                <select className="px-3 py-2 border border-gray-300 rounded-lg" value={form.movement_type} onChange={e => setForm({ ...form, movement_type: e.target.value })}>
                  <option value="purchase">Compra (Ingreso)</option>
                  <option value="adjustment">Ajuste</option>
                  <option value="return_customer">Devolución Cliente</option>
                  <option value="return_supplier">Devolución Proveedor</option>
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
            action={!search ? { label: '+ Movimiento de Stock', onClick: () => setShowForm(true) } : undefined}
          />
        </CardContent></Card>
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}
    </div>
  )
}
