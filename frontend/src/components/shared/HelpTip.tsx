import React, { useState, useRef, useEffect } from 'react'

interface HelpTipProps {
  text: string
}

export const HelpTip: React.FC<HelpTipProps> = ({ text }) => {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<'top' | 'bottom'>('top')
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (visible && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos(rect.top < 100 ? 'bottom' : 'top')
    }
  }, [visible])

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center ml-1 cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
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
      {visible && (
        <span
          className={`absolute z-50 px-3 py-2 text-[13px] leading-snug rounded-lg shadow-lg whitespace-normal pointer-events-none
            bg-gray-800 text-gray-100 dark:bg-gray-200 dark:text-gray-800
            w-[280px] max-w-[280px] left-1/2 -translate-x-1/2
            ${pos === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}
            animate-in fade-in duration-150`}
        >
          <span
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45
              bg-gray-800 dark:bg-gray-200
              ${pos === 'top' ? '-bottom-1' : '-top-1'}`}
          />
          {text}
        </span>
      )}
    </span>
  )
}
