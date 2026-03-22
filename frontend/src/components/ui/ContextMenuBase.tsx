import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// --- Types ---

export interface ContextMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  submenu?: ContextMenuItem[]
  onClick?: () => void
}

interface ContextMenuBaseProps {
  x: number
  y: number
  items: ContextMenuItem[]
  header?: { title: string; subtitle?: string }
  onClose: () => void
}

// --- MenuItem Component ---

const MenuItem: React.FC<{
  item: ContextMenuItem
  onClose: () => void
}> = ({ item, onClose }) => {
  const [showSub, setShowSub] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subRef = useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  if (item.separator) {
    return <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
  }

  const hasSubmenu = item.submenu && item.submenu.length > 0

  const handleMouseEnter = () => {
    if (hasSubmenu) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setShowSub(true)
    }
  }

  const handleMouseLeave = () => {
    if (hasSubmenu) {
      timerRef.current = setTimeout(() => setShowSub(false), 150)
    }
  }

  const handleClick = () => {
    if (item.disabled) return
    if (hasSubmenu) {
      setShowSub(!showSub)
      return
    }
    item.onClick?.()
    onClose()
  }

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button
        type="button"
        onClick={handleClick}
        disabled={item.disabled}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
          item.disabled
            ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
            : item.danger
            ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        {item.icon && <span className="w-4 h-4 flex-shrink-0 opacity-70">{item.icon}</span>}
        <span className="flex-1 truncate">{item.label}</span>
        {item.shortcut && (
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto pl-4">{item.shortcut}</span>
        )}
        {hasSubmenu && (
          <svg className="w-3 h-3 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>

      {/* Submenu */}
      {hasSubmenu && showSub && (
        <div
          ref={subRef}
          className="absolute left-full top-0 ml-1 min-w-[160px] max-h-[300px] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 z-[10000]"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {item.submenu!.map(sub => (
            <MenuItem key={sub.id} item={sub} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main Component ---

export const ContextMenuBase: React.FC<ContextMenuBaseProps> = ({
  x,
  y,
  items,
  header,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  // Viewport clamping
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let newX = x
    let newY = y
    if (x + rect.width > vw - 8) newX = vw - rect.width - 8
    if (y + rect.height > vh - 8) newY = vh - rect.height - 8
    if (newX < 8) newX = 8
    if (newY < 8) newY = 8
    if (newX !== position.x || newY !== position.y) {
      setPosition({ x: newX, y: newY })
    }
  }, [x, y])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Close on scroll
  useEffect(() => {
    const handleScroll = () => onClose()
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [onClose])

  // Don't render on mobile
  if (typeof window !== 'undefined' && window.innerWidth < 768) return null

  return createPortal(
    <div
      ref={menuRef}
      className="fixed min-w-[180px] max-w-[280px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl py-1 z-[9999] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      {header && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{header.title}</p>
          {header.subtitle && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{header.subtitle}</p>
          )}
        </div>
      )}

      {/* Items */}
      {items.map(item => (
        <MenuItem key={item.id} item={item} onClose={onClose} />
      ))}
    </div>,
    document.body
  )
}
