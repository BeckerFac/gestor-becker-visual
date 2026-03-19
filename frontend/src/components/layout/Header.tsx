import React from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useTheme } from '@/hooks/useTheme'

const pageNames: Record<string, { label: string; section?: string }> = {
  '/dashboard': { label: 'Dashboard' },
  '/orders': { label: 'Pedidos', section: 'Comercial' },
  '/quotes': { label: 'Cotizaciones', section: 'Comercial' },
  '/invoices': { label: 'Facturas', section: 'Comercial' },
  '/remitos': { label: 'Remitos', section: 'Comercial' },
  '/compras': { label: 'Compras', section: 'Abastecimiento' },
  '/products': { label: 'Productos', section: 'Abastecimiento' },
  '/inventory': { label: 'Inventario', section: 'Abastecimiento' },
  '/cobros': { label: 'Cobros', section: 'Finanzas' },
  '/pagos': { label: 'Pagos', section: 'Finanzas' },
  '/cuenta-corriente': { label: 'Cuenta Corriente', section: 'Finanzas' },
  '/cheques': { label: 'Cheques', section: 'Finanzas' },
  '/reportes': { label: 'Reportes', section: 'Finanzas' },
  '/empresas': { label: 'Empresas', section: 'Directorio' },
  '/bancos': { label: 'Bancos', section: 'Directorio' },
  '/customers': { label: 'Clientes', section: 'Directorio' },
  '/settings': { label: 'Configuración' },
}

export const Header: React.FC = () => {
  const location = useLocation()
  const company = useAuthStore((state) => state.company)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const { isDark, toggle: toggleTheme } = useTheme()
  const page = pageNames[location.pathname]
  const pageName = page?.label || location.pathname.replace(/^\//, '').replace(/-/g, ' ') || 'Pagina'
  const section = page?.section

  return (
    <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
          <button
            onClick={toggleSidebar}
            className="md:hidden p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Abrir menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        <div>
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-sm">
            <Link to="/dashboard" className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Inicio</Link>
            {section && (
              <>
                <span className="text-gray-300 dark:text-gray-600">/</span>
                <span className="text-gray-400 dark:text-gray-500">{section}</span>
              </>
            )}
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <span className="text-gray-700 dark:text-gray-200 font-medium">{pageName}</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-0.5 truncate">{pageName}</h2>
        </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
            title={isDark ? 'Modo claro' : 'Modo oscuro'}
          >
            {isDark ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          {company && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{company.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">CUIT: {company.cuit}</p>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
