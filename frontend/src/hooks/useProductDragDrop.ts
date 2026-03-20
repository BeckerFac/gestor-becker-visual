import { useCallback, useRef, useState } from 'react'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'

const DRAG_DATA_TYPE = 'application/x-product-ids'
const AUTO_EXPAND_DELAY = 500

interface DragState {
  isDragging: boolean
  draggedProductIds: string[]
  dragSourceCategoryId: string | null
}

interface DropTargetState {
  hoveredCategoryId: string | null
}

interface UseProductDragDropOptions {
  selectedIds: Set<string>
  onReload: () => void
  expandCategory: (categoryId: string) => void
  isCategoryExpanded: (categoryId: string) => boolean
}

export function useProductDragDrop({
  selectedIds,
  onReload,
  expandCategory,
  isCategoryExpanded,
}: UseProductDragDropOptions) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggedProductIds: [],
    dragSourceCategoryId: null,
  })
  const [dropTarget, setDropTarget] = useState<DropTargetState>({
    hoveredCategoryId: null,
  })
  const [moving, setMoving] = useState(false)
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTouchDevice = useRef(
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )

  const clearAutoExpandTimer = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current)
      autoExpandTimerRef.current = null
    }
  }, [])

  // --- Product drag handlers ---

  const handleDragStart = useCallback((
    e: React.DragEvent<HTMLTableRowElement>,
    productId: string,
    productName: string,
    sourceCategoryId: string | null,
  ) => {
    // If the dragged product is part of a selection, drag all selected
    const ids = selectedIds.has(productId) && selectedIds.size > 1
      ? Array.from(selectedIds)
      : [productId]

    e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'

    // Custom drag image
    const ghost = document.createElement('div')
    ghost.className = 'product-drag-ghost'
    ghost.textContent = ids.length > 1
      ? `${ids.length} productos`
      : productName
    ghost.style.cssText = `
      position: absolute; left: -9999px; top: -9999px;
      padding: 6px 12px; border-radius: 6px; font-size: 13px;
      background: #3B82F6; color: white; font-weight: 500;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2); white-space: nowrap;
    `
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    // Clean up ghost after a tick
    requestAnimationFrame(() => {
      setTimeout(() => document.body.removeChild(ghost), 0)
    })

    setDragState({
      isDragging: true,
      draggedProductIds: ids,
      dragSourceCategoryId: sourceCategoryId,
    })
  }, [selectedIds])

  const handleDragEnd = useCallback(() => {
    setDragState({ isDragging: false, draggedProductIds: [], dragSourceCategoryId: null })
    setDropTarget({ hoveredCategoryId: null })
    clearAutoExpandTimer()
  }, [clearAutoExpandTimer])

  // --- Category drop handlers ---

  const handleCategoryDragOver = useCallback((
    e: React.DragEvent,
    categoryId: string | null, // null = uncategorized
  ) => {
    if (!dragState.isDragging) return

    // Same category = no-op visual
    if (categoryId === dragState.dragSourceCategoryId) {
      e.dataTransfer.dropEffect = 'none'
      return
    }

    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const targetId = categoryId ?? '__uncategorized__'
    if (dropTarget.hoveredCategoryId !== targetId) {
      setDropTarget({ hoveredCategoryId: targetId })

      // Auto-expand collapsed category after hovering 500ms
      clearAutoExpandTimer()
      if (categoryId && !isCategoryExpanded(categoryId)) {
        autoExpandTimerRef.current = setTimeout(() => {
          expandCategory(categoryId)
        }, AUTO_EXPAND_DELAY)
      }
    }
  }, [dragState.isDragging, dragState.dragSourceCategoryId, dropTarget.hoveredCategoryId, clearAutoExpandTimer, expandCategory, isCategoryExpanded])

  const handleCategoryDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the element entirely (not entering a child)
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as Node).contains(related)) return
    setDropTarget({ hoveredCategoryId: null })
    clearAutoExpandTimer()
  }, [clearAutoExpandTimer])

  const handleCategoryDrop = useCallback(async (
    e: React.DragEvent,
    targetCategoryId: string | null, // null = uncategorized
  ) => {
    e.preventDefault()
    setDropTarget({ hoveredCategoryId: null })
    clearAutoExpandTimer()

    const raw = e.dataTransfer.getData(DRAG_DATA_TYPE)
    if (!raw) return

    let productIds: string[]
    try {
      productIds = JSON.parse(raw)
    } catch {
      return
    }

    if (!productIds.length) return

    // Same category = no-op
    if (targetCategoryId === dragState.dragSourceCategoryId) return

    setMoving(true)
    try {
      // Move products one by one (API doesn't have batch)
      const results = await Promise.allSettled(
        productIds.map(id =>
          api.updateProduct(id, { category_id: targetCategoryId })
        )
      )

      const failures = results.filter(r => r.status === 'rejected').length
      const successes = productIds.length - failures

      if (successes > 0) {
        const targetName = targetCategoryId ? undefined : 'Sin categoria'
        toast.success(
          successes === 1
            ? `Producto movido${targetName ? ` a ${targetName}` : ''}`
            : `${successes} productos movidos${targetName ? ` a ${targetName}` : ''}`
        )
        onReload()
      }

      if (failures > 0) {
        toast.error(`${failures} producto(s) no se pudieron mover`)
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al mover productos')
    } finally {
      setMoving(false)
      setDragState({ isDragging: false, draggedProductIds: [], dragSourceCategoryId: null })
    }
  }, [dragState.dragSourceCategoryId, clearAutoExpandTimer, onReload])

  // --- Mobile fallback: move via API ---

  const handleMoveToCategory = useCallback(async (
    productId: string,
    targetCategoryId: string | null,
  ) => {
    setMoving(true)
    try {
      await api.updateProduct(productId, { category_id: targetCategoryId })
      toast.success('Producto movido')
      onReload()
    } catch (err: any) {
      toast.error(err.message || 'Error al mover producto')
    } finally {
      setMoving(false)
    }
  }, [onReload])

  const isDropTargetActive = useCallback((categoryId: string | null) => {
    const targetId = categoryId ?? '__uncategorized__'
    return dropTarget.hoveredCategoryId === targetId
  }, [dropTarget.hoveredCategoryId])

  const isDraggedProduct = useCallback((productId: string) => {
    return dragState.draggedProductIds.includes(productId)
  }, [dragState.draggedProductIds])

  return {
    // State
    isDragging: dragState.isDragging,
    moving,
    isTouchDevice: isTouchDevice.current,

    // Product drag
    handleDragStart,
    handleDragEnd,
    isDraggedProduct,

    // Category drop
    handleCategoryDragOver,
    handleCategoryDragLeave,
    handleCategoryDrop,
    isDropTargetActive,

    // Mobile fallback
    handleMoveToCategory,
  }
}
