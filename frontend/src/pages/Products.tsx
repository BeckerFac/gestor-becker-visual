import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ExportCSVButton } from '@/components/shared/ExportCSV'
import { ExportExcelButton } from '@/components/shared/ExportExcel'
import { PermissionGate } from '@/components/shared/PermissionGate'
import { Button } from '@/components/ui/Button'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'

import { ProductTable } from '@/components/products/ProductTable'
import { ProductDetailPanel } from '@/components/products/ProductDetailPanel'
import { ProductForm } from '@/components/products/ProductForm'
import { ProductFilters } from '@/components/products/ProductFilters'
import { StockMovements } from '@/components/products/StockMovements'
import { BulkPriceModal } from '@/components/products/BulkPriceModal'
import { TypesManager } from '@/components/products/TypesManager'
import { CategoriesManager } from '@/components/products/CategoriesManager'
import { PriceListsManager } from '@/components/products/PriceListsManager'
import type { Product, ProductType, Category } from '@/components/products/types'
import { emptyForm } from '@/components/products/types'

const ITEMS_PER_PAGE = 50

const TAB_KEYS = ['productos', 'movimientos', 'tipos', 'categorias', 'listas'] as const
type TabKey = typeof TAB_KEYS[number]

export const Products: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as TabKey) || 'productos'
  const [activeTab, setActiveTab] = useState<TabKey>(TAB_KEYS.includes(initialTab) ? initialTab : 'productos')

  // Products state
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasStockProducts, setHasStockProducts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Metadata
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [priceLists, setPriceLists] = useState<any[]>([])

  // Filters
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [stockStatusFilter, setStockStatusFilter] = useState('all')

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkModal, setShowBulkModal] = useState(false)

  // Form
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState(emptyForm)

  // Detail panel
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Update tab in URL
  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab)
    if (tab === 'productos') {
      searchParams.delete('tab')
    } else {
      searchParams.set('tab', tab)
    }
    setSearchParams(searchParams, { replace: true })
  }

  // Load products
  const loadProducts = useCallback(async () => {
    try {
      setLoading(true)
      const skip = (page - 1) * ITEMS_PER_PAGE
      const res = await api.getProducts({
        skip,
        limit: ITEMS_PER_PAGE,
        search: search || undefined,
        category_id: filterCategory || undefined,
        stock_status: stockStatusFilter !== 'all' ? stockStatusFilter : undefined,
      }).catch((err: any) => {
        setError(`Error cargando productos: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`)
        return { items: [], total: 0, has_stock_products: false }
      })
      setProducts(res.items || [])
      setTotal(res.total || 0)
      setHasStockProducts(res.has_stock_products || false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [page, search, filterCategory, stockStatusFilter])

  const loadMetadata = useCallback(async () => {
    const [typesRes, catsRes, plRes] = await Promise.all([
      api.getProductTypes().catch(() => []),
      api.getCategories().catch(() => []),
      api.getPriceLists().catch(() => []),
    ])
    setProductTypes(Array.isArray(typesRes) ? typesRes : [])
    setCategories(Array.isArray(catsRes) ? catsRes : [])
    setPriceLists(Array.isArray(plRes) ? plRes : [])
  }, [])

  useEffect(() => { loadProducts() }, [loadProducts])
  useEffect(() => { loadMetadata() }, [loadMetadata])

  // Close detail panel on route change
  useEffect(() => {
    setSelectedProduct(null)
  }, [activeTab])

  // Reset page on filter change
  const handleSearchChange = (val: string) => { setSearch(val); setPage(1) }
  const handleCategoryChange = (val: string) => { setFilterCategory(val); setPage(1) }
  const handleStockStatusChange = (val: string) => { setStockStatusFilter(val); setPage(1) }

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(products.map(p => p.id)))
  }

  // Edit handler
  const handleEdit = (product: Product) => {
    const pricing = product.pricing
    setEditingForm({
      sku: product.sku, name: product.name, description: product.description || '',
      barcode: product.barcode || '', product_type: product.product_type || 'otro',
      cost: pricing?.cost || '0', margin_percent: pricing?.margin_percent || '30',
      vat_rate: pricing?.vat_rate || '21', final_price: pricing?.final_price || '0',
      controls_stock: !!product.controls_stock,
      low_stock_threshold: String(product.low_stock_threshold || '0'),
    })
    setEditingId(product.id)
    setShowForm(true)
    setSelectedProduct(null)
  }

  // Delete handler
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteProduct(deleteTarget.id)
      toast.success('Producto eliminado')
      await loadProducts()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1

  // Export data
  const exportData = products.map(p => ({
    sku: p.sku,
    nombre: p.name,
    tipo: p.product_type || '-',
    costo: p.pricing ? parseFloat(p.pricing.cost) : '-',
    margen: p.pricing ? `${p.pricing.margin_percent}%` : '-',
    iva: p.pricing ? `${p.pricing.vat_rate}%` : '-',
    precio_final: p.pricing ? parseFloat(p.pricing.final_price) : '-',
    stock: hasStockProducts && p.controls_stock ? parseFloat(String(p.stock_quantity ?? 0)) : '-',
    estado: p.active ? 'Activo' : 'Inactivo',
  }))

  const exportColumns = [
    { key: 'sku', label: 'SKU' },
    { key: 'nombre', label: 'Producto' },
    { key: 'tipo', label: 'Tipo' },
    { key: 'costo', label: 'Costo' },
    { key: 'margen', label: 'Margen' },
    { key: 'iva', label: 'IVA' },
    { key: 'precio_final', label: 'Precio Final' },
    ...(hasStockProducts ? [{ key: 'stock', label: 'Stock' }] : []),
    { key: 'estado', label: 'Estado' },
  ]

  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'productos', label: 'Productos', show: true },
    { key: 'movimientos', label: 'Stock / Movimientos', show: hasStockProducts },
    { key: 'tipos', label: 'Tipos', show: true },
    { key: 'categorias', label: 'Categorias', show: true },
    { key: 'listas', label: 'Listas de Precios', show: true },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Productos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{total} productos registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCSVButton data={exportData} columns={exportColumns} filename="productos" />
          <ExportExcelButton data={exportData} columns={exportColumns} filename="productos" />
          <PermissionGate module="products" action="create">
            <Button
              variant={showForm ? 'danger' : 'primary'}
              onClick={() => {
                if (showForm) {
                  setShowForm(false)
                  setEditingId(null)
                } else {
                  setEditingForm(emptyForm)
                  setEditingId(null)
                  setShowForm(true)
                }
              }}
            >
              {showForm ? 'Cancelar' : '+ Nuevo Producto'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {/* Product form (create/edit) */}
      {showForm && (
        <ProductForm
          editingId={editingId}
          initialForm={editingForm}
          productTypes={productTypes}
          products={products}
          onSaved={() => { setShowForm(false); setEditingId(null); loadProducts(); loadMetadata() }}
          onCancel={() => { setShowForm(false); setEditingId(null) }}
        />
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {tabs.filter(t => t.show).map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Productos tab */}
      {activeTab === 'productos' && (
        <>
          <ProductFilters
            search={search}
            onSearchChange={handleSearchChange}
            filterCategory={filterCategory}
            onFilterCategoryChange={handleCategoryChange}
            categories={categories}
            selectedCount={selectedIds.size}
            onBulkPrice={() => setShowBulkModal(true)}
            hasStockProducts={hasStockProducts}
            stockStatusFilter={stockStatusFilter}
            onStockStatusChange={handleStockStatusChange}
          />

          {showBulkModal && (
            <BulkPriceModal
              selectedIds={selectedIds}
              onClose={() => { setShowBulkModal(false) }}
              onUpdated={() => { setSelectedIds(new Set()); setShowBulkModal(false); loadProducts() }}
            />
          )}

          {loading ? (
            <SkeletonTable rows={6} cols={6} />
          ) : products.length === 0 ? (
            <EmptyState
              title={search ? 'Sin resultados' : 'Sin productos'}
              description={search ? `No se encontraron productos para "${search}"` : 'Crea tu primer producto para empezar.'}
              actionLabel={!search ? '+ Nuevo Producto' : undefined}
              onAction={!search ? () => { setEditingForm(emptyForm); setEditingId(null); setShowForm(true) } : undefined}
            />
          ) : (
            <ProductTable
              products={products}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onRowClick={(product) => setSelectedProduct(product)}
              onEdit={handleEdit}
              onDelete={(product) => setDeleteTarget(product)}
              hasStockProducts={hasStockProducts}
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* Stock / Movimientos tab */}
      {activeTab === 'movimientos' && hasStockProducts && (
        <StockMovements
          products={products}
          onDataChanged={() => { loadProducts(); loadMetadata() }}
        />
      )}

      {/* Tipos tab */}
      {activeTab === 'tipos' && (
        <TypesManager
          productTypes={productTypes}
          onReload={loadMetadata}
        />
      )}

      {/* Categorias tab */}
      {activeTab === 'categorias' && (
        <CategoriesManager
          categories={categories}
          onReload={loadMetadata}
        />
      )}

      {/* Listas de precios tab */}
      {activeTab === 'listas' && (
        <PriceListsManager
          priceLists={priceLists}
          products={products}
          onReload={loadMetadata}
        />
      )}

      {/* Detail Panel */}
      {selectedProduct && (
        <ProductDetailPanel
          product={selectedProduct}
          products={products}
          onClose={() => setSelectedProduct(null)}
          onSaved={() => { loadProducts(); setSelectedProduct(null) }}
        />
      )}

      {/* Delete dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar producto"
        message={`Seguro que queres eliminar "${deleteTarget?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
