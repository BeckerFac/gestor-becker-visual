import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { useProductDragDrop } from '@/hooks/useProductDragDrop'
import { CategoryRow } from './CategoryRow'
import type { CategoryTreeNode } from './CategoryRow'
import type { Product } from './types'

const STORAGE_KEY = 'gestia-product-tree-expanded'
const PRODUCTS_PER_CATEGORY = 50

interface ProductTreeViewProps {
  search: string
  stockStatusFilter: string
  hasStockProducts: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectMultiple: (ids: string[]) => void
  onDeselectMultiple: (ids: string[]) => void
  onRowClick: (product: Product) => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  onAddProduct: (categoryId?: string) => void
  onReload: () => void
}

// Load expanded state from localStorage
function loadExpanded(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return new Set(JSON.parse(stored))
  } catch { /* ignore */ }
  return new Set()
}

function saveExpanded(expanded: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]))
  } catch { /* ignore */ }
}

// Product row with indentation and drag support
const ProductRow: React.FC<{
  product: Product
  depth: number
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onRowClick: (product: Product) => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  hasStockProducts: boolean
  highlight?: string
  // Drag support
  onDragStart?: (e: React.DragEvent<HTMLTableRowElement>, productId: string, productName: string, sourceCategoryId: string | null) => void
  onDragEnd?: () => void
  isDraggedOver?: boolean
  isTouchDevice?: boolean
  categories?: CategoryTreeNode[]
  onMoveToCategory?: (productId: string, categoryId: string | null) => void
}> = ({ product, depth, isSelected, onToggleSelect, onRowClick, onEdit, onDelete, hasStockProducts, highlight, onDragStart, onDragEnd, isDraggedOver, isTouchDevice, categories, onMoveToCategory }) => {
  const paddingLeft = depth * 24
  const [showMoveMenu, setShowMoveMenu] = useState(false)

  const highlightText = (text: string) => {
    if (!highlight) return text
    const idx = text.toLowerCase().indexOf(highlight.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{text.slice(idx, idx + highlight.length)}</mark>
        {text.slice(idx + highlight.length)}
      </>
    )
  }

  const getStockIndicator = () => {
    const qty = parseFloat(String(product.stock_quantity ?? 0))
    const threshold = parseFloat(String(product.low_stock_threshold ?? 0))
    if (qty <= 0) {
      return <span className="inline-flex items-center gap-1 font-bold text-red-600 dark:text-red-400">
        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{qty}
      </span>
    }
    if (threshold > 0 && qty <= threshold) {
      return <span className="inline-flex items-center gap-1 font-bold text-yellow-600 dark:text-yellow-400">
        <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />{qty}
      </span>
    }
    return <span className="inline-flex items-center gap-1 font-bold text-green-600 dark:text-green-400">
      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{qty}
    </span>
  }

  return (
    <tr
      className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${isDraggedOver ? 'opacity-40' : ''} ${depth > 0 ? 'bg-gray-50/50 dark:bg-gray-800/30' : ''}`}
      onClick={() => onRowClick(product)}
      draggable={!isTouchDevice}
      onDragStart={onDragStart ? (e) => onDragStart(e, product.id, product.name, product.category_id) : undefined}
      onDragEnd={onDragEnd}
      style={!isTouchDevice ? { cursor: 'grab' } : undefined}
    >
      <td className="px-4 py-3 relative" style={{ paddingLeft: paddingLeft + 16 }}>
        {/* Vertical indent line for nested products */}
        {depth > 0 && (
          <div className="absolute left-0 top-0 bottom-0" style={{ left: `${depth * 12}px` }}>
            <div className="w-0.5 h-full bg-gray-200 dark:bg-gray-700" />
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* Drag handle indicator */}
          {!isTouchDevice && (
            <span className="text-gray-300 dark:text-gray-600 select-none" title="Arrastrar para mover">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z"/>
              </svg>
            </span>
          )}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(product.id)}
            onClick={e => e.stopPropagation()}
            className="rounded border-gray-300 dark:border-gray-600"
          />
        </div>
      </td>
      <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-300">
        {highlightText(product.sku)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 font-medium">
        {highlightText(product.name)}
      </td>
      <td className="px-4 py-3 text-sm">
        <span className="px-2 py-0.5 rounded text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
          {product.product_type || '-'}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300">
        {product.pricing ? formatCurrency(parseFloat(product.pricing.cost)) : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-300">
        {product.pricing ? `${product.pricing.margin_percent}%` : '-'}
      </td>
      <td className="px-4 py-3 text-sm text-right">
        {product.pricing ? (
          <span className="font-bold text-green-700 dark:text-green-400">
            {formatCurrency(parseFloat(product.pricing.final_price))}
          </span>
        ) : '-'}
      </td>
      {hasStockProducts && (
        <td className="px-4 py-3 text-sm text-right">
          {product.controls_stock ? getStockIndicator() : (
            <span className="text-gray-300 dark:text-gray-600">-</span>
          )}
        </td>
      )}
      <td className="px-4 py-3 text-sm">
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          product.active
            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
        }`}>
          {product.active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-right">
        <div className="flex gap-2 justify-end items-center">
          {/* Mobile: "Mover a..." button */}
          {isTouchDevice && categories && onMoveToCategory && (
            <PermissionGate module="products" action="edit">
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setShowMoveMenu(!showMoveMenu)}
                  className="text-xs px-2 py-1 rounded text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 border border-purple-200 dark:border-purple-700 transition-colors"
                >
                  Mover a...
                </button>
                {showMoveMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-y-auto">
                    <button
                      onClick={() => { onMoveToCategory(product.id, null); setShowMoveMenu(false) }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${!product.category_id ? 'font-bold text-blue-600' : 'text-gray-700 dark:text-gray-300'}`}
                    >
                      Sin categoria
                    </button>
                    {categories.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => { onMoveToCategory(product.id, cat.id); setShowMoveMenu(false) }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${product.category_id === cat.id ? 'font-bold text-blue-600' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </PermissionGate>
          )}
          <PermissionGate module="products" action="edit">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(product) }}
              className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
            >
              Editar
            </button>
          </PermissionGate>
          <PermissionGate module="products" action="delete">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(product) }}
              className="text-red-600 dark:text-red-400 hover:underline text-sm"
            >
              Eliminar
            </button>
          </PermissionGate>
        </div>
      </td>
    </tr>
  )
}

// Category products loader component
const CategoryProducts: React.FC<{
  categoryId: string
  depth: number
  search: string
  stockStatusFilter: string
  hasStockProducts: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectMultiple: (ids: string[]) => void
  onRowClick: (product: Product) => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  // Drag support
  onDragStart?: (e: React.DragEvent<HTMLTableRowElement>, productId: string, productName: string, sourceCategoryId: string | null) => void
  onDragEnd?: () => void
  isDraggedProduct?: (productId: string) => boolean
  isTouchDevice?: boolean
  allCategories?: CategoryTreeNode[]
  onMoveToCategory?: (productId: string, categoryId: string | null) => void
}> = ({ categoryId, depth, search, stockStatusFilter, hasStockProducts, selectedIds, onToggleSelect, onSelectMultiple, onRowClick, onEdit, onDelete, onDragStart, onDragEnd, isDraggedProduct, isTouchDevice, allCategories, onMoveToCategory }) => {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const loadedRef = useRef(false)

  const loadProducts = useCallback(async (pageNum: number, append: boolean = false) => {
    try {
      setLoading(true)
      const skip = (pageNum - 1) * PRODUCTS_PER_CATEGORY
      const res = await api.getProductsByCategory({
        category_id: categoryId,
        skip,
        limit: PRODUCTS_PER_CATEGORY,
        search: search || undefined,
        stock_status: stockStatusFilter !== 'all' ? stockStatusFilter : undefined,
      })
      if (append) {
        setProducts(prev => [...prev, ...(res.items || [])])
      } else {
        setProducts(res.items || [])
      }
      setTotal(res.total || 0)
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [categoryId, search, stockStatusFilter])

  useEffect(() => {
    loadedRef.current = false
    setPage(1)
    loadProducts(1)
  }, [loadProducts])

  const hasMore = products.length < total

  const handleLoadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    loadProducts(nextPage, true)
  }

  if (loading && products.length === 0) {
    return (
      <tr>
        <td colSpan={hasStockProducts ? 10 : 9} className="px-4 py-3" style={{ paddingLeft: depth * 24 + 24 }}>
          <span className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">Cargando productos...</span>
        </td>
      </tr>
    )
  }

  if (products.length === 0 && !loading) {
    return (
      <tr>
        <td colSpan={hasStockProducts ? 10 : 9} className="px-4 py-3" style={{ paddingLeft: depth * 24 + 24 }}>
          <span className="text-sm text-gray-400 dark:text-gray-500 italic">
            {search ? 'Sin resultados en esta categoria' : 'Sin productos en esta categoria'}
          </span>
        </td>
      </tr>
    )
  }

  return (
    <>
      {products.map(product => (
        <ProductRow
          key={product.id}
          product={product}
          depth={depth + 1}
          isSelected={selectedIds.has(product.id)}
          onToggleSelect={onToggleSelect}
          onRowClick={onRowClick}
          onEdit={onEdit}
          onDelete={onDelete}
          hasStockProducts={hasStockProducts}
          highlight={search}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          isDraggedOver={isDraggedProduct?.(product.id)}
          isTouchDevice={isTouchDevice}
          categories={allCategories}
          onMoveToCategory={onMoveToCategory}
        />
      ))}
      {hasMore && (
        <tr>
          <td colSpan={hasStockProducts ? 10 : 9} className="px-4 py-2" style={{ paddingLeft: depth * 24 + 24 }}>
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {loading ? 'Cargando...' : `Cargar mas (mostrando ${products.length} de ${total})`}
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

export const ProductTreeView: React.FC<ProductTreeViewProps> = ({
  search,
  stockStatusFilter,
  hasStockProducts,
  selectedIds,
  onToggleSelect,
  onSelectMultiple,
  onDeselectMultiple,
  onRowClick,
  onEdit,
  onDelete,
  onAddProduct,
  onReload,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded)
  const [treeData, setTreeData] = useState<{
    categories: CategoryTreeNode[]
    uncategorized_count: number
    uncategorized_stock_value: number
    has_stock_products: boolean
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // New root category form
  const [showNewRootForm, setShowNewRootForm] = useState(false)
  const [newRootName, setNewRootName] = useState('')
  const [creatingRoot, setCreatingRoot] = useState(false)

  const loadTree = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getCategoryTree({
        search: search || undefined,
        stock_status: stockStatusFilter !== 'all' ? stockStatusFilter : undefined,
      })
      setTreeData(data)
    } catch (e: any) {
      toast.error('Error cargando arbol de categorias')
    } finally {
      setLoading(false)
    }
  }, [search, stockStatusFilter])

  useEffect(() => { loadTree() }, [loadTree])

  // Auto-expand categories with search matches
  useEffect(() => {
    if (search && treeData) {
      const newExpanded = new Set(expanded)
      const expandMatches = (cats: CategoryTreeNode[]) => {
        for (const cat of cats) {
          if (cat.has_search_match) {
            newExpanded.add(cat.id)
            // Also expand parents (already handled by has_search_match propagation)
          }
          if (cat.children.length > 0) expandMatches(cat.children)
        }
      }
      expandMatches(treeData.categories)
      setExpanded(newExpanded)
      saveExpanded(newExpanded)
    }
  }, [search, treeData]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (categoryId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      saveExpanded(next)
      return next
    })
  }

  const expandAll = () => {
    if (!treeData) return
    const allIds = new Set<string>()
    const collect = (cats: CategoryTreeNode[]) => {
      for (const cat of cats) {
        allIds.add(cat.id)
        if (cat.children.length > 0) collect(cat.children)
      }
    }
    collect(treeData.categories)
    setExpanded(allIds)
    saveExpanded(allIds)
  }

  const collapseAll = () => {
    setExpanded(new Set())
    saveExpanded(new Set())
  }

  const handleDeleteCategory = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteCategory(deleteTarget)
      toast.success('Categoria eliminada')
      await loadTree()
      onReload()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const handleCreateRoot = async () => {
    if (!newRootName.trim()) return
    setCreatingRoot(true)
    try {
      await api.createCategory({ name: newRootName.trim() })
      setNewRootName('')
      setShowNewRootForm(false)
      await loadTree()
      onReload()
      toast.success('Categoria creada')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCreatingRoot(false)
    }
  }

  const handleFullReload = async () => {
    await loadTree()
    onReload()
  }

  // Drag and drop
  const dnd = useProductDragDrop({
    selectedIds,
    onReload: handleFullReload,
    expandCategory: (categoryId: string) => {
      setExpanded(prev => {
        if (prev.has(categoryId)) return prev
        const next = new Set(prev)
        next.add(categoryId)
        saveExpanded(next)
        return next
      })
    },
    isCategoryExpanded: (categoryId: string) => expanded.has(categoryId),
  })

  // Flatten categories for mobile move menu
  const flattenCategories = (cats: CategoryTreeNode[]): CategoryTreeNode[] => {
    const result: CategoryTreeNode[] = []
    for (const cat of cats) {
      result.push(cat)
      if (cat.children.length > 0) {
        result.push(...flattenCategories(cat.children))
      }
    }
    return result
  }
  const allFlatCategories = treeData ? flattenCategories(treeData.categories) : []

  // Get the category that's about to be deleted for its info
  const findCategory = (cats: CategoryTreeNode[], id: string): CategoryTreeNode | null => {
    for (const cat of cats) {
      if (cat.id === id) return cat
      const found = findCategory(cat.children, id)
      if (found) return found
    }
    return null
  }

  const deleteCat = deleteTarget && treeData ? findCategory(treeData.categories, deleteTarget) : null
  const deleteMessage = deleteCat
    ? deleteCat.total_product_count > 0
      ? `"${deleteCat.name}" tiene ${deleteCat.total_product_count} producto(s). Se moveran a "Sin categoria". Continuar?`
      : deleteCat.children.length > 0
        ? `"${deleteCat.name}" tiene subcategorias. Se moveran al nivel superior. Continuar?`
        : `Seguro que queres eliminar "${deleteCat.name}"?`
    : 'Seguro que queres eliminar esta categoria?'

  const renderCategoryTree = (categories: CategoryTreeNode[], depth: number): React.ReactNode => {
    return categories.map(cat => {
      const isExp = expanded.has(cat.id)
      return (
        <React.Fragment key={cat.id}>
          <CategoryRow
            category={cat}
            depth={depth}
            isExpanded={isExp}
            onToggle={() => toggleExpand(cat.id)}
            onAddProduct={(catId) => onAddProduct(catId)}
            onAddSubcategory={(parentId) => {
              // This is handled inside CategoryRow with inline form
            }}
            onEdit={() => {
              // Editing is handled inline in CategoryRow
            }}
            onDelete={(catId) => setDeleteTarget(catId)}
            onReload={handleFullReload}
            hasStockProducts={hasStockProducts}
            isDropTarget={dnd.isDropTargetActive(cat.id)}
            onDragOver={(e) => dnd.handleCategoryDragOver(e, cat.id)}
            onDragLeave={dnd.handleCategoryDragLeave}
            onDrop={(e) => dnd.handleCategoryDrop(e, cat.id)}
            isDraggingActive={dnd.isDragging}
          />
          {isExp && cat.children.length > 0 && renderCategoryTree(cat.children, depth + 1)}
          {isExp && (
            <CategoryProducts
              categoryId={cat.id}
              depth={depth}
              search={search}
              stockStatusFilter={stockStatusFilter}
              hasStockProducts={hasStockProducts}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onSelectMultiple={onSelectMultiple}
              onRowClick={onRowClick}
              onEdit={onEdit}
              onDelete={onDelete}
              onDragStart={dnd.handleDragStart}
              onDragEnd={dnd.handleDragEnd}
              isDraggedProduct={dnd.isDraggedProduct}
              isTouchDevice={dnd.isTouchDevice}
              allCategories={allFlatCategories}
              onMoveToCategory={dnd.handleMoveToCategory}
            />
          )}
        </React.Fragment>
      )
    })
  }

  if (loading && !treeData) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400 dark:text-gray-500 animate-pulse">
          Cargando arbol de productos...
        </CardContent>
      </Card>
    )
  }

  if (!treeData) return null

  const inputClass = 'px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100'

  return (
    <>
      {/* Tree toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={expandAll}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Expandir todo
        </button>
        <button
          onClick={collapseAll}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Colapsar todo
        </button>
        <PermissionGate module="products" action="create">
          {showNewRootForm ? (
            <div className="flex items-center gap-2">
              <input
                placeholder="Nombre categoria..."
                value={newRootName}
                onChange={e => setNewRootName(e.target.value)}
                className={`${inputClass} min-w-[150px]`}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateRoot()
                  if (e.key === 'Escape') setShowNewRootForm(false)
                }}
              />
              <Button variant="primary" onClick={handleCreateRoot} loading={creatingRoot} disabled={!newRootName.trim()}>
                Crear
              </Button>
              <button onClick={() => setShowNewRootForm(false)} className="text-gray-400 text-xs hover:underline">
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewRootForm(true)}
              className="text-xs px-3 py-1.5 rounded border border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            >
              + Nueva Categoria
            </button>
          )}
        </PermissionGate>
      </div>

      {/* Tree table */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 w-10">
                  {/* Checkbox column for products */}
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">SKU</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Producto</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Tipo</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Costo</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Margen%</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Precio</th>
                {hasStockProducts && (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Stock</th>
                )}
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Estado</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {/* Categorized products tree */}
              {renderCategoryTree(treeData.categories, 0)}

              {/* Separator */}
              {treeData.uncategorized_count > 0 && treeData.categories.length > 0 && (
                <tr>
                  <td colSpan={hasStockProducts ? 10 : 9} className="px-0 py-1">
                    <div className="border-t-2 border-gray-300 dark:border-gray-600 border-dashed" />
                  </td>
                </tr>
              )}

              {/* Uncategorized products - always show as drop target when dragging */}
              {(treeData.uncategorized_count > 0 || dnd.isDragging) && (
                <>
                  <tr
                    className={`bg-gray-50/50 dark:bg-gray-800/40 transition-colors ${dnd.isDropTargetActive(null) ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
                    onDragOver={(e) => dnd.handleCategoryDragOver(e, null)}
                    onDragLeave={dnd.handleCategoryDragLeave}
                    onDrop={(e) => dnd.handleCategoryDrop(e, null)}
                  >
                    <td colSpan={hasStockProducts ? 10 : 9} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-600 dark:text-gray-300">Sin categoria</span>
                        <span className="text-xs text-gray-400">
                          ({treeData.uncategorized_count} producto{treeData.uncategorized_count !== 1 ? 's' : ''})
                        </span>
                        {treeData.uncategorized_stock_value > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                            {formatCurrency(treeData.uncategorized_stock_value)} en stock
                          </span>
                        )}
                        {dnd.isDropTargetActive(null) && (
                          <span className="text-xs text-blue-500 dark:text-blue-400 font-medium animate-pulse">
                            Soltar aqui
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {treeData.uncategorized_count > 0 && (
                    <CategoryProducts
                      categoryId="uncategorized"
                      depth={0}
                      search={search}
                      stockStatusFilter={stockStatusFilter}
                      hasStockProducts={hasStockProducts}
                      selectedIds={selectedIds}
                      onToggleSelect={onToggleSelect}
                      onSelectMultiple={onSelectMultiple}
                      onRowClick={onRowClick}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onDragStart={dnd.handleDragStart}
                      onDragEnd={dnd.handleDragEnd}
                      isDraggedProduct={dnd.isDraggedProduct}
                      isTouchDevice={dnd.isTouchDevice}
                      allCategories={allFlatCategories}
                      onMoveToCategory={dnd.handleMoveToCategory}
                    />
                  )}
                </>
              )}

              {/* Empty state */}
              {treeData.categories.length === 0 && treeData.uncategorized_count === 0 && (
                <tr>
                  <td colSpan={hasStockProducts ? 10 : 9} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <p className="text-lg font-medium mb-2">Sin productos</p>
                    <p className="text-sm">Crea tu primer producto o categoria para empezar.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Delete category dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar categoria"
        message={deleteMessage}
        confirmLabel="Eliminar"
        onConfirm={handleDeleteCategory}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </>
  )
}
