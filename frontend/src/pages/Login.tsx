import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  name: z.string().min(2, 'El nombre es requerido'),
  company_name: z.string().min(2, 'El nombre de la empresa es requerido'),
  cuit: z.string().min(11, 'El CUIT debe tener 11 dígitos'),
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
      setAuth(response.user, company, response.accessToken, response.refreshToken)
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
      setAuth(response.user, company, response.accessToken, response.refreshToken)
      navigate('/dashboard')
    } catch (error: any) {
      const msg = typeof error === 'string' ? error : error?.message || 'Error en el registro'
      registerForm.setError('email', { message: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="pt-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">BeckerVisual</h1>
            <p className="text-gray-600">Gestor Comercial Profesional</p>
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
                Iniciar sesión
              </Button>

              <div className="text-center">
                <p className="text-gray-600 text-sm">
                  ¿No tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => setIsRegister(true)}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Regístrate aquí
                  </button>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
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
                label="Contraseña"
                type="password"
                placeholder="••••••"
                {...registerForm.register('password')}
                error={registerForm.formState.errors.password?.message}
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
                <p className="text-gray-600 text-sm">
                  ¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => setIsRegister(false)}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Inicia sesión aquí
                  </button>
                </p>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
