import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { HelpTip } from '@/components/shared/HelpTip'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { toast } from '@/hooks/useToast'
import { formatCurrency } from '@/lib/utils'
import { api } from '@/services/api'
import type { Material } from './types'
import { MATERIAL_UNITS } from './types'

export const MaterialsTab: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stats, setStats] = useState({ total: 0, low_stock: 0, out_of_stock: 0 })

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', sku: '', unit: 'unidad', cost: '', stock: '', min_stock: '', description: '',
  })
  const [saving, setSaving] = useState(false)

  // Adjust stock
  const [adjustTarget, setAdjustTarget] = useState<Material | null>(null)
  const [adjustForm, setAdjustForm] = useState({ quantity_change: '', reason: '' })

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadMaterials = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getMaterials(search || undefined)
      setMaterials(res.items || [])
      setStats({ total: res.total || 0, low_stock: res.low_stock || 0, out_of_stock: res.out_of_stock || 0 })
    } catch (e: any) {
      toast.error(e.message || 'Error cargando materiales')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => { loadMaterials() }, [loadMaterials])

  const resetForm = () => {
    setForm({ name: '', sku: '', unit: 'unidad', cost: '', stock: '', min_stock: '', description: '' })
    setEditingId(null)
  }

  const handleEdit = (mat: Material) => {
    setForm({
      name: mat.name,
      sku: mat.sku || '',
      unit: mat.unit,
      cost: String(mat.cost || ''),
      stock: String(mat.stock || ''),
      min_stock: String(mat.min_stock || ''),
      description: mat.description || '',
    })
    setEditingId(mat.id)
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku || undefined,
        unit: form.unit,
        cost: parseFloat(form.cost) || 0,
        stock: editingId ? undefined : (parseFloat(form.stock) || 0),
        min_stock: parseFloat(form.min_stock) || 0,
        description: form.description || undefined,
      }
      if (editingId) {
        await api.updateMaterial(editingId, payload)
        toast.success('Material actualizado')
      } else {
        await api.createMaterial(payload)
        toast.success('Material creado')
      }
      resetForm()
      setShowForm(false)
      await loadMaterials()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Error al guardar material')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteMaterial(deleteTarget.id)
      toast.success('Material eliminado')
      await loadMaterials()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Error al eliminar material')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adjustTarget) return
    const qty = parseFloat(adjustForm.quantity_change)
    if (!qty || isNaN(qty)) {
      toast.error('Ingresa una cantidad valida')
      return
    }
    try {
      await api.adjustMaterialStock(adjustTarget.id, {
        quantity_change: qty,
        reason: adjustForm.reason || 'Ajuste manual',
      })
      toast.success('Stock ajustado')
      setAdjustTarget(null)
      setAdjustForm({ quantity_change: '', reason: '' })
      await loadMaterials()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Error al ajustar stock')
    }
  }

  const stockColor = (status: string) => {
    if (status === 'sin_stock') return 'text-red-600 dark:text-red-400'
    if (status === 'bajo') return 'text-yellow-600 dark:text-yellow-400'
    return 'text-green-600 dark:text-green-400'
  }

  const stockBadge = (status: string) => {
    if (status === 'sin_stock') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    if (status === 'bajo') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  }

  const stockLabel = (status: string) => {
    if (status === 'sin_stock') return 'Sin stock'
    if (status === 'bajo') return 'Bajo'
    return 'OK'
  }

  // Export
  const exportData = materials.map(m => ({
    sku: m.sku || '-',
    nombre: m.name,
    unidad: m.unit,
    costo: parseFloat(String(m.cost)),
    stock: parseFloat(String(m.stock)),
    stock_minimo: parseFloat(String(m.min_stock)),
    estado: stockLabel(m.stock_status || 'ok'),
  }))
  const exportColumns = [
    { key: 'sku', label: 'SKU' },
    { key: 'nombre', label: 'Material' },
    { key: 'unidad', label: 'Unidad' },
    { key: 'costo', label: 'Costo' },
    { key: 'stock', label: 'Stock' },
    { key: 'stock_minimo', label: 'Stock Min.' },
    { key: 'estado', label: 'Estado' },
  ]

  return (
    <div className="space-y-4">
      {/* Help tip */}
      <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <span className="text-blue-600 dark:text-blue-400 text-lg mt-0.5">?</span>
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Los materiales son la materia prima que usas para fabricar tus productos. Aca podes cargar materiales como lona, canos, pintura, etc. Despues, en cada producto, podes definir que materiales necesitas para fabricarlo (composicion/BOM).
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">Total materiales</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-yellow-600 dark:text-yellow-400">Stock bajo</p>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.low_stock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-red-600 dark:text-red-400">Sin stock</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.out_of_stock}</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <ExportCSVButton data={exportData} columns={exportColumns} filename="materiales" />
        <ExportExcelButton data={exportData} columns={exportColumns} filename="materiales" />
        <PermissionGate module="products" action="create">
          <Button
            variant={showForm ? 'danger' : 'primary'}
            onClick={() => {
              if (showForm) {
                setShowForm(false)
                resetForm()
              } else {
                resetForm()
                setShowForm(true)
              }
            }}
          >
            {showForm ? 'Cancelar' : '+ Nuevo Material'}
          </Button>
        </PermissionGate>
      </div>

      {/* Create/Edit form */}
      {showForm && (
        <Card>
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {editingId ? 'Editar Material' : 'Nuevo Material'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Input
                  label="Nombre *"
                  placeholder="Ej: Lona Blackout"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  required
                />
                <Input
                  label="SKU"
                  placeholder="Auto-generado"
                  value={form.sku}
                  onChange={e => setForm({ ...form, sku: e.target.value })}
                />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Unidad *</label>
                  <select
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.unit}
                    onChange={e => setForm({ ...form, unit: e.target.value })}
                  >
                    {MATERIAL_UNITS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Costo (ARS)"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.cost}
                  onChange={e => setForm({ ...form, cost: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {!editingId && (
                  <Input
                    label="Stock inicial"
                    type="number"
                    step="0.01"
                    placeholder="0"
                    value={form.stock}
                    onChange={e => setForm({ ...form, stock: e.target.value })}
                  />
                )}
                <Input
                  label="Stock minimo"
                  type="number"
                  step="0.01"
                  placeholder="0"
                  value={form.min_stock}
                  onChange={e => setForm({ ...form, min_stock: e.target.value })}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Descripcion"
                    placeholder="Descripcion opcional"
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="success" loading={saving}>
                  {editingId ? 'Guardar Cambios' : 'Crear Material'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => { setShowForm(false); resetForm() }}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={5} cols={7} />
      ) : materials.length === 0 ? (
        <EmptyState
          title={search ? 'Sin resultados' : 'Sin materiales'}
          description={search ? `No se encontraron materiales para "${search}"` : 'Crea tu primer material para empezar.'}
          actionLabel={!search ? '+ Nuevo Material' : undefined}
          onAction={!search ? () => { resetForm(); setShowForm(true) } : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase">
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Unidad</th>
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Min.</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {materials.map(mat => {
                const status = mat.stock_status || 'ok'
                const stockVal = parseFloat(String(mat.stock))
                return (
                  <tr key={mat.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{mat.sku || '-'}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-gray-100 font-medium">{mat.name}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{mat.unit}</td>
                    <td className="px-3 py-2 text-right text-gray-900 dark:text-gray-100">{formatCurrency(parseFloat(String(mat.cost)))}</td>
                    <td className={`px-3 py-2 text-right font-medium ${stockVal < 0 ? 'text-red-600 dark:text-red-400' : stockColor(status)}`}>
                      {stockVal}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{parseFloat(String(mat.min_stock))}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${stockBadge(status)}`}>
                        {stockLabel(status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <PermissionGate module="products" action="edit">
                          <button
                            onClick={() => setAdjustTarget(mat)}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                            title="Ajustar stock"
                          >
                            Stock
                          </button>
                          <button
                            onClick={() => handleEdit(mat)}
                            className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300 text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            Editar
                          </button>
                        </PermissionGate>
                        <PermissionGate module="products" action="delete">
                          <button
                            onClick={() => setDeleteTarget(mat)}
                            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            Eliminar
                          </button>
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust stock modal */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAdjustTarget(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Ajustar stock: {adjustTarget.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Stock actual: <strong className={parseFloat(String(adjustTarget.stock)) <= 0 ? 'text-red-600' : 'text-green-600'}>
                {parseFloat(String(adjustTarget.stock))} {adjustTarget.unit}
              </strong>
            </p>
            <form onSubmit={handleAdjustStock} className="space-y-3">
              <Input
                label="Cantidad (+ para ingreso, - para egreso)"
                type="number"
                step="0.01"
                placeholder="Ej: 10 o -5"
                value={adjustForm.quantity_change}
                onChange={e => setAdjustForm({ ...adjustForm, quantity_change: e.target.value })}
                required
                autoFocus
              />
              <Input
                label="Motivo"
                placeholder="Ej: Compra de materiales"
                value={adjustForm.reason}
                onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary">Ajustar</Button>
                <Button type="button" variant="secondary" onClick={() => {
                  setAdjustTarget(null)
                  setAdjustForm({ quantity_change: '', reason: '' })
                }}>Cancelar</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar material"
        message={`Seguro que queres eliminar "${deleteTarget?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
