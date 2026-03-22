import React, { useEffect, useState, useCallback, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import { AppShell } from '@/components/layout/AppShell'
import { Login } from '@/pages/Login'
import { UnauthorizedPage } from '@/components/shared/UnauthorizedPage'
import { ToastContainer } from '@/components/ui/Toast'
import { PWAUpdatePrompt } from '@/components/shared/PWAUpdatePrompt'
import { PWAInstallPrompt } from '@/components/shared/PWAInstallPrompt'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { CookieConsent } from '@/components/shared/CookieConsent'
// TrialBanner removed - trial info shown in sidebar badge only
import { SkeletonPage } from '@/components/ui/Skeleton'

// Lazy-loaded page components for code splitting
const Dashboard = React.lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Products = React.lazy(() => import('@/pages/Products').then(m => ({ default: m.Products })))
const Customers = React.lazy(() => import('@/pages/Customers').then(m => ({ default: m.Customers })))
const Invoices = React.lazy(() => import('@/pages/Invoices').then(m => ({ default: m.Invoices })))
// Inventory route now redirects to /products?tab=movimientos
// const Inventory = React.lazy(() => import('@/pages/Inventory').then(m => ({ default: m.Inventory })))
const Settings = React.lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })))
const Orders = React.lazy(() => import('@/pages/Orders').then(m => ({ default: m.Orders })))
const Quotes = React.lazy(() => import('@/pages/Quotes').then(m => ({ default: m.Quotes })))
const CustomerPortal = React.lazy(() => import('@/pages/CustomerPortal').then(m => ({ default: m.CustomerPortal })))
const Cheques = React.lazy(() => import('@/pages/Cheques').then(m => ({ default: m.Cheques })))
const Remitos = React.lazy(() => import('@/pages/Remitos').then(m => ({ default: m.Remitos })))
const Banks = React.lazy(() => import('@/pages/Banks').then(m => ({ default: m.Banks })))
const Enterprises = React.lazy(() => import('@/pages/Enterprises').then(m => ({ default: m.Enterprises })))
const Purchases = React.lazy(() => import('@/pages/Purchases').then(m => ({ default: m.Purchases })))
const Cobros = React.lazy(() => import('@/pages/Cobros').then(m => ({ default: m.Cobros })))
const Pagos = React.lazy(() => import('@/pages/Pagos').then(m => ({ default: m.Pagos })))
const CuentaCorriente = React.lazy(() => import('@/pages/CuentaCorriente').then(m => ({ default: m.CuentaCorriente })))
const Users = React.lazy(() => import('@/pages/Users').then(m => ({ default: m.Users })))
const Global = React.lazy(() => import('@/pages/Global').then(m => ({ default: m.Global })))
const Reportes = React.lazy(() => import('@/pages/Reportes').then(m => ({ default: m.Reportes })))
const Oportunidades = React.lazy(() => import('@/pages/Oportunidades').then(m => ({ default: m.Oportunidades })))
const SecretarIAPage = React.lazy(() => import('@/pages/SecretarIA'))
const ActivityLog = React.lazy(() => import('@/pages/ActivityLog'))
const Admin = React.lazy(() => import('@/pages/Admin').then(m => ({ default: m.Admin })))
const PortalConfig = React.lazy(() => import('@/pages/PortalConfig').then(m => ({ default: m.PortalConfig })))
const NotFound = React.lazy(() => import('@/pages/NotFound').then(m => ({ default: m.NotFound })))
const LegalTerminos = React.lazy(() => import('@/pages/LegalTerminos').then(m => ({ default: m.LegalTerminos })))
const LegalPrivacidad = React.lazy(() => import('@/pages/LegalPrivacidad').then(m => ({ default: m.LegalPrivacidad })))
const ForgotPassword = React.lazy(() => import('@/pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })))
const ResetPassword = React.lazy(() => import('@/pages/ResetPassword').then(m => ({ default: m.ResetPassword })))
const VerifyEmail = React.lazy(() => import('@/pages/VerifyEmail').then(m => ({ default: m.VerifyEmail })))
const AcceptInvite = React.lazy(() => import('@/pages/AcceptInvite').then(m => ({ default: m.AcceptInvite })))

// Suspense fallback shown while lazy chunks load
const PageLoader: React.FC = () => (
  <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <SkeletonPage />
  </div>
)

// Error Boundary to catch and display React render errors
// Sentry-ready: when @sentry/react is installed, errors are automatically reported
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null; eventId: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null, eventId: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Report to Sentry if available (install @sentry/react when ready)
    try {
      // Dynamic import to avoid build errors when Sentry isn't installed
      const Sentry = (window as any).__SENTRY__;
      if (Sentry?.captureException) {
        const eventId = Sentry.captureException(error, {
          contexts: { react: { componentStack: errorInfo.componentStack } },
        })
        this.setState({ eventId })
      }
    } catch {
      // Sentry not available, silently continue
    }
    console.error('React ErrorBoundary caught:', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
          <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 text-center">
            <div className="text-5xl font-bold text-red-300 dark:text-red-700 mb-4">Error</div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Ocurrio un error inesperado
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-2 text-sm">
              {this.state.error?.message || 'Error desconocido'}
            </p>
            <details className="text-left mb-6">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300">
                Detalles tecnicos
              </summary>
              <pre className="mt-2 text-xs text-gray-400 bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-auto max-h-40">
                {this.state.error?.stack}
              </pre>
            </details>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors min-h-[44px]"
              >
                Recargar pagina
              </button>
              <button
                onClick={() => { localStorage.clear(); window.location.href = '/' }}
                className="px-6 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors min-h-[44px]"
              >
                Limpiar sesion
              </button>
            </div>
          </div>
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

  return (
    <AppShell>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </AppShell>
  )
}

function App() {
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)
  const clearAuth = useAuthStore((state) => state.clearAuth)
  const onboardingCompleted = useAuthStore((state) => state.onboardingCompleted)
  const setOnboardingCompleted = useAuthStore((state) => state.setOnboardingCompleted)
  const setEnabledModules = useAuthStore((state) => state.setEnabledModules)
  const setSubscription = useAuthStore((state) => state.setSubscription)
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
        // Update is_superadmin in stored user
        if (meData.is_superadmin !== undefined && user) {
          const updatedUser = { ...user, is_superadmin: meData.is_superadmin }
          localStorage.setItem('user', JSON.stringify(updatedUser))
          useAuthStore.setState({ user: updatedUser })
        }
        // Update subscription info
        if (meData.subscription_status) {
          setSubscription({
            subscription_status: meData.subscription_status,
            subscription_days_remaining: meData.subscription_days_remaining ?? null,
            subscription_is_read_only: meData.subscription_is_read_only ?? false,
            email_verified: meData.email_verified,
          })
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
      <CookieConsent />

      {/* Onboarding Wizard overlay */}
      {showOnboarding && user && accessToken && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}

      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

        {/* Public auth pages */}
        <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPassword /></Suspense>} />
        <Route path="/reset-password" element={<Suspense fallback={<PageLoader />}><ResetPassword /></Suspense>} />
        <Route path="/verify-email" element={<Suspense fallback={<PageLoader />}><VerifyEmail /></Suspense>} />
        <Route path="/accept-invite" element={<Suspense fallback={<PageLoader />}><AcceptInvite /></Suspense>} />

        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/global" element={<ProtectedRoute><Global /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute module="products"><Products /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
        <Route path="/empresas" element={<ProtectedRoute module="enterprises"><Enterprises /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute module="orders"><Orders /></ProtectedRoute>} />
        <Route path="/compras" element={<ProtectedRoute module="purchases"><Purchases /></ProtectedRoute>} />
        <Route path="/quotes" element={<ProtectedRoute module="quotes"><Quotes /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute module="invoices"><Invoices /></ProtectedRoute>} />
        <Route path="/inventory" element={<Navigate to="/products?tab=movimientos" replace />} />
        <Route path="/cobros" element={<ProtectedRoute module="cobros"><Cobros /></ProtectedRoute>} />
        <Route path="/pagos" element={<ProtectedRoute module="pagos"><Pagos /></ProtectedRoute>} />
        <Route path="/cuenta-corriente" element={<ProtectedRoute module="cuenta_corriente"><CuentaCorriente /></ProtectedRoute>} />
        <Route path="/cheques" element={<ProtectedRoute module="cheques"><Cheques /></ProtectedRoute>} />
        <Route path="/reportes" element={<ProtectedRoute module="reports"><Reportes /></ProtectedRoute>} />
        <Route path="/remitos" element={<ProtectedRoute module="remitos"><Remitos /></ProtectedRoute>} />
        <Route path="/oportunidades" element={<ProtectedRoute module="crm"><Oportunidades /></ProtectedRoute>} />
        <Route path="/secretaria" element={<ProtectedRoute><SecretarIAPage /></ProtectedRoute>} />
        <Route path="/bancos" element={<ProtectedRoute module="banks"><Banks /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
        <Route path="/activity" element={<ProtectedRoute module="audit_log"><ActivityLog /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute module="users"><Users /></ProtectedRoute>} />
        <Route path="/portal-config" element={<ProtectedRoute><PortalConfig /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />

        {/* Legal pages - public, no auth required */}
        <Route path="/legal/terminos" element={<Suspense fallback={<PageLoader />}><LegalTerminos /></Suspense>} />
        <Route path="/legal/privacidad" element={<Suspense fallback={<PageLoader />}><LegalPrivacidad /></Suspense>} />

        {/* Customer Portal - standalone, no admin auth required */}
        <Route path="/portal" element={<Suspense fallback={<PageLoader />}><CustomerPortal /></Suspense>} />

        {/* 404 - Not Found */}
        <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
      </Routes>
    </Router>
    </ErrorBoundary>
  )
}

export default App
