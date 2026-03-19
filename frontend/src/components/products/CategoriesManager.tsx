import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import type { Category } from './types'
import { VAT_OPTIONS } from './types'

interface CategoriesManagerProps {
  categories: Category[]
  onReload: () => void
}

export const CategoriesManager: React.FC<CategoriesManagerProps> = ({ categories, onReload }) => {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParent, setNewCategoryParent] = useState('')
  const [newCategoryVat, setNewCategoryVat] = useState('')
  const [newCategoryMargin, setNewCategoryMargin] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    name: string; default_vat_rate: string; default_margin_percent: string; color: string
  }>({ name: '', default_vat_rate: '', default_margin_percent: '', color: '' })
  const [saving, setSaving] = useState(false)

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      await api.createCategory({
        name: newCategoryName.trim(),
        parent_id: newCategoryParent || undefined,
        default_vat_rate: newCategoryVat ? parseFloat(newCategoryVat) : undefined,
        default_margin_percent: newCategoryMargin ? parseFloat(newCategoryMargin) : undefined,
        color: newCategoryColor || undefined,
      })
      setNewCategoryName('')
      setNewCategoryParent('')
      setNewCategoryVat('')
      setNewCategoryMargin('')
      setNewCategoryColor('')
      await onReload()
      toast.success('Categoria creada')
    } catch (e: any) { toast.error(e.message) }
  }

  const handleDeleteCategory = async (catId: string) => {
    try {
      await api.deleteCategory(catId)
      await onReload()
      toast.success('Categoria eliminada')
    } catch (e: any) { toast.error(e.message) }
  }

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setEditForm({
      name: cat.name,
      default_vat_rate: cat.default_vat_rate || '',
      default_margin_percent: cat.default_margin_percent || '',
      color: cat.color || '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      await api.updateCategory(editingId, {
        name: editForm.name,
        default_vat_rate: editForm.default_vat_rate ? parseFloat(editForm.default_vat_rate) : null,
        default_margin_percent: editForm.default_margin_percent ? parseFloat(editForm.default_margin_percent) : null,
        color: editForm.color || null,
      })
      setEditingId(null)
      await onReload()
      toast.success('Categoria actualizada')
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleMoveUp = async (cat: Category, siblings: Category[]) => {
    const idx = siblings.findIndex(s => s.id === cat.id)
    if (idx <= 0) return
    const newOrder = siblings.map(s => s.id)
    const temp = newOrder[idx - 1]
    newOrder[idx - 1] = newOrder[idx]
    newOrder[idx] = temp
    try {
      await api.reorderCategories(newOrder)
      await onReload()
    } catch (e: any) { toast.error(e.message) }
  }

  const handleMoveDown = async (cat: Category, siblings: Category[]) => {
    const idx = siblings.findIndex(s => s.id === cat.id)
    if (idx >= siblings.length - 1) return
    const newOrder = siblings.map(s => s.id)
    const temp = newOrder[idx + 1]
    newOrder[idx + 1] = newOrder[idx]
    newOrder[idx] = temp
    try {
      await api.reorderCategories(newOrder)
      await onReload()
    } catch (e: any) { toast.error(e.message) }
  }

  const rootCategories = categories.filter(c => !c.parent_id)
  const getChildren = (parentId: string) => categories.filter(c => c.parent_id === parentId)
  const totalProducts = (cat: Category) => {
    const direct = Number(cat.product_count || 0)
    const childProds = Number(cat.child_product_count || 0)
    return direct + childProds
  }

  const inputClass = 'px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100'

  const renderCategory = (cat: Category, depth: number, siblings: Category[]) => {
    const children = getChildren(cat.id)
    const isEditing = editingId === cat.id

    return (
      <div key={cat.id}>
        <div className={`flex items-center justify-between py-1.5 px-2 bg-white dark:bg-gray-700 rounded transition-colors hover:bg-gray-50 dark:hover:bg-gray-600/50 ${depth > 0 ? 'ml-6' : ''}`}>
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1 flex-wrap">
              <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className={`${inputClass} flex-1 min-w-[120px]`} />
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-500 dark:text-gray-400">IVA:</label>
                <select value={editForm.default_vat_rate} onChange={e => setEditForm({ ...editForm, default_vat_rate: e.target.value })} className={`${inputClass} w-20`}>
                  <option value="">--</option>
                  {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-500 dark:text-gray-400">Margen:</label>
                <input type="number" step="0.01" placeholder="%" value={editForm.default_margin_percent} onChange={e => setEditForm({ ...editForm, default_margin_percent: e.target.value })} className={`${inputClass} w-16`} />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-500 dark:text-gray-400">Color:</label>
                <input type="color" value={editForm.color || '#6b7280'} onChange={e => setEditForm({ ...editForm, color: e.target.value })} className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 cursor-pointer" />
              </div>
              <Button variant="success" onClick={handleSaveEdit} loading={saving}>OK</Button>
              <button onClick={() => setEditingId(null)} className="text-gray-500 dark:text-gray-400 text-xs hover:underline">Cancelar</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {cat.color && <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: cat.color }} />}
                <span className={`font-medium ${depth === 0 ? 'text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-300'}`}>{cat.name}</span>
                <span className="text-gray-400 text-xs">({totalProducts(cat)})</span>
                {cat.default_vat_rate && <span className="text-xs text-gray-400">IVA: {cat.default_vat_rate}%</span>}
                {cat.default_margin_percent && <span className="text-xs text-gray-400">M: {cat.default_margin_percent}%</span>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleMoveUp(cat, siblings)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs px-1" title="Subir">&#9650;</button>
                <button onClick={() => handleMoveDown(cat, siblings)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs px-1" title="Bajar">&#9660;</button>
                <button onClick={() => startEdit(cat)} className="text-blue-500 dark:text-blue-400 text-xs hover:underline px-1">Editar</button>
                <button onClick={() => handleDeleteCategory(cat.id)} className="text-red-500 dark:text-red-400 text-xs hover:underline px-1">Eliminar</button>
              </div>
            </>
          )}
        </div>
        {children.length > 0 && children.map(child => renderCategory(child, depth + 1, children))}
      </div>
    )
  }

  // Only allow first-level categories as parents in the creation form (enforce max 3 levels)
  const parentOptions = categories.filter(c => {
    // Allow root categories always
    if (!c.parent_id) return true
    // Allow second-level categories (their children would be level 3, which is the max)
    const parent = categories.find(p => p.id === c.parent_id)
    if (parent && !parent.parent_id) return true
    return false
  })

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Gestionar categorias ({categories.length})</h3>
      <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="Nombre categoria..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className={`${inputClass} flex-1 min-w-[120px]`} />
          <select value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)} className={inputClass}>
            <option value="">Sin padre (raiz)</option>
            {parentOptions.map(c => <option key={c.id} value={c.id}>{c.parent_id ? '-- ' : ''}{c.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">IVA:</label>
            <select value={newCategoryVat} onChange={e => setNewCategoryVat(e.target.value)} className={`${inputClass} w-20`}>
              <option value="">--</option>
              {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">Margen:</label>
            <input type="number" step="0.01" placeholder="%" value={newCategoryMargin} onChange={e => setNewCategoryMargin(e.target.value)} className={`${inputClass} w-16`} />
          </div>
          <Button variant="primary" onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>+ Crear</Button>
        </div>

        {categories.length > 0 && (
          <div className="space-y-1">
            {rootCategories.map(c => renderCategory(c, 0, rootCategories))}
          </div>
        )}

        {categories.length > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            Usa las flechas para reordenar. Los defaults de IVA y margen se aplican automaticamente al crear productos en esa categoria.
          </p>
        )}
      </div>
    </div>
  )
}
