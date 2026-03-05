import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

/*
 * Estructura basada en principios de psicología cognitiva:
 *
 * 1. Efecto de primacía → Dashboard arriba (punto de entrada natural)
 * 2. Chunking (Miller) → Grupos de 3-4 items para no exceder 7±2
 * 3. Modelo mental del usuario → Flujo: Vender → Comprar → Cobrar/Pagar → Verificar
 * 4. Ley de proximidad (Gestalt) → Separadores visuales entre categorías
 * 5. Efecto Von Restorff → Finanzas resalta como bloque central (mayor interacción)
 * 6. Efecto de recencia → Configuración y Portal al final (baja frecuencia)
 */

interface NavSection {
  label: string
  items: { href: string; label: string; icon: string }[]
}

const navSections: NavSection[] = [
  {
    label: '',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { href: '/orders', label: 'Pedidos', icon: '📋' },
      { href: '/quotes', label: 'Cotizaciones', icon: '📄' },
      { href: '/invoices', label: 'Facturas', icon: '🧾' },
      { href: '/remitos', label: 'Remitos', icon: '🚚' },
    ],
  },
  {
    label: 'Abastecimiento',
    items: [
      { href: '/compras', label: 'Compras', icon: '🛒' },
      { href: '/products', label: 'Productos', icon: '📦' },
      { href: '/inventory', label: 'Inventario', icon: '🏭' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/cobros', label: 'Cobros', icon: '💰' },
      { href: '/pagos', label: 'Pagos', icon: '💸' },
      { href: '/cuenta-corriente', label: 'Cuenta Corriente', icon: '📒' },
      { href: '/cheques', label: 'Cheques', icon: '📝' },
    ],
  },
  {
    label: 'Directorio',
    items: [
      { href: '/empresas', label: 'Empresas', icon: '🏢' },
      { href: '/bancos', label: 'Bancos', icon: '🏦' },
    ],
  },
  {
    label: '',
    items: [
      { href: '/settings', label: 'Configuración', icon: '⚙️' },
    ],
  },
]

export const Sidebar: React.FC = () => {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const clearAuth = useAuthStore((state) => state.clearAuth)

  const handleLogout = () => {
    clearAuth()
    window.location.href = '/'
  }

  return (
    <div className="w-64 bg-gray-900 text-white flex flex-col">
      {/* Logo */}
      <div className="px-6 py-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">BeckerVisual</h1>
        <p className="text-xs text-gray-400">Gestor Comercial</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className={sIdx > 0 ? 'mt-1' : ''}>
            {section.label && (
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                {section.label}
              </p>
            )}
            {section.items.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5',
                  location.pathname === item.href
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
              >
                <span className="text-base leading-none">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        {/* Portal link */}
        <div className="mt-2 pt-2 border-t border-gray-700">
          <a
            href="/portal"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <span>🌐</span>
            Portal Clientes
            <span className="text-xs ml-auto opacity-50">↗</span>
          </a>
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-gray-700 px-3 py-4">
        {user && (
          <div className="mb-4">
            <p className="text-xs text-gray-400">Sesión iniciada como</p>
            <p className="text-sm font-medium truncate">{user.email}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors text-white"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
