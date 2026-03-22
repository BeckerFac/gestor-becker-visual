import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

const AUTO_DISMISS_MS = 30_000

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (registration) {
        // Check for updates every 60 minutes
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error)
    },
  })

  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (needRefresh) {
      setVisible(true)
      // Auto-update after 3 seconds — don't wait for user action
      const autoUpdate = setTimeout(() => {
        updateServiceWorker(true)
      }, 3000)
      return () => clearTimeout(autoUpdate)
    }
  }, [needRefresh, updateServiceWorker])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-[#0A0A0F] px-4 py-3 shadow-lg shadow-blue-500/10">
      <RefreshCw className="h-5 w-5 text-blue-400 animate-spin" />
      <span className="text-sm text-gray-200">Nueva version disponible</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
      >
        Actualizar
      </button>
      <button
        onClick={() => {
          setVisible(false)
          setNeedRefresh(false)
        }}
        className="text-gray-500 hover:text-gray-300 transition-colors"
        aria-label="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
