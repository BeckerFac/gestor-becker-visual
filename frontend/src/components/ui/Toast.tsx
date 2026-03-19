import React from 'react'
import { useToastState, type Toast as ToastItem } from '@/hooks/useToast'

const typeStyles: Record<ToastItem['type'], { bg: string; icon: string }> = {
  success: { bg: 'bg-green-50 dark:bg-green-900/40 border-green-200 dark:border-green-700 text-green-800 dark:text-green-200', icon: 'M5 13l4 4L19 7' },
  error: { bg: 'bg-red-50 dark:bg-red-900/40 border-red-200 dark:border-red-700 text-red-800 dark:text-red-200', icon: 'M6 18L18 6M6 6l12 12' },
  warning: { bg: 'bg-yellow-50 dark:bg-yellow-900/40 border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200', icon: 'M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z' },
  info: { bg: 'bg-blue-50 dark:bg-blue-900/40 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-200', icon: 'M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z' },
}

const ToastItem: React.FC<{ toast: ToastItem; onClose: () => void }> = ({ toast, onClose }) => {
  const style = typeStyles[toast.type]
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-in ${style.bg}`}
      role="alert"
    >
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={style.icon} />
      </svg>
      <p className="text-sm font-medium flex-1">{toast.message}</p>
      <button onClick={onClose} className="flex-shrink-0 ml-2 opacity-60 hover:opacity-100" aria-label="Cerrar notificacion">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastState()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onClose={() => removeToast(t.id)} />
        </div>
      ))}
    </div>
  )
}
