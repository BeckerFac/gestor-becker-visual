import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { exportMultiSheetExcel } from '@/components/shared/ExportExcel'
import { PlanBadge } from '@/components/billing/PlanBadge'
import { BusinessUnitSelector } from '@/components/ui/BusinessUnitSelector'
import { useBilling } from '@/hooks/useBilling'
import type { FeatureKey } from '@/hooks/useBilling'

/*
 * Estructura basada en principios de psicologia cognitiva:
 *
 * 1. Efecto de primacia -> Dashboard arriba (punto de entrada natural)
 * 2. Chunking (Miller) -> Grupos de 3-4 items para no exceder 7+-2
 * 3. Modelo mental del usuario -> Flujo: Vender -> Comprar -> Cobrar/Pagar -> Verificar
 * 4. Ley de proximidad (Gestalt) -> Separadores visuales entre categorias
 * 5. Efecto Von Restorff -> Finanzas resalta como bloque central (mayor interaccion)
 * 6. Efecto de recencia -> Configuracion y Portal al final (baja frecuencia)
 */

interface NavItem {
  href: string
  label: string
  icon: string
  module?: string
  premiumFeature?: FeatureKey  // If set, shows lock icon when feature is not available
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: '',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: '📊' },
      { href: '/global', label: 'Busqueda Global', icon: '🔍' },
      { href: '/secretaria', label: 'SecretarIA', icon: 'whatsapp', premiumFeature: 'secretaria' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { href: '/orders', label: 'Pedidos', icon: '📋', module: 'orders' },
      { href: '/quotes', label: 'Cotizaciones', icon: '📄', module: 'quotes' },
      { href: '/invoices', label: 'Facturas', icon: '🧾', module: 'invoices' },
      { href: '/remitos', label: 'Remitos', icon: '🚚', module: 'remitos' },
      { href: '/oportunidades', label: 'Oportunidades', icon: '🎯', module: 'crm', premiumFeature: 'crm' },
    ],
  },
  {
    label: 'Abastecimiento',
    items: [
      { href: '/compras', label: 'Compras', icon: '🛒', module: 'purchases' },
      { href: '/products', label: 'Productos', icon: '📦', module: 'products' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/cobros', label: 'Recibos', icon: '💰', module: 'cobros' },
      { href: '/pagos', label: 'Ordenes de Pago', icon: '💸', module: 'pagos' },
      { href: '/retenciones', label: 'Retenciones', icon: '📎', module: 'retenciones' },
      { href: '/cuenta-corriente', label: 'Cuenta Corriente', icon: '📒', module: 'cuenta_corriente' },
      { href: '/cheques', label: 'Cheques', icon: '📝', module: 'cheques' },
      { href: '/conciliacion', label: 'Conciliacion', icon: '🏦', module: 'cobros' },
      { href: '/contabilidad', label: 'Contabilidad', icon: '📕', module: 'accounting' },
      { href: '/reportes', label: 'Reportes', icon: '📈', module: 'reports' },
    ],
  },
  {
    label: 'Directorio',
    items: [
      { href: '/empresas', label: 'Empresas', icon: '🏢', module: 'enterprises' },
      { href: '/bancos', label: 'Bancos', icon: '🏦', module: 'banks' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/users', label: 'Usuarios', icon: '👤', module: 'users' },
      { href: '/activity', label: 'Actividad', icon: '📋', module: 'audit_log' },
      { href: '/settings', label: 'Configuración', icon: '⚙️', module: 'settings' },
    ],
  },
]

// Map from sidebar module keys to enabled_modules keys
// Some sidebar module names differ from enabled_modules keys
const MODULE_KEY_MAP: Record<string, string> = {
  'reports': 'reports',
  'cuenta_corriente': 'cobros', // cuenta corriente shows if cobros is enabled
  'retenciones': 'pagos', // retenciones shows if pagos is enabled
  'accounting': 'accounting', // contabilidad module
  'settings': 'settings', // always visible
  'users': 'users', // always visible
}

export const Sidebar: React.FC = () => {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const canAny = useAuthStore((state) => state.canAny)
  const isModuleEnabled = useAuthStore((state) => state.isModuleEnabled)
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen)

  const [exporting, setExporting] = useState(false)
  const [billingInfo, setBillingInfo] = useState<{ plan: string; status: string; days_remaining: number | null } | null>(null)
  const { hasFeature } = useBilling()

  useEffect(() => {
    api.getBillingSubscription()
      .then((data: any) => setBillingInfo({ plan: data.plan, status: data.status, days_remaining: data.days_remaining }))
      .catch(() => { /* billing not available yet */ })
  }, [])

  const handleLogout = () => {
    clearAuth()
    window.location.href = '/'
  }

  const handleExportAll = async () => {
    try {
      setExporting(true)
      const result = await api.exportCompanyData()
      const d = result.data
      const dateStr = new Date().toISOString().split('T')[0]

      const genericCols = (rows: Record<string, any>[]) => {
        if (rows.length === 0) return []
        return Object.keys(rows[0])
          .filter(k => k !== 'company_id')
          .map(k => ({ header: k, key: k, width: 18 }))
      }

      exportMultiSheetExcel(
        [
          { name: 'Pedidos', data: d.pedidos, columns: genericCols(d.pedidos) },
          { name: 'Clientes', data: d.clientes, columns: genericCols(d.clientes) },
          { name: 'Empresas', data: d.empresas, columns: genericCols(d.empresas) },
          { name: 'Productos', data: d.productos, columns: genericCols(d.productos) },
          { name: 'Facturas', data: d.facturas, columns: genericCols(d.facturas) },
          { name: 'Cotizaciones', data: d.cotizaciones, columns: genericCols(d.cotizaciones) },
          { name: 'Cheques', data: d.cheques, columns: genericCols(d.cheques) },
          { name: 'Recibos', data: d.cobros, columns: genericCols(d.cobros) },
          { name: 'Inventario', data: d.inventario, columns: genericCols(d.inventario) },
          { name: 'Compras', data: d.compras, columns: genericCols(d.compras) },
        ].filter(s => s.data.length > 0),
        `export_completo_${dateStr}`
      )
    } catch (e: any) {
      toast.error('Error al exportar: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 768) setSidebarOpen(false)
  }

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    <div className={cn(
      'bg-gray-900 dark:bg-gray-950 text-white flex flex-col z-40 transition-transform duration-200',
      'fixed md:static inset-y-0 left-0 w-64',
      sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
    )}>
      {/* Logo */}
      <div className="px-6 py-4 border-b border-gray-700 dark:border-gray-800">
        <h1 className="text-xl font-bold">BeckerVisual</h1>
        <p className="text-xs text-gray-400">Gestor Comercial</p>
      </div>

      {/* Business Unit Selector */}
      <BusinessUnitSelector className="py-3 border-b border-gray-700 dark:border-gray-800" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navSections.map((section, sIdx) => {
          const visibleItems = section.items.filter(item => {
            // Permission check
            if (item.module && !canAny(item.module)) return false
            // Module enabled check (skip for system items without module, and for settings/users)
            if (item.module && item.module !== 'settings' && item.module !== 'users') {
              const enabledKey = MODULE_KEY_MAP[item.module] || item.module
              if (!isModuleEnabled(enabledKey)) return false
            }
            return true
          })
          if (visibleItems.length === 0) return null

          return (
            <div key={sIdx} className={sIdx > 0 ? 'mt-1' : ''}>
              {section.label && (
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  {section.label}
                </p>
              )}
              {visibleItems.map((item) => {
                const isLocked = item.premiumFeature ? !hasFeature(item.premiumFeature) : false
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={handleNavClick}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5',
                      (location.pathname + location.search) === item.href || location.pathname === item.href
                        ? 'bg-blue-600 text-white'
                        : isLocked
                          ? 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    )}
                  >
                    {item.icon === 'whatsapp' ? (
                      <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                    ) : (
                      <span className="text-base leading-none">{item.icon}</span>
                    )}
                    {item.label}
                    {isLocked && (
                      <svg className="w-3.5 h-3.5 ml-auto text-gray-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}

        {/* Superadmin section */}
        {user?.is_superadmin && (
          <div className="mt-1">
            <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
              Administracion
            </p>
            <Link
              to="/admin"
              onClick={handleNavClick}
              className={cn(
                'flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5',
                location.pathname === '/admin'
                  ? 'bg-purple-600 text-white'
                  : 'text-purple-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Panel Superadmin
            </Link>
          </div>
        )}

        {/* Portal link */}
        <div className="mt-2 pt-2 border-t border-gray-700">
          <Link
            to="/portal-config"
            onClick={handleNavClick}
            className={cn(
              'flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              location.pathname === '/portal-config'
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            )}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
            Portal Clientes
          </Link>
          <button
            onClick={handleExportAll}
            disabled={exporting}
            className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors w-full mt-0.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {exporting ? 'Exportando...' : 'Exportar Datos'}
          </button>
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-gray-700 px-3 py-4">
        {billingInfo && (
          <a href="/settings" className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-800 transition-colors cursor-pointer" title="Ver plan y facturacion">
            <PlanBadge plan={billingInfo.plan} status={billingInfo.status} />
            {billingInfo.status === 'trial' && billingInfo.days_remaining !== null && (
              <span className="text-[10px] text-gray-400">
                {billingInfo.days_remaining}d restantes
              </span>
            )}
          </a>
        )}
        {user && (
          <div className="mb-4">
            <p className="text-xs text-gray-400">Sesion iniciada como</p>
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
    </>
  )
}
