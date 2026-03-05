import React, { useEffect } from 'react'
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

interface ProtectedRouteProps {
  children: React.ReactNode
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)

  if (!user || !accessToken) {
    return <Navigate to="/" replace />
  }

  return <AppShell>{children}</AppShell>
}

function App() {
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)
  const clearAuth = useAuthStore((state) => state.clearAuth)

  // Validate token on app start - if token exists but is invalid, clear auth
  useEffect(() => {
    if (accessToken && user) {
      api.getMe().catch(() => {
        clearAuth()
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Router>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />

        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
        <Route path="/empresas" element={<ProtectedRoute><Enterprises /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
        <Route path="/compras" element={<ProtectedRoute><Purchases /></ProtectedRoute>} />
        <Route path="/quotes" element={<ProtectedRoute><Quotes /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
        <Route path="/cobros" element={<ProtectedRoute><Cobros /></ProtectedRoute>} />
        <Route path="/pagos" element={<ProtectedRoute><Pagos /></ProtectedRoute>} />
        <Route path="/cuenta-corriente" element={<ProtectedRoute><CuentaCorriente /></ProtectedRoute>} />
        <Route path="/cheques" element={<ProtectedRoute><Cheques /></ProtectedRoute>} />
        <Route path="/remitos" element={<ProtectedRoute><Remitos /></ProtectedRoute>} />
        <Route path="/bancos" element={<ProtectedRoute><Banks /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        {/* Customer Portal - standalone, no admin auth required */}
        <Route path="/portal" element={<CustomerPortal />} />

        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
      </Routes>
    </Router>
  )
}

export default App
