import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/services/api'

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
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

export const Login: React.FC = () => {
  const navigate = useNavigate()
  const [isRegister, setIsRegister] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const setAuth = useAuthStore((state) => state.setAuth)
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    if (user) {
      navigate('/dashboard')
    }
  }, [user, navigate])

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const onLogin = async (data: LoginFormData) => {
    setLoading(true)
    try {
      const response = await api.login(data.email, data.password)
      // Use company from response or create dummy if null
      const company = response.company || {
        id: response.user.company_id,
        name: 'Mi Empresa',
        cuit: '00000000000',
      }
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
      const response = await api.register(
        data.email,
        data.password,
        data.name,
        data.company_name,
        data.cuit
      )
      // Use company from response or create dummy if null
      const company = response.company || {
        id: response.user.company_id,
        name: data.company_name,
        cuit: data.cuit,
      }
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="pt-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">BeckerVisual</h1>
            <p className="text-gray-600 dark:text-gray-400">Gestor Comercial Profesional</p>
          </div>

          {!isRegister ? (
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
              <Input
                label="Email"
                type="email"
                placeholder="tu@email.com"
                {...loginForm.register('email')}
                error={loginForm.formState.errors.email?.message}
              />
              <Input
                label="Contraseña"
                type="password"
                placeholder="••••••"
                {...loginForm.register('password')}
                error={loginForm.formState.errors.password?.message}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={loading}
              >
                Iniciar sesion
              </Button>

              <div className="text-center space-y-2">
                <Link
                  to="/forgot-password"
                  className="text-blue-600 hover:underline text-sm block"
                >
                  Olvidaste tu contrasena?
                </Link>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  No tenes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => setIsRegister(true)}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Registrate aca
                  </button>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-2">
                <p className="text-blue-800 dark:text-blue-200 text-sm font-medium">
                  15 dias de prueba gratuita - Sin tarjeta de credito
                </p>
              </div>
              <Input
                label="Nombre completo"
                placeholder="Tu nombre"
                {...registerForm.register('name')}
                error={registerForm.formState.errors.name?.message}
              />
              <Input
                label="Email"
                type="email"
                placeholder="tu@email.com"
                {...registerForm.register('email')}
                error={registerForm.formState.errors.email?.message}
              />
              <Input
                label="Contrasena"
                type="password"
                placeholder="Min. 8 caracteres, 1 mayuscula, 1 numero"
                {...registerForm.register('password')}
                error={registerForm.formState.errors.password?.message}
              />
              <Input
                label="Confirmar contrasena"
                type="password"
                placeholder="Repetir contrasena"
                {...registerForm.register('confirmPassword')}
                error={registerForm.formState.errors.confirmPassword?.message}
              />
              <Input
                label="Nombre de la empresa"
                placeholder="Mi empresa"
                {...registerForm.register('company_name')}
                error={registerForm.formState.errors.company_name?.message}
              />
              <Input
                label="CUIT"
                placeholder="20123456789"
                {...registerForm.register('cuit')}
                error={registerForm.formState.errors.cuit?.message}
              />
              <div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    {...registerForm.register('accept_terms')}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Acepto los{' '}
                    <a
                      href="/legal/terminos"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Terminos y Condiciones
                    </a>{' '}
                    y la{' '}
                    <a
                      href="/legal/privacidad"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Politica de Privacidad
                    </a>
                  </span>
                </label>
                {registerForm.formState.errors.accept_terms && (
                  <p className="text-red-500 text-xs mt-1">
                    {registerForm.formState.errors.accept_terms.message}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={loading}
              >
                Crear cuenta
              </Button>

              <div className="text-center">
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  ¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => setIsRegister(false)}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Inicia sesión aquí
                  </button>
                </p>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400 space-x-3">
        <a href="/legal/terminos" className="hover:underline hover:text-gray-700 dark:hover:text-gray-300">
          Terminos y Condiciones
        </a>
        <span>|</span>
        <a href="/legal/privacidad" className="hover:underline hover:text-gray-700 dark:hover:text-gray-300">
          Politica de Privacidad
        </a>
      </div>
    </div>
  )
}
