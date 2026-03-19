import React, { useState, useEffect, useRef } from 'react'
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
  // Debounced search: local state for the input, debounce before calling parent
  const [localSearch, setLocalSearch] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local state when parent search changes (e.g. from clear filters)
  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  const handleSearchInput = (value: string) => {
    setLocalSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearchChange(value)
    }, 350)
  }

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const hasActiveFilters = search || filterCategory || stockStatusFilter !== 'all'

  const handleClearFilters = () => {
    setLocalSearch('')
    onSearchChange('')
    onFilterCategoryChange('')
    onStockStatusChange('all')
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Buscar por nombre, SKU o codigo de barras..."
        value={localSearch}
        onChange={e => handleSearchInput(e.target.value)}
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
      {hasActiveFilters && (
        <button
          onClick={handleClearFilters}
          className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          Limpiar filtros
        </button>
      )}
      {selectedCount > 0 && (
        <Button variant="secondary" onClick={onBulkPrice}>
          Aumentar precio ({selectedCount})
        </Button>
      )}
    </div>
  )
}
