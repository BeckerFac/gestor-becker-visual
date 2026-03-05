import { create } from 'zustand'

export interface User {
  id: string
  email: string
  name: string
  company_id: string
  role: 'admin' | 'gerente' | 'vendedor' | 'contable' | 'viewer'
}

export interface Company {
  id: string
  name: string
  cuit: string
}

interface AuthStore {
  user: User | null
  company: Company | null
  accessToken: string | null
  refreshToken: string | null
  isLoading: boolean
  error: string | null
  setAuth: (user: User, company: Company, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  clearAuth: () => void
  setError: (error: string | null) => void
  initSingleCompanyMode: () => void
}

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

// Restore user and company from localStorage
const savedUser = localStorage.getItem('user')
const savedCompany = localStorage.getItem('company')
const restoredUser = savedUser ? JSON.parse(savedUser) as User : null
const restoredCompany = savedCompany ? JSON.parse(savedCompany) as Company : null

export const useAuthStore = create<AuthStore>((set) => ({
  user: restoredUser,
  company: restoredCompany,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  isLoading: false,
  error: null,
  setAuth: (user, company, accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('company', JSON.stringify(company))
    set({ user, company, accessToken, refreshToken, error: null })
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
    set({ user: null, company: null, accessToken: null, refreshToken: null })
  },
  setError: (error) => set({ error }),
  initSingleCompanyMode: () => {
    // Auto-login with demo credentials for single-company mode
    set({ user: DEMO_USER, company: DEMO_COMPANY, accessToken: 'demo-token', refreshToken: 'demo-token', error: null })
  },
}))
