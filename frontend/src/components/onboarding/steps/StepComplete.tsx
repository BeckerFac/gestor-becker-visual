import React, { useState, useEffect } from 'react'

interface StepCompleteProps {
  companyName: string
  modulesCount: number
  productsCount: number
  hasCustomer: boolean
  onFinish: (destination: 'invoices' | 'dashboard' | 'explore') => void
}

export const StepComplete: React.FC<StepCompleteProps> = ({
  companyName,
  modulesCount,
  productsCount,
  hasCustomer,
  onFinish,
}) => {
  const [showCheck, setShowCheck] = useState(false)
  const [showContent, setShowContent] = useState(false)

  useEffect(() => {
    // Staggered animation
    const t1 = setTimeout(() => setShowCheck(true), 100)
    const t2 = setTimeout(() => setShowContent(true), 600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <div className="text-center py-4 space-y-6">
      {/* Checkmark animation */}
      <div className="flex justify-center">
        <div
          className={`w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center transition-all duration-500 ${
            showCheck ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
          }`}
        >
          <svg
            className={`w-10 h-10 text-green-500 transition-all duration-500 delay-200 ${
              showCheck ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
              className="check-path"
              style={{
                strokeDasharray: 24,
                strokeDashoffset: showCheck ? 0 : 24,
                transition: 'stroke-dashoffset 0.5s ease-in-out 0.3s',
              }}
            />
          </svg>
        </div>
      </div>

      {/* Title */}
      <div
        className={`transition-all duration-500 ${
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Tu empresa esta configurada!
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Configuramos todo para que puedas empezar a trabajar
        </p>
      </div>

      {/* Summary */}
      <div
        className={`transition-all duration-500 delay-100 ${
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 max-w-sm mx-auto space-y-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Empresa</span>
            <span className="font-medium text-gray-900 dark:text-white truncate ml-2">{companyName || 'Configurada'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Modulos activos</span>
            <span className="font-medium text-gray-900 dark:text-white">{modulesCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Productos</span>
            <span className="font-medium text-gray-900 dark:text-white">{productsCount > 0 ? `${productsCount} cargado${productsCount > 1 ? 's' : ''}` : 'Pendiente'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Clientes</span>
            <span className="font-medium text-gray-900 dark:text-white">{hasCustomer ? '1 cargado' : 'Pendiente'}</span>
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div
        className={`space-y-3 transition-all duration-500 delay-200 ${
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <button
          onClick={() => onFinish('invoices')}
          className="w-full max-w-sm mx-auto block px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors text-sm"
        >
          Crear mi primera factura
        </button>
        <button
          onClick={() => onFinish('dashboard')}
          className="w-full max-w-sm mx-auto block px-6 py-2.5 text-gray-600 dark:text-gray-300 font-medium hover:text-gray-900 dark:hover:text-white transition-colors text-sm"
        >
          Ir al dashboard
        </button>
        <button
          onClick={() => onFinish('explore')}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Explorar el sistema
        </button>
      </div>
    </div>
  )
}
