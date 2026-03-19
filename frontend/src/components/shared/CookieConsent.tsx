import React, { useState, useEffect } from 'react'

const CONSENT_KEY = 'cookie_consent'

export const CookieConsent: React.FC = () => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY)
    if (!consent) {
      setVisible(true)
    }
  }, [])

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, 'accepted')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg px-4 py-3">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Usamos cookies esenciales para el funcionamiento de la plataforma y para mejorar tu experiencia.
          Consulta nuestra{' '}
          <a
            href="/legal/privacidad"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            Politica de Privacidad
          </a>{' '}
          para mas informacion.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/legal/privacidad"
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            Mas info
          </a>
          <button
            onClick={handleAccept}
            className="px-6 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  )
}
