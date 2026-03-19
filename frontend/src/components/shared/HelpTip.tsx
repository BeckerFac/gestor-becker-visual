import React, { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

interface HelpTipProps {
  text: string
}

interface TooltipPos {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

const TOOLTIP_WIDTH = 280
const ARROW_OFFSET = 8
const VIEWPORT_PADDING = 12

export const HelpTip: React.FC<HelpTipProps> = ({ text }) => {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState<TooltipPos | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const tooltipHeight = tooltipRef.current?.offsetHeight ?? 60

    // Center horizontally on the trigger icon
    let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2

    // Clamp to viewport bounds
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING
    if (left + TOOLTIP_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
      left = window.innerWidth - VIEWPORT_PADDING - TOOLTIP_WIDTH
    }

    // Prefer placing above; fall back to below if not enough room
    const spaceAbove = rect.top
    const placement = spaceAbove < tooltipHeight + ARROW_OFFSET ? 'bottom' : 'top'

    const top =
      placement === 'top'
        ? rect.top - tooltipHeight - ARROW_OFFSET
        : rect.bottom + ARROW_OFFSET

    setCoords({ top, left, placement })
  }, [])

  useLayoutEffect(() => {
    if (visible) {
      updatePosition()
    }
  }, [visible, updatePosition])

  const show = useCallback(() => setVisible(true), [])
  const hide = useCallback(() => setVisible(false), [])
  const toggle = useCallback(() => setVisible(v => !v), [])

  // Calculate arrow left offset relative to tooltip, pointing at trigger center
  const arrowLeft = (() => {
    if (!coords || !triggerRef.current) return TOOLTIP_WIDTH / 2
    const rect = triggerRef.current.getBoundingClientRect()
    const triggerCenter = rect.left + rect.width / 2
    return Math.max(12, Math.min(TOOLTIP_WIDTH - 12, triggerCenter - coords.left))
  })()

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center ml-1 cursor-help"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={toggle}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 20 20"
        fill="none"
        className="text-gray-400 hover:text-gray-500 transition-colors flex-shrink-0"
      >
        <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 7.5C8 6.4 8.9 5.5 10 5.5C11.1 5.5 12 6.4 12 7.5C12 8.3 11.5 9 10.8 9.3C10.3 9.5 10 10 10 10.5V11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
      </svg>
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: TOOLTIP_WIDTH,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
            className="px-3 py-2 text-[13px] leading-snug rounded-lg shadow-lg whitespace-normal
              bg-gray-800 text-gray-100 dark:bg-gray-200 dark:text-gray-800
              animate-fadeIn"
          >
            {/* Arrow */}
            <span
              style={{ left: arrowLeft }}
              className={`absolute -translate-x-1/2 w-2 h-2 rotate-45
                bg-gray-800 dark:bg-gray-200
                ${coords?.placement === 'top' ? '-bottom-1' : '-top-1'}`}
            />
            {text}
          </div>,
          document.body
        )}
    </span>
  )
}
