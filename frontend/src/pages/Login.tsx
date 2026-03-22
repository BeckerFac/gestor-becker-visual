import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'

const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(6, 'La contrasena debe tener al menos 6 caracteres'),
})

const registerSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
    .regex(/[a-z]/, 'Debe contener al menos una minuscula')
    .regex(/[0-9]/, 'Debe contener al menos un numero'),
  confirmPassword: z.string(),
  name: z.string().min(2, 'El nombre es requerido'),
  company_name: z.string().min(2, 'El nombre de la empresa es requerido'),
  cuit: z.string().min(11, 'El CUIT debe tener 11 digitos').max(13, 'CUIT invalido'),
  accept_terms: z.literal(true, { message: 'Debes aceptar los Terminos y Condiciones' }),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Las contrasenas no coinciden',
  path: ['confirmPassword'],
})

type LoginFormData = z.infer<typeof loginSchema>
type RegisterFormData = z.infer<typeof registerSchema>

// Styled input for auth pages
const AuthInput: React.FC<{
  label: string
  type?: string
  placeholder?: string
  error?: string
  register: any
}> = ({ label, type = 'text', placeholder, error, register }) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
    <input
      type={type}
      placeholder={placeholder}
      {...register}
      className={`w-full px-4 py-3 bg-white/5 border ${error ? 'border-red-500/60' : 'border-white/10'} rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200`}
    />
    {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
  </div>
)

export const Login: React.FC = () => {
  const navigate = useNavigate()
  const [isRegister, setIsRegister] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const setAuth = useAuthStore((state) => state.setAuth)
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    if (user) navigate('/dashboard')
  }, [user, navigate])

  const loginForm = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) })
  const registerForm = useForm<RegisterFormData>({ resolver: zodResolver(registerSchema) })

  const onLogin = async (data: LoginFormData) => {
    setLoading(true)
    try {
      const response = await api.login(data.email, data.password)
      const company = response.company || { id: response.user.company_id, name: 'Mi Empresa', cuit: '00000000000' }
      setAuth(response.user, company, response.accessToken, response.refreshToken, response.permissions ?? null)
      navigate('/dashboard')
    } catch (error: any) {
      const msg = typeof error === 'string' ? error : error?.message || 'Error en el login'
      loginForm.setError('email', { message: msg })
    } finally {
      setLoading(false)
    }
  }

  const onRegister = async (data: RegisterFormData) => {
    setLoading(true)
    try {
      const response = await api.register(data.email, data.password, data.name, data.company_name, data.cuit)
      const company = response.company || { id: response.user.company_id, name: data.company_name, cuit: data.cuit }
      setAuth(response.user, company, response.accessToken, response.refreshToken, response.permissions ?? null)
      navigate('/dashboard')
    } catch (error: any) {
      const msg = typeof error === 'string' ? error : error?.message || 'Error en el registro'
      registerForm.setError('email', { message: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background mesh gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[70%] h-[70%] rounded-full bg-blue-600/[0.07] blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[20%] w-[60%] h-[60%] rounded-full bg-indigo-600/[0.05] blur-[120px]" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-cyan-500/[0.03] blur-[80px]" />
      </div>

      <div className="w-full max-w-[420px] relative z-10 animate-[fadeIn_0.4s_ease-out]">
        {/* Logo + branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4 shadow-lg shadow-blue-500/20">
            <span className="text-2xl font-bold text-white">G</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">GESTIA</h1>
          <p className="text-gray-500 text-sm mt-1">Gestion empresarial inteligente</p>
        </div>

        {/* Card */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 shadow-2xl shadow-black/20">
          {!isRegister ? (
            /* ====== LOGIN FORM ====== */
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-5">
              <AuthInput
                label="Email"
                type="email"
                placeholder="tu@email.com"
                register={loginForm.register('email')}
                error={loginForm.formState.errors.email?.message}
              />
              <AuthInput
                label="Contrasena"
                type="password"
                placeholder="Ingresa tu contrasena"
                register={loginForm.register('password')}
                error={loginForm.formState.errors.password?.message}
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Ingresando...
                  </>
                ) : 'Iniciar sesion'}
              </button>

              <div className="text-center space-y-3 pt-2">
                <Link to="/forgot-password" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
                  Olvidaste tu contrasena?
                </Link>
                <div className="border-t border-white/[0.06] pt-4">
                  <p className="text-gray-500 text-sm">
                    No tenes cuenta?{' '}
                    <button type="button" onClick={() => setIsRegister(true)} className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                      Registrate gratis
                    </button>
                  </p>
                </div>
              </div>
            </form>
          ) : (
            /* ====== REGISTER FORM ====== */
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
              <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 mb-1">
                <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-blue-300 text-sm font-medium">15 dias gratis — sin tarjeta de credito</p>
              </div>

              <AuthInput label="Nombre completo" placeholder="Tu nombre" register={registerForm.register('name')} error={registerForm.formState.errors.name?.message} />
              <AuthInput label="Email" type="email" placeholder="tu@email.com" register={registerForm.register('email')} error={registerForm.formState.errors.email?.message} />
              <div className="grid grid-cols-2 gap-3">
                <AuthInput label="Contrasena" type="password" placeholder="Min. 8 caracteres" register={registerForm.register('password')} error={registerForm.formState.errors.password?.message} />
                <AuthInput label="Confirmar" type="password" placeholder="Repetir" register={registerForm.register('confirmPassword')} error={registerForm.formState.errors.confirmPassword?.message} />
              </div>
              <AuthInput label="Nombre de la empresa" placeholder="Mi empresa SRL" register={registerForm.register('company_name')} error={registerForm.formState.errors.company_name?.message} />
              <AuthInput label="CUIT" placeholder="20-12345678-9" register={registerForm.register('cuit')} error={registerForm.formState.errors.cuit?.message} />

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" {...registerForm.register('accept_terms')} className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-blue-600 focus:ring-blue-500/50" />
                <span className="text-xs text-gray-500 leading-relaxed">
                  Acepto los <a href="/legal/terminos" target="_blank" className="text-blue-400 hover:underline">Terminos</a> y la <a href="/legal/privacidad" target="_blank" className="text-blue-400 hover:underline">Politica de Privacidad</a>
                </span>
              </label>
              {registerForm.formState.errors.accept_terms && (
                <p className="text-red-400 text-xs -mt-2">{registerForm.formState.errors.accept_terms.message}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creando cuenta...
                  </>
                ) : 'Crear cuenta gratis'}
              </button>

              <div className="text-center pt-2">
                <p className="text-gray-500 text-sm">
                  Ya tenes cuenta?{' '}
                  <button type="button" onClick={() => setIsRegister(false)} className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                    Inicia sesion
                  </button>
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-gray-600 dark:text-gray-400 space-x-3">
          <a href="/legal/terminos" className="hover:text-gray-400 transition-colors">Terminos</a>
          <span className="text-gray-700 dark:text-gray-300">|</span>
          <a href="/legal/privacidad" className="hover:text-gray-400 transition-colors">Privacidad</a>
        </div>
      </div>
    </div>
  )
}
