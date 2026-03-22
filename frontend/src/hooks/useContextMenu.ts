import { useState, useCallback } from 'react'

export interface ContextMenuState<T> {
  x: number
  y: number
  item: T
}

export function useContextMenu<T>() {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null)

  const openMenu = useCallback((e: React.MouseEvent, item: T) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  return { menu, openMenu, closeMenu }
}
