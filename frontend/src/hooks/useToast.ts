import { useState, useCallback } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
}

let globalAddToast: ((type: ToastType, message: string) => void) | null = null

export const toast = {
  success: (message: string) => globalAddToast?.('success', message),
  error: (message: string) => globalAddToast?.('error', message),
  warning: (message: string) => globalAddToast?.('warning', message),
  info: (message: string) => globalAddToast?.('info', message),
}

export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Register global handler
  globalAddToast = addToast

  return { toasts, removeToast }
}
