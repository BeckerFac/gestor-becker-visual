import React from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

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
  '/empresas': { label: 'Empresas', section: 'Directorio' },
  '/bancos': { label: 'Bancos', section: 'Directorio' },
  '/customers': { label: 'Clientes', section: 'Directorio' },
  '/settings': { label: 'Configuración' },
}

export const Header: React.FC = () => {
  const location = useLocation()
  const company = useAuthStore((state) => state.company)
  const page = pageNames[location.pathname]
  const pageName = page?.label || 'Página'
  const section = page?.section

  return (
    <header className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-sm">
            <Link to="/dashboard" className="text-gray-400 hover:text-blue-600 transition-colors">Inicio</Link>
            {section && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-gray-400">{section}</span>
              </>
            )}
            <span className="text-gray-300">/</span>
            <span className="text-gray-700 font-medium">{pageName}</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mt-0.5 truncate">{pageName}</h2>
        </div>
        {company && (
          <div className="text-right">
            <p className="text-sm font-medium text-gray-700">{company.name}</p>
            <p className="text-xs text-gray-500">CUIT: {company.cuit}</p>
          </div>
        )}
      </div>
    </header>
  )
}
