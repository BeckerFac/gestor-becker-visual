import { create } from 'zustand'

export interface User {
  id: string
  email: string
  name: string
  company_id: string
  role: 'owner' | 'admin' | 'gerente' | 'editor' | 'vendedor' | 'contable' | 'viewer'
  is_superadmin?: boolean
  onboarding_completed?: boolean
  enabled_modules?: string[]
}

export interface Company {
  id: string
  name: string
  cuit: string
}

export interface SubscriptionInfo {
  subscription_status: string
  subscription_days_remaining: number | null
  subscription_is_read_only: boolean
  email_verified?: boolean
}

interface AuthStore {
  user: User | null
  company: Company | null
  accessToken: string | null
  refreshToken: string | null
  permissions: Record<string, string[]> | null
  onboardingCompleted: boolean
  enabledModules: string[]
  subscription: SubscriptionInfo | null
  isLoading: boolean
  error: string | null
  setAuth: (user: User, company: Company, accessToken: string, refreshToken: string, permissions?: Record<string, string[]> | null) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  clearAuth: () => void
  setError: (error: string | null) => void
  initSingleCompanyMode: () => void
  can: (module: string, action: string) => boolean
  canAny: (module: string) => boolean
  updatePermissions: (permissions: Record<string, string[]> | null) => void
  setOnboardingCompleted: (completed: boolean) => void
  setEnabledModules: (modules: string[]) => void
  isModuleEnabled: (moduleKey: string) => boolean
  setSubscription: (info: SubscriptionInfo) => void
}

const ALL_MODULES = ['orders','invoices','products','inventory','purchases','cobros','pagos','cheques','enterprises','banks','customers','quotes','remitos','reports','crm']

// Demo credentials for single-company mode
const DEMO_USER: User = {
  id: '10ca88dd-a6cf-4a26-8ad1-9a685969d212',
  email: 'demo@test.com',
  name: 'Usuario Demo',
  role: 'admin',
  company_id: '46bc644d-3094-4330-babe-ecaf52559ca5',
}

const DEMO_COMPANY: Company = {
  id: '46bc644d-3094-4330-babe-ecaf52559ca5',
  name: 'Test Company',
  cuit: '20123456789',
}

// Restore user, company, and permissions from localStorage
const savedUser = localStorage.getItem('user')
const savedCompany = localStorage.getItem('company')
const savedPermissions = localStorage.getItem('permissions')
const savedOnboarding = localStorage.getItem('onboardingCompleted')
const savedModules = localStorage.getItem('enabledModules')
const restoredUser = savedUser ? JSON.parse(savedUser) as User : null
const restoredCompany = savedCompany ? JSON.parse(savedCompany) as Company : null
const restoredPermissions = savedPermissions ? JSON.parse(savedPermissions) as Record<string, string[]> | null : null
const restoredOnboarding = savedOnboarding === 'true'
const restoredModules = savedModules ? JSON.parse(savedModules) as string[] : ALL_MODULES

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: restoredUser,
  company: restoredCompany,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  permissions: restoredPermissions,
  onboardingCompleted: restoredOnboarding,
  enabledModules: restoredModules,
  subscription: null,
  isLoading: false,
  error: null,
  setAuth: (user, company, accessToken, refreshToken, permissions = null) => {
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('company', JSON.stringify(company))
    localStorage.setItem('permissions', JSON.stringify(permissions))
    // Persist onboarding state from user data if available
    if (user.onboarding_completed !== undefined) {
      localStorage.setItem('onboardingCompleted', String(user.onboarding_completed))
    }
    if (user.enabled_modules) {
      localStorage.setItem('enabledModules', JSON.stringify(user.enabled_modules))
    }
    set({
      user, company, accessToken, refreshToken, permissions, error: null,
      onboardingCompleted: user.onboarding_completed ?? false,
      enabledModules: user.enabled_modules ?? ALL_MODULES,
    })
  },
  setTokens: (accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    set({ accessToken, refreshToken })
  },
  clearAuth: () => {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    localStorage.removeItem('company')
    localStorage.removeItem('permissions')
    localStorage.removeItem('onboardingCompleted')
    localStorage.removeItem('enabledModules')
    set({ user: null, company: null, accessToken: null, refreshToken: null, permissions: null, onboardingCompleted: false, enabledModules: ALL_MODULES })
  },
  setError: (error) => set({ error }),
  initSingleCompanyMode: () => {
    // Auto-login with demo credentials for single-company mode
    set({ user: DEMO_USER, company: DEMO_COMPANY, accessToken: 'demo-token', refreshToken: 'demo-token', permissions: null, error: null, onboardingCompleted: true, enabledModules: ALL_MODULES })
  },
  can: (module, action) => {
    const state = get()
    if (!state.user) return false
    // Owner and Admin have full access
    if (state.user.role === 'owner' || state.user.role === 'admin' || state.permissions === null) return true
    return state.permissions[module]?.includes(action) ?? false
  },
  canAny: (module) => {
    const state = get()
    if (!state.user) return false
    if (state.user.role === 'owner' || state.user.role === 'admin' || state.permissions === null) return true
    return (state.permissions[module]?.length ?? 0) > 0
  },
  updatePermissions: (permissions) => {
    localStorage.setItem('permissions', JSON.stringify(permissions))
    set({ permissions })
  },
  setOnboardingCompleted: (completed) => {
    localStorage.setItem('onboardingCompleted', String(completed))
    set({ onboardingCompleted: completed })
  },
  setEnabledModules: (modules) => {
    localStorage.setItem('enabledModules', JSON.stringify(modules))
    set({ enabledModules: modules })
  },
  isModuleEnabled: (moduleKey) => {
    const state = get()
    // If no modules configured (legacy company), show everything
    if (!state.enabledModules || state.enabledModules.length === 0) return true
    return state.enabledModules.includes(moduleKey)
  },
  setSubscription: (info) => set({ subscription: info }),
}))
