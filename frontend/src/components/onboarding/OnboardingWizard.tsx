import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'
import { toast } from '@/hooks/useToast'
import { StepCompanyData } from './steps/StepCompanyData'
import { StepModules } from './steps/StepModules'
import { StepProduct } from './steps/StepProduct'
import { StepCustomer } from './steps/StepCustomer'
import { StepComplete } from './steps/StepComplete'
import { OnboardingProgress } from './OnboardingProgress'

const STEPS = [
  { id: 1, label: 'Tu empresa', required: true },
  { id: 2, label: 'Modulos', required: true },
  { id: 3, label: 'Producto', required: false },
  { id: 4, label: 'Cliente', required: false },
  { id: 5, label: 'Listo!', required: false },
]

interface OnboardingWizardProps {
  onComplete: () => void
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const navigate = useNavigate()
  const company = useAuthStore((s) => s.company)
  const setOnboardingCompleted = useAuthStore((s) => s.setOnboardingCompleted)
  const setEnabledModules = useAuthStore((s) => s.setEnabledModules)

  const [currentStep, setCurrentStep] = useState(1)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [animating, setAnimating] = useState(false)
  const [loading, setLoading] = useState(true)

  // Step data
  const [companyData, setCompanyData] = useState({
    name: company?.name || '',
    cuit: company?.cuit || '',
    razon_social: '',
    condicion_iva: '',
    address: '',
    city: '',
    province: '',
    phone: '',
    email: '',
    punto_venta: '',
    logo_url: '',
  })

  const [selectedModules, setSelectedModules] = useState<string[]>([
    'orders', 'invoices', 'products', 'inventory', 'purchases',
    'cobros', 'pagos', 'cheques', 'enterprises', 'banks',
    'customers', 'quotes', 'remitos',
  ])

  const [products, setProducts] = useState<Array<{
    name: string; sku: string; cost: string; price: string; vat_rate: string
  }>>([])

  const [customerData, setCustomerData] = useState({
    name: '', cuit: '', condicion_iva: '', contact_name: '', email: '', phone: '',
  })

  // Load current onboarding status on mount
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const status = await api.getOnboardingStatus()
        if (status.completed) {
          onComplete()
          return
        }
        if (status.currentStep > 0 && status.currentStep < 5) {
          setCurrentStep(status.currentStep + 1)
        }
        // Pre-fill company data from status
        const c = status.company
        if (c) {
          setCompanyData({
            name: c.name || '',
            cuit: c.cuit || '',
            razon_social: c.razon_social || '',
            condicion_iva: c.condicion_iva || '',
            address: c.address || '',
            city: c.city || '',
            province: c.province || '',
            phone: c.phone || '',
            email: c.email || '',
            punto_venta: c.punto_venta ? String(c.punto_venta) : '',
            logo_url: c.logo_url || '',
          })
          if (c.enabled_modules && Array.isArray(c.enabled_modules)) {
            setSelectedModules(c.enabled_modules)
          }
        }
      } catch (e) {
        // If status check fails, just start from beginning
      } finally {
        setLoading(false)
      }
    }
    loadStatus()
  }, [onComplete])

  const goToStep = useCallback((step: number) => {
    if (step === currentStep || animating) return
    setDirection(step > currentStep ? 'forward' : 'back')
    setAnimating(true)
    setTimeout(() => {
      setCurrentStep(step)
      setAnimating(false)
    }, 200)
  }, [currentStep, animating])

  const handleNext = useCallback(async () => {
    if (currentStep === 5) return

    try {
      // Save current step data before advancing
      if (currentStep === 1) {
        await api.completeOnboardingStep(1, {
          ...companyData,
          punto_venta: companyData.punto_venta ? parseInt(companyData.punto_venta, 10) : null,
        })
      } else if (currentStep === 2) {
        await api.completeOnboardingStep(2, { enabled_modules: selectedModules })
        setEnabledModules(selectedModules)
      } else if (currentStep === 3) {
        if (products.length > 0) {
          await api.completeOnboardingStep(3, {
            products: products.map((p) => ({
              name: p.name,
              sku: p.sku || undefined,
              cost: parseFloat(p.cost) || 0,
              price: parseFloat(p.price) || 0,
              vat_rate: parseFloat(p.vat_rate) || 21,
            })),
          })
        }
      } else if (currentStep === 4) {
        if (customerData.name && customerData.cuit) {
          await api.completeOnboardingStep(4, { customer: customerData })
        }
      }
    } catch (e: any) {
      toast.error(e.message || 'Error al guardar')
      return
    }

    goToStep(currentStep + 1)
  }, [currentStep, companyData, selectedModules, products, customerData, goToStep, setEnabledModules])

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      goToStep(currentStep - 1)
    }
  }, [currentStep, goToStep])

  const handleSkip = useCallback(() => {
    goToStep(currentStep + 1)
  }, [currentStep, goToStep])

  const handleFinish = useCallback(async (destination: 'invoices' | 'dashboard' | 'explore') => {
    try {
      await api.completeOnboarding()
      setOnboardingCompleted(true)
      onComplete()

      if (destination === 'invoices') {
        navigate('/invoices')
      } else if (destination === 'dashboard') {
        navigate('/dashboard')
      }
      // 'explore' just closes the wizard
    } catch (e: any) {
      toast.error(e.message || 'Error al completar')
    }
  }, [navigate, onComplete, setOnboardingCompleted])

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  const canAdvance = () => {
    if (currentStep === 1) {
      return !!(companyData.name && companyData.cuit)
    }
    if (currentStep === 2) {
      return selectedModules.length > 0
    }
    return true
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="text-center mb-4">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">GESTIA</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Configuremos tu empresa en 2 minutos
            </p>
          </div>
          <OnboardingProgress steps={STEPS} currentStep={currentStep} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div
            className={`transition-all duration-200 ease-in-out ${
              animating
                ? direction === 'forward'
                  ? 'opacity-0 -translate-x-4'
                  : 'opacity-0 translate-x-4'
                : 'opacity-100 translate-x-0'
            }`}
          >
            {currentStep === 1 && (
              <StepCompanyData
                data={companyData}
                onChange={setCompanyData}
              />
            )}
            {currentStep === 2 && (
              <StepModules
                selected={selectedModules}
                onChange={setSelectedModules}
              />
            )}
            {currentStep === 3 && (
              <StepProduct
                products={products}
                onChange={setProducts}
              />
            )}
            {currentStep === 4 && (
              <StepCustomer
                data={customerData}
                onChange={setCustomerData}
              />
            )}
            {currentStep === 5 && (
              <StepComplete
                companyName={companyData.razon_social || companyData.name}
                modulesCount={selectedModules.length}
                productsCount={products.length}
                hasCustomer={!!(customerData.name && customerData.cuit)}
                onFinish={handleFinish}
              />
            )}
          </div>
        </div>

        {/* Footer navigation - not shown on step 5 */}
        {currentStep < 5 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              {currentStep > 1 && (
                <button
                  onClick={handleBack}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  Atras
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!STEPS[currentStep - 1].required && (
                <button
                  onClick={handleSkip}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  Lo hago despues
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={!canAdvance()}
                className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {currentStep === 4 ? 'Finalizar' : 'Siguiente'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
