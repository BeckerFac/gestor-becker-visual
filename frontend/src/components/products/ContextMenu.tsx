import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/hooks/useToast'
import { api } from '@/services/api'
import { formatCurrency } from '@/lib/utils'
import type { Product } from './types'
import type { CategoryTreeNode } from './CategoryRow'

// --- Types ---

interface ContextMenuState {
  x: number
  y: number
  type: 'product' | 'category' | 'empty'
  item: Product | CategoryTreeNode | null
}

interface ContextMenuProps {
  menu: ContextMenuState
  categories: CategoryTreeNode[]
  onClose: () => void
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  onDeleteCategory: (categoryId: string) => void
  onAddProduct: (categoryId?: string) => void
  onAddSubcategory: (parentId: string) => void
  onToggleExpand: (categoryId: string) => void
  isExpanded: (categoryId: string) => boolean
  onReload: () => void
  onRowClick: (product: Product) => void
}

// --- Preset colors ---

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

// --- SVG Icons ---

const icons = {
  addSub: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  ),
  addProduct: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  rename: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  color: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  ),
  move: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  ),
  price: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  expand: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  ),
  collapse: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V5m0 4H5m4 0L4 4m11 5h4m-4 0V5m0 4l5-5M9 15v4m0-4H5m4 0L4 20m11-5h4m-4 0v4m0-4l5 5" />
    </svg>
  ),
  trash: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  edit: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  ),
  duplicate: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  stock: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  history: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  chevron: (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  ),
}

// --- Sub-components ---

const MenuSeparator = () => (
  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
)

const MenuItem: React.FC<{
  icon: React.ReactNode
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  hasSubmenu?: boolean
  children?: React.ReactNode
}> = ({ icon, label, onClick, danger, disabled, hasSubmenu, children }) => {
  const [showSub, setShowSub] = useState(false)
  const itemRef = useRef<HTMLButtonElement>(null)

  const baseClass = `w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors rounded-md ${
    disabled
      ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
      : danger
        ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
  }`

  if (hasSubmenu && children) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setShowSub(true)}
        onMouseLeave={() => setShowSub(false)}
      >
        <button ref={itemRef} className={baseClass} disabled={disabled}>
          {icon}
          <span className="flex-1">{label}</span>
          {icons.chevron}
        </button>
        {showSub && (
          <div className="absolute left-full top-0 ml-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] max-h-[300px] overflow-y-auto z-[10000]">
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <button className={baseClass} onClick={disabled ? undefined : onClick} disabled={disabled}>
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  )
}

// --- Small Modal Components ---

const StockAdjustModal: React.FC<{
  product: Product
  onClose: () => void
  onDone: () => void
}> = ({ product, onClose, onDone }) => {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const qty = parseFloat(quantity)
    if (!qty || qty === 0) return toast.error('Ingresa una cantidad')
    if (!reason.trim()) return toast.error('Ingresa un motivo')
    setLoading(true)
    try {
      await api.adjustStock({
        product_id: product.id,
        quantity_change: qty,
        reason: reason.trim(),
      })
      toast.success(`Stock ajustado: ${qty > 0 ? '+' : ''}${qty}`)
      onDone()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Error al ajustar stock')
    } finally {
      setLoading(false)
    }
  }

  if (!product.controls_stock) {
    return (
      <MiniModal title="Ajustar stock" onClose={onClose}>
        <p className="text-sm text-gray-500 dark:text-gray-400">Este producto no controla stock.</p>
      </MiniModal>
    )
  }

  return (
    <MiniModal title={`Ajustar stock: ${product.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            Stock actual: {product.stock_quantity ?? 0}
          </label>
          <input
            type="number"
            placeholder="Ej: +10 o -5"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
            autoFocus
          />
        </div>
        <div>
          <input
            type="text"
            placeholder="Motivo del ajuste..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !quantity || !reason.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Ajustando...' : 'Ajustar'}
          </button>
        </div>
      </div>
    </MiniModal>
  )
}

const PriceAdjustModal: React.FC<{
  product: Product
  onClose: () => void
  onDone: () => void
}> = ({ product, onClose, onDone }) => {
  const [mode, setMode] = useState<'absolute' | 'percent'>('absolute')
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const num = parseFloat(value)
    if (isNaN(num)) return toast.error('Ingresa un valor valido')
    setLoading(true)
    try {
      if (mode === 'percent') {
        await api.bulkUpdatePrice([product.id], num)
      } else {
        // Absolute: set new cost, recalculate
        await api.updateProduct(product.id, {
          cost: num,
          margin_percent: product.pricing?.margin_percent || '30',
          vat_rate: product.pricing?.vat_rate || '21',
        })
      }
      toast.success('Precio actualizado')
      onDone()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Error al ajustar precio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <MiniModal title={`Ajustar precio: ${product.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('absolute')}
            className={`flex-1 text-sm py-1.5 rounded-lg border ${mode === 'absolute' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
          >
            Nuevo costo
          </button>
          <button
            onClick={() => setMode('percent')}
            className={`flex-1 text-sm py-1.5 rounded-lg border ${mode === 'percent' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
          >
            Ajustar %
          </button>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {product.pricing ? `Costo actual: ${formatCurrency(parseFloat(product.pricing.cost))} | Final: ${formatCurrency(parseFloat(product.pricing.final_price))}` : 'Sin precio configurado'}
          </label>
          <input
            type="number"
            step="0.01"
            placeholder={mode === 'absolute' ? 'Nuevo costo ($)' : 'Porcentaje (ej: 10 o -5)'}
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !value}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Aplicando...' : 'Aplicar'}
          </button>
        </div>
      </div>
    </MiniModal>
  )
}

const BulkPriceAdjustModal: React.FC<{
  category: CategoryTreeNode
  onClose: () => void
  onDone: () => void
}> = ({ category, onClose, onDone }) => {
  const [percent, setPercent] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    const num = parseFloat(percent)
    if (isNaN(num) || num === 0) return toast.error('Ingresa un porcentaje valido (distinto de 0)')
    setLoading(true)
    try {
      // Get all product IDs in this category
      const res = await api.getProductsByCategory({
        category_id: category.id,
        limit: 1000,
        skip: 0,
      })
      const ids = (res.items || []).map((p: any) => p.id)
      if (ids.length === 0) {
        toast.error('No hay productos en esta categoria')
        setLoading(false)
        return
      }
      await api.bulkUpdatePrice(ids, num)
      toast.success(`Precio ajustado ${num > 0 ? '+' : ''}${num}% en ${ids.length} producto(s)`)
      onDone()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Error al ajustar precios')
    } finally {
      setLoading(false)
    }
  }

  return (
    <MiniModal title={`Ajustar precios: ${category.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Se aplicara a {category.product_count} producto(s) directos en esta categoria.
        </p>
        <input
          type="number"
          step="0.01"
          placeholder="Porcentaje (ej: 10 o -5)"
          value={percent}
          onChange={e => setPercent(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={loading || !percent}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Aplicando...' : 'Aplicar'}
          </button>
        </div>
      </div>
    </MiniModal>
  )
}

const PriceHistoryModal: React.FC<{
  product: Product
  onClose: () => void
}> = ({ product, onClose }) => {
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getPriceHistory(product.id, 50)
      .then(data => setHistory(data.items || data || []))
      .catch(() => toast.error('Error cargando historial'))
      .finally(() => setLoading(false))
  }, [product.id])

  const fieldLabels: Record<string, string> = {
    cost: 'Costo',
    margin: 'Margen',
    vat_rate: 'IVA',
    final_price: 'Precio final',
  }

  return (
    <MiniModal title={`Historial de precios: ${product.name}`} onClose={onClose} wide>
      {loading ? (
        <p className="text-sm text-gray-400 animate-pulse py-4 text-center">Cargando...</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Sin historial de cambios.</p>
      ) : (
        <div className="max-h-[400px] overflow-y-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1.5 px-2">Fecha</th>
                <th className="py-1.5 px-2">Campo</th>
                <th className="py-1.5 px-2 text-right">Anterior</th>
                <th className="py-1.5 px-2 text-right">Nuevo</th>
                <th className="py-1.5 px-2">Origen</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h: any, i: number) => (
                <tr key={h.id || i} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-1.5 px-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {new Date(h.changed_at || h.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="py-1.5 px-2">{fieldLabels[h.field_changed] || h.field_changed}</td>
                  <td className="py-1.5 px-2 text-right text-red-500">{formatCurrency(parseFloat(h.old_value || '0'))}</td>
                  <td className="py-1.5 px-2 text-right text-green-600 dark:text-green-400">{formatCurrency(parseFloat(h.new_value || '0'))}</td>
                  <td className="py-1.5 px-2 text-gray-400 text-xs">{h.change_source || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </MiniModal>
  )
}

const ColorPickerInline: React.FC<{
  category: CategoryTreeNode
  onClose: () => void
  onDone: () => void
}> = ({ category, onClose, onDone }) => {
  const [loading, setLoading] = useState(false)

  const handlePick = async (color: string | null) => {
    setLoading(true)
    try {
      await api.updateCategory(category.id, { color })
      toast.success('Color actualizado')
      onDone()
    } catch (e: any) {
      toast.error(e?.message || 'Error al cambiar color')
    } finally {
      setLoading(false)
    }
  }

  return (
    <MiniModal title={`Color: ${category.name}`} onClose={onClose}>
      <div className="flex flex-wrap gap-2 justify-center py-2">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            onClick={() => handlePick(c)}
            disabled={loading}
            className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${category.color === c ? 'border-gray-900 dark:border-white ring-2 ring-offset-2 ring-blue-400' : 'border-gray-200 dark:border-gray-600'}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <button
          onClick={() => handlePick(null)}
          disabled={loading}
          className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 text-xs hover:scale-110 transition-transform"
          title="Sin color"
        >
          X
        </button>
      </div>
    </MiniModal>
  )
}

// --- Generic Mini Modal ---

const MiniModal: React.FC<{
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}> = ({ title, onClose, children, wide }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl ${wide ? 'max-w-lg' : 'max-w-sm'} w-full mx-4 p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

// --- Main ContextMenu ---

export const ContextMenu: React.FC<ContextMenuProps> = ({
  menu,
  categories,
  onClose,
  onEdit,
  onDelete,
  onDeleteCategory,
  onAddProduct,
  onAddSubcategory,
  onToggleExpand,
  isExpanded,
  onReload,
  onRowClick,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })

  // Sub-modals
  const [stockModal, setStockModal] = useState<Product | null>(null)
  const [priceModal, setPriceModal] = useState<Product | null>(null)
  const [bulkPriceModal, setBulkPriceModal] = useState<CategoryTreeNode | null>(null)
  const [historyModal, setHistoryModal] = useState<Product | null>(null)
  const [colorModal, setColorModal] = useState<CategoryTreeNode | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'product' | 'category'; item: any } | null>(null)

  // Rename inline
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  // Duplicating
  const [duplicating, setDuplicating] = useState(false)

  // Moving products
  const [movingAll, setMovingAll] = useState(false)

  // Viewport clamping
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = menu
    if (x + rect.width > vw - 8) x = vw - rect.width - 8
    if (y + rect.height > vh - 8) y = vh - rect.height - 8
    if (x < 8) x = 8
    if (y < 8) y = 8
    setPosition({ x, y })
  }, [menu])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid immediate close from the right-click itself
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 10)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick) }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Close on scroll
  useEffect(() => {
    const handleScroll = () => onClose()
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [onClose])

  // Don't show on mobile
  const isMobile = window.matchMedia('(max-width: 768px)').matches
  if (isMobile) return null

  const closeAndDo = (fn: () => void) => {
    onClose()
    fn()
  }

  // Flatten categories for move menus
  const flatCats = flattenCategories(categories)

  // --- Handlers ---

  const handleDuplicate = async (product: Product) => {
    onClose()
    setDuplicating(true)
    try {
      await api.duplicateProduct(product.id)
      toast.success(`Producto duplicado: ${product.name}`)
      onReload()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Error al duplicar')
    } finally {
      setDuplicating(false)
    }
  }

  const handleMoveProduct = async (product: Product, categoryId: string | null) => {
    onClose()
    try {
      await api.updateProduct(product.id, { category_id: categoryId })
      toast.success('Producto movido')
      onReload()
    } catch (e: any) {
      toast.error(e?.message || 'Error al mover producto')
    }
  }

  const handleMoveAllProducts = async (category: CategoryTreeNode, targetCategoryId: string | null) => {
    onClose()
    setMovingAll(true)
    try {
      const res = await api.getProductsByCategory({
        category_id: category.id,
        limit: 1000,
        skip: 0,
      })
      const items = res.items || []
      if (items.length === 0) {
        toast.error('No hay productos para mover')
        return
      }
      await Promise.all(items.map((p: any) => api.updateProduct(p.id, { category_id: targetCategoryId })))
      toast.success(`${items.length} producto(s) movido(s)`)
      onReload()
    } catch (e: any) {
      toast.error(e?.message || 'Error al mover productos')
    } finally {
      setMovingAll(false)
    }
  }

  const handleRename = async (category: CategoryTreeNode) => {
    if (!renameValue.trim()) return
    setRenameSaving(true)
    try {
      await api.updateCategory(category.id, { name: renameValue.trim() })
      toast.success('Categoria renombrada')
      onReload()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Error al renombrar')
    } finally {
      setRenameSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    if (confirmDelete.type === 'product') {
      onDelete(confirmDelete.item as Product)
    } else {
      onDeleteCategory(confirmDelete.item.id)
    }
    setConfirmDelete(null)
    onClose()
  }

  // --- Render sub-modals (portalled, not inside the menu) ---
  const modals = (
    <>
      {stockModal && <StockAdjustModal product={stockModal} onClose={() => setStockModal(null)} onDone={() => { setStockModal(null); onReload() }} />}
      {priceModal && <PriceAdjustModal product={priceModal} onClose={() => setPriceModal(null)} onDone={() => { setPriceModal(null); onReload() }} />}
      {bulkPriceModal && <BulkPriceAdjustModal category={bulkPriceModal} onClose={() => setBulkPriceModal(null)} onDone={() => { setBulkPriceModal(null); onReload() }} />}
      {historyModal && <PriceHistoryModal product={historyModal} onClose={() => setHistoryModal(null)} />}
      {colorModal && <ColorPickerInline category={colorModal} onClose={() => setColorModal(null)} onDone={() => { setColorModal(null); onReload() }} />}
      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.type === 'product' ? 'Eliminar producto' : 'Eliminar categoria'}
        message={confirmDelete?.type === 'product'
          ? `Seguro que queres eliminar "${(confirmDelete?.item as Product)?.name}"?`
          : `Seguro que queres eliminar "${(confirmDelete?.item as CategoryTreeNode)?.name}"?`}
        confirmLabel="Eliminar"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )

  // --- Render menu items based on type ---

  const renderContent = () => {
    if (menu.type === 'category') {
      const cat = menu.item as CategoryTreeNode
      const expanded = isExpanded(cat.id)

      if (renaming) {
        return (
          <div className="px-2 py-1">
            <input
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename(cat)
                if (e.key === 'Escape') onClose()
              }}
              placeholder="Nuevo nombre..."
            />
            <div className="flex justify-end gap-1 mt-1.5">
              <button onClick={onClose} className="text-xs text-gray-400 px-2 py-1">Cancelar</button>
              <button
                onClick={() => handleRename(cat)}
                disabled={renameSaving || !renameValue.trim()}
                className="text-xs bg-blue-600 text-white px-2 py-1 rounded disabled:opacity-50"
              >
                {renameSaving ? '...' : 'Guardar'}
              </button>
            </div>
          </div>
        )
      }

      return (
        <>
          <MenuItem icon={icons.addSub} label="Agregar subcategoria" onClick={() => closeAndDo(() => onAddSubcategory(cat.id))} />
          <MenuItem icon={icons.addProduct} label="Agregar producto" onClick={() => closeAndDo(() => onAddProduct(cat.id))} />
          <MenuSeparator />
          <MenuItem icon={icons.rename} label="Renombrar" onClick={() => { setRenameValue(cat.name); setRenaming(true) }} />
          <MenuItem icon={icons.color} label="Cambiar color" onClick={() => { onClose(); setColorModal(cat) }} />
          <MenuSeparator />
          <MenuItem icon={icons.move} label="Mover todos los productos a..." hasSubmenu>
            <button
              onClick={() => handleMoveAllProducts(cat, null)}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Sin categoria
            </button>
            {flatCats.filter(c => c.id !== cat.id).map(c => (
              <button
                key={c.id}
                onClick={() => handleMoveAllProducts(cat, c.id)}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {c.name}
              </button>
            ))}
          </MenuItem>
          <MenuItem icon={icons.price} label="Ajustar precio masivo (%)" onClick={() => { onClose(); setBulkPriceModal(cat) }} />
          <MenuSeparator />
          <MenuItem
            icon={expanded ? icons.collapse : icons.expand}
            label={expanded ? 'Colapsar' : 'Expandir'}
            onClick={() => closeAndDo(() => onToggleExpand(cat.id))}
          />
          <MenuSeparator />
          <MenuItem icon={icons.trash} label="Eliminar" danger onClick={() => { onClose(); setConfirmDelete({ type: 'category', item: cat }) }} />
        </>
      )
    }

    if (menu.type === 'product') {
      const product = menu.item as Product
      return (
        <>
          <MenuItem icon={icons.edit} label="Editar" onClick={() => closeAndDo(() => onEdit(product))} />
          <MenuItem icon={icons.duplicate} label="Duplicar" onClick={() => handleDuplicate(product)} />
          <MenuSeparator />
          <MenuItem icon={icons.move} label="Mover a categoria..." hasSubmenu>
            <button
              onClick={() => handleMoveProduct(product, null)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${!product.category_id ? 'font-bold text-blue-600' : 'text-gray-700 dark:text-gray-200'}`}
            >
              Sin categoria
            </button>
            {flatCats.map(c => (
              <button
                key={c.id}
                onClick={() => handleMoveProduct(product, c.id)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${product.category_id === c.id ? 'font-bold text-blue-600' : 'text-gray-700 dark:text-gray-200'}`}
              >
                {c.name}
              </button>
            ))}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={icons.stock} label="Ajustar stock" onClick={() => { onClose(); setStockModal(product) }} />
          <MenuItem icon={icons.price} label="Ajustar precio" onClick={() => { onClose(); setPriceModal(product) }} />
          <MenuItem icon={icons.history} label="Ver historial de precios" onClick={() => { onClose(); setHistoryModal(product) }} />
          <MenuSeparator />
          <MenuItem icon={icons.trash} label="Eliminar" danger onClick={() => { onClose(); setConfirmDelete({ type: 'product', item: product }) }} />
        </>
      )
    }

    // Empty space / "Sin categoria"
    return (
      <>
        <MenuItem icon={icons.addSub} label="Nueva categoria raiz" onClick={() => closeAndDo(() => onAddSubcategory(''))} />
        <MenuItem icon={icons.addProduct} label="Nuevo producto" onClick={() => closeAndDo(() => onAddProduct())} />
      </>
    )
  }

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1.5 px-1 min-w-[200px] animate-in fade-in duration-150"
          style={{ left: position.x, top: position.y }}
          onContextMenu={e => e.preventDefault()}
        >
          {renderContent()}
        </div>,
        document.body
      )}
      {modals}
    </>
  )
}

// --- Helper ---

function flattenCategories(cats: CategoryTreeNode[]): CategoryTreeNode[] {
  const result: CategoryTreeNode[] = []
  for (const cat of cats) {
    result.push(cat)
    if (cat.children.length > 0) {
      result.push(...flattenCategories(cat.children))
    }
  }
  return result
}

export type { ContextMenuState }
