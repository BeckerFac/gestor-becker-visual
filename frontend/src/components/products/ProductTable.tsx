import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import type { Product, Category } from './types'

interface ProductTableProps {
  products: Product[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onRowClick: (product: Product) => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  hasStockProducts: boolean
  categories?: Category[]
  onCategoryChanged?: () => void
  // Pagination
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}

const getStockIndicator = (product: Product) => {
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

const CategoryDropdown: React.FC<{
  product: Product
  categories: Category[]
  onCategoryChanged?: () => void
}> = ({ product, categories, onCategoryChanged }) => {
  const [updating, setUpdating] = useState(false)

  const handleChange = async (categoryId: string) => {
    setUpdating(true)
    try {
      await api.updateProduct(product.id, { category_id: categoryId || null })
      toast.success('Categoria actualizada')
      onCategoryChanged?.()
    } catch (e: any) {
      toast.error(e.message || 'Error al actualizar categoria')
    } finally {
      setUpdating(false)
    }
  }

  const currentCategory = categories.find(c => c.id === product.category_id)

  return (
    <select
      value={product.category_id || ''}
      onChange={(e) => handleChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      disabled={updating}
      className={`text-xs border rounded px-1.5 py-0.5 font-medium max-w-[120px] truncate transition-colors ${
        currentCategory
          ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700'
          : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
      } ${updating ? 'opacity-50' : ''}`}
    >
      <option value="">Sin categoria</option>
      {categories.filter(c => !c.parent_id).map(c => (
        <React.Fragment key={c.id}>
          <option value={c.id}>{c.name}</option>
          {categories.filter(sub => sub.parent_id === c.id).map(sub => (
            <option key={sub.id} value={sub.id}>&nbsp;&nbsp;{sub.name}</option>
          ))}
        </React.Fragment>
      ))}
    </select>
  )
}

export const ProductTable: React.FC<ProductTableProps> = ({
  products,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  onEdit,
  onDelete,
  hasStockProducts,
  categories = [],
  onCategoryChanged,
  page,
  totalPages,
  total,
  onPageChange,
}) => {
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size === products.length && products.length > 0}
                  onChange={onToggleSelectAll}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
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
            {products.length === 0 ? (
              <tr>
                <td colSpan={hasStockProducts ? 10 : 9} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                  No hay productos
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                  onClick={() => onRowClick(product)}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(product.id)}
                      onChange={() => onToggleSelect(product.id)}
                      onClick={e => e.stopPropagation()}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-300">{product.sku}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 font-medium">{product.name}</td>
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
                      {product.controls_stock ? getStockIndicator(product) : (
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
                      {categories.length > 0 && (
                        <PermissionGate module="products" action="edit">
                          <CategoryDropdown
                            product={product}
                            categories={categories}
                            onCategoryChanged={onCategoryChanged}
                          />
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
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {total} producto{total !== 1 ? 's' : ''} en total
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Pagina {page} de {totalPages}
              </span>
              <button
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
