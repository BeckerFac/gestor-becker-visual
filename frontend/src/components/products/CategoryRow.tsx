import React, { useState } from 'react'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import type { Category } from './types'
import { VAT_OPTIONS } from './types'

interface CategoryTreeNode {
  id: string
  name: string
  parent_id: string | null
  color: string | null
  sort_order: number
  default_vat_rate: string | null
  default_margin_percent: string | null
  product_count: number
  stock_value: number
  total_product_count: number
  total_stock_value: number
  has_search_match: boolean
  children: CategoryTreeNode[]
}

interface CategoryRowProps {
  category: CategoryTreeNode
  depth: number
  isExpanded: boolean
  onToggle: () => void
  onAddProduct: (categoryId: string) => void
  onAddSubcategory: (parentId: string) => void
  onEdit: (category: CategoryTreeNode) => void
  onDelete: (categoryId: string) => void
  onReload: () => void
  hasStockProducts: boolean
  // Drop target props
  isDropTarget?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isDraggingActive?: boolean
  // Context menu
  onContextMenu?: (e: React.MouseEvent, category: CategoryTreeNode) => void
}

function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return formatCurrency(value)
}

export const CategoryRow: React.FC<CategoryRowProps> = ({
  category,
  depth,
  isExpanded,
  onToggle,
  onAddProduct,
  onAddSubcategory,
  onEdit,
  onDelete,
  onReload,
  hasStockProducts,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  isDraggingActive,
  onContextMenu: onContextMenuProp,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    name: category.name,
    default_vat_rate: category.default_vat_rate || '',
    default_margin_percent: category.default_margin_percent || '',
    color: category.color || '',
  })
  const [saving, setSaving] = useState(false)

  // Inline subcategory creation
  const [showSubcatForm, setShowSubcatForm] = useState(false)
  const [subcatName, setSubcatName] = useState('')
  const [creatingSub, setCreatingSub] = useState(false)

  const paddingLeft = depth * 24

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await api.updateCategory(category.id, {
        name: editForm.name,
        default_vat_rate: editForm.default_vat_rate ? parseFloat(editForm.default_vat_rate) : null,
        default_margin_percent: editForm.default_margin_percent ? parseFloat(editForm.default_margin_percent) : null,
        color: editForm.color || null,
      })
      setIsEditing(false)
      onReload()
      toast.success('Categoria actualizada')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreateSubcategory = async () => {
    if (!subcatName.trim()) return
    setCreatingSub(true)
    try {
      await api.createCategory({
        name: subcatName.trim(),
        parent_id: category.id,
      })
      setSubcatName('')
      setShowSubcatForm(false)
      onReload()
      toast.success('Subcategoria creada')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCreatingSub(false)
    }
  }

  const inputClass = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100'

  if (isEditing) {
    return (
      <tr className="bg-blue-50/50 dark:bg-blue-900/20">
        <td colSpan={hasStockProducts ? 10 : 9} className="px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap" style={{ paddingLeft }}>
            <input
              value={editForm.name}
              onChange={e => setEditForm({ ...editForm, name: e.target.value })}
              className={`${inputClass} flex-1 min-w-[120px]`}
              autoFocus
            />
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">IVA:</label>
              <select
                value={editForm.default_vat_rate}
                onChange={e => setEditForm({ ...editForm, default_vat_rate: e.target.value })}
                className={`${inputClass} w-20`}
              >
                <option value="">--</option>
                {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">Margen:</label>
              <input
                type="number"
                step="0.01"
                placeholder="%"
                value={editForm.default_margin_percent}
                onChange={e => setEditForm({ ...editForm, default_margin_percent: e.target.value })}
                className={`${inputClass} w-16`}
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">Color:</label>
              <input
                type="color"
                value={editForm.color || '#6b7280'}
                onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
              />
            </div>
            <Button variant="success" onClick={handleSaveEdit} loading={saving}>OK</Button>
            <button
              onClick={() => setIsEditing(false)}
              className="text-gray-500 dark:text-gray-400 text-xs hover:underline"
            >
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700/60 cursor-pointer transition-colors group ${isDropTarget ? 'ring-2 ring-inset ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''} ${isDraggingActive ? 'transition-all duration-150' : ''}`}
        onClick={onToggle}
        onContextMenu={onContextMenuProp ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenuProp(e, category) } : undefined}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <td
          colSpan={hasStockProducts ? 10 : 9}
          className="px-4 py-2.5"
        >
          <div className="flex items-center justify-between" style={{ paddingLeft }}>
            <div className="flex items-center gap-2">
              {/* Color indicator bar */}
              {category.color && (
                <span
                  className="w-1 h-6 rounded-full inline-block flex-shrink-0"
                  style={{ backgroundColor: category.color }}
                />
              )}

              {/* Expand/collapse arrow */}
              <button
                className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 transition-transform duration-200 flex-shrink-0"
                style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                onClick={(e) => { e.stopPropagation(); onToggle() }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Category name */}
              <span className={`font-semibold ${depth === 0 ? 'text-gray-800 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'}`}>
                {category.name}
              </span>

              {/* Count badge */}
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({category.total_product_count} producto{category.total_product_count !== 1 ? 's' : ''})
              </span>

              {/* Stock value badge */}
              {category.total_stock_value > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                  {formatCompactCurrency(category.total_stock_value)} en stock
                </span>
              )}

              {/* Defaults info */}
              {category.default_vat_rate && (
                <span className="text-xs text-gray-400">IVA: {category.default_vat_rate}%</span>
              )}
              {category.default_margin_percent && (
                <span className="text-xs text-gray-400">M: {category.default_margin_percent}%</span>
              )}
              {isDropTarget && (
                <span className="text-xs text-blue-500 dark:text-blue-400 font-medium animate-pulse">
                  Soltar aqui
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
              <PermissionGate module="products" action="create">
                <button
                  onClick={() => { setShowSubcatForm(!showSubcatForm); if (!isExpanded) onToggle() }}
                  className="text-xs px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                  title="Agregar subcategoria"
                >
                  + Sub
                </button>
                <button
                  onClick={() => onAddProduct(category.id)}
                  className="text-xs px-2 py-1 rounded text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
                  title="Agregar producto en esta categoria"
                >
                  + Producto
                </button>
              </PermissionGate>
              <PermissionGate module="products" action="edit">
                <button
                  onClick={() => {
                    setEditForm({
                      name: category.name,
                      default_vat_rate: category.default_vat_rate || '',
                      default_margin_percent: category.default_margin_percent || '',
                      color: category.color || '',
                    })
                    setIsEditing(true)
                  }}
                  className="text-xs px-2 py-1 rounded text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                  title="Editar categoria"
                >
                  Editar
                </button>
              </PermissionGate>
              <PermissionGate module="products" action="delete">
                <button
                  onClick={() => onDelete(category.id)}
                  className="text-xs px-2 py-1 rounded text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  title="Eliminar categoria"
                >
                  Eliminar
                </button>
              </PermissionGate>
            </div>
          </div>
        </td>
      </tr>

      {/* Inline subcategory form */}
      {showSubcatForm && isExpanded && (
        <tr className="bg-blue-50/30 dark:bg-blue-900/10">
          <td colSpan={hasStockProducts ? 10 : 9} className="px-4 py-2">
            <div className="flex items-center gap-2" style={{ paddingLeft: paddingLeft + 24 }}>
              <input
                placeholder="Nombre de subcategoria..."
                value={subcatName}
                onChange={e => setSubcatName(e.target.value)}
                className={`${inputClass} flex-1 min-w-[150px]`}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateSubcategory()
                  if (e.key === 'Escape') setShowSubcatForm(false)
                }}
              />
              <Button
                variant="primary"
                onClick={handleCreateSubcategory}
                loading={creatingSub}
                disabled={!subcatName.trim()}
              >
                Crear
              </Button>
              <button
                onClick={() => setShowSubcatForm(false)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 text-xs"
              >
                Cancelar
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export type { CategoryTreeNode }
