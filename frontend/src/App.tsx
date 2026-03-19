import React, { useEffect, useState, useCallback } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import { AppShell } from '@/components/layout/AppShell'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Products } from '@/pages/Products'
import { Customers } from '@/pages/Customers'
import { Invoices } from '@/pages/Invoices'
import { Inventory } from '@/pages/Inventory'
import { Settings } from '@/pages/Settings'
import { Orders } from '@/pages/Orders'
import { Quotes } from '@/pages/Quotes'
import { CustomerPortal } from '@/pages/CustomerPortal'
import { Cheques } from '@/pages/Cheques'
import { Remitos } from '@/pages/Remitos'
import { Banks } from '@/pages/Banks'
import { Enterprises } from '@/pages/Enterprises'
import { Purchases } from '@/pages/Purchases'
import { Cobros } from '@/pages/Cobros'
import { Pagos } from '@/pages/Pagos'
import { CuentaCorriente } from '@/pages/CuentaCorriente'
import { Users } from '@/pages/Users'
import { Global } from '@/pages/Global'
import { Reportes } from '@/pages/Reportes'
import { UnauthorizedPage } from '@/components/shared/UnauthorizedPage'
import { ToastContainer } from '@/components/ui/Toast'
import { PWAUpdatePrompt } from '@/components/shared/PWAUpdatePrompt'
import { PWAInstallPrompt } from '@/components/shared/PWAInstallPrompt'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

// Error Boundary to catch and display React render errors
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h1 style={{ color: 'red' }}>Error en la aplicacion</h1>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>
            {this.state.error?.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 12, color: '#666' }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { localStorage.clear(); window.location.href = '/' }}
            style={{ marginTop: 20, padding: '8px 16px', cursor: 'pointer' }}
          >
            Limpiar sesion y recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface ProtectedRouteProps {
  children: React.ReactNode
  module?: string
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, module }) => {
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)
  const canAny = useAuthStore((state) => state.canAny)

  if (!user || !accessToken) {
    return <Navigate to="/" replace />
  }

  if (module && !canAny(module)) {
    return <AppShell><UnauthorizedPage /></AppShell>
  }

  return <AppShell>{children}</AppShell>
}

function App() {
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const onboardingCompleted = useAuthStore((state) => state.onboardingCompleted)
  const setOnboardingCompleted = useAuthStore((state) => state.setOnboardingCompleted)
  const setEnabledModules = useAuthStore((state) => state.setEnabledModules)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Validate token on app start - if token exists but is invalid, clear auth
  // Also fetch onboarding status and enabled_modules
  useEffect(() => {
    if (accessToken && user) {
      api.getMe().then((meData) => {
        // Update onboarding and modules from server
        if (meData.onboarding_completed !== undefined) {
          setOnboardingCompleted(meData.onboarding_completed)
          if (!meData.onboarding_completed) {
            setShowOnboarding(true)
          }
        }
        if (meData.enabled_modules) {
          setEnabledModules(meData.enabled_modules)
        }
      }).catch(() => {
        clearAuth()
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Show onboarding when user is logged in but hasn't completed it
  useEffect(() => {
    if (user && accessToken && !onboardingCompleted) {
      setShowOnboarding(true)
    }
  }, [user, accessToken, onboardingCompleted])

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false)
    setOnboardingCompleted(true)
  }, [setOnboardingCompleted])

  return (
    <ErrorBoundary>
    <Router>
      <ToastContainer />
      <PWAUpdatePrompt />
      <PWAInstallPrompt />

      {/* Onboarding Wizard overlay */}
      {showOnboarding && user && accessToken && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}

      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/global" element={<ProtectedRoute><Global /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute module="products"><Products /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
        <Route path="/empresas" element={<ProtectedRoute module="enterprises"><Enterprises /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute module="orders"><Orders /></ProtectedRoute>} />
        <Route path="/compras" element={<ProtectedRoute module="purchases"><Purchases /></ProtectedRoute>} />
        <Route path="/quotes" element={<ProtectedRoute module="quotes"><Quotes /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute module="invoices"><Invoices /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
        <Route path="/cobros" element={<ProtectedRoute module="cobros"><Cobros /></ProtectedRoute>} />
        <Route path="/pagos" element={<ProtectedRoute module="pagos"><Pagos /></ProtectedRoute>} />
        <Route path="/cuenta-corriente" element={<ProtectedRoute module="cuenta_corriente"><CuentaCorriente /></ProtectedRoute>} />
        <Route path="/cheques" element={<ProtectedRoute module="cheques"><Cheques /></ProtectedRoute>} />
        <Route path="/reportes" element={<ProtectedRoute module="reports"><Reportes /></ProtectedRoute>} />
        <Route path="/remitos" element={<ProtectedRoute module="remitos"><Remitos /></ProtectedRoute>} />
        <Route path="/bancos" element={<ProtectedRoute module="banks"><Banks /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute module="users"><Users /></ProtectedRoute>} />

        {/* Customer Portal - standalone, no admin auth required */}
        <Route path="/portal" element={<CustomerPortal />} />

        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
      </Routes>
    </Router>
    </ErrorBoundary>
  )
}

export default App
