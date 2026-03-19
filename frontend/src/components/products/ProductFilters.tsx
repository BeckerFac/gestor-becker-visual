import React from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type { Category } from './types'

interface ProductFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  filterCategory: string
  onFilterCategoryChange: (value: string) => void
  categories: Category[]
  selectedCount: number
  onBulkPrice: () => void
  hasStockProducts: boolean
  stockStatusFilter: string
  onStockStatusChange: (value: string) => void
}

export const ProductFilters: React.FC<ProductFiltersProps> = ({
  search,
  onSearchChange,
  filterCategory,
  onFilterCategoryChange,
  categories,
  selectedCount,
  onBulkPrice,
  hasStockProducts,
  stockStatusFilter,
  onStockStatusChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Buscar por nombre, SKU o codigo de barras..."
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        className="flex-1 min-w-[200px]"
      />
      {categories.length > 0 && (
        <select
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
          value={filterCategory}
          onChange={e => onFilterCategoryChange(e.target.value)}
        >
          <option value="">Todas las categorias</option>
          {categories.filter(c => !c.parent_id).map(c => (
            <React.Fragment key={c.id}>
              <option value={c.id}>{c.name} ({c.product_count})</option>
              {categories.filter(sub => sub.parent_id === c.id).map(sub => (
                <option key={sub.id} value={sub.id}>&nbsp;&nbsp;{sub.name} ({sub.product_count})</option>
              ))}
            </React.Fragment>
          ))}
        </select>
      )}
      {hasStockProducts && (
        <select
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
          value={stockStatusFilter}
          onChange={e => onStockStatusChange(e.target.value)}
        >
          <option value="all">Todo el stock</option>
          <option value="in_stock">Con stock</option>
          <option value="low">Stock bajo</option>
          <option value="out">Sin stock</option>
        </select>
      )}
      {selectedCount > 0 && (
        <Button variant="secondary" onClick={onBulkPrice}>
          Aumentar precio ({selectedCount})
        </Button>
      )}
    </div>
  )
}
