import React, { useEffect, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { api } from '@/services/api'

const acceptSchema = z.object({
  name: z.string().min(2, 'El nombre es requerido'),
  password: z.string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
    .regex(/[a-z]/, 'Debe contener al menos una minuscula')
    .regex(/[0-9]/, 'Debe contener al menos un numero'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Las contrasenas no coinciden',
  path: ['confirmPassword'],
})

type AcceptFormData = z.infer<typeof acceptSchema>

interface InvitationInfo {
  id: string
  email: string
  name: string | null
  role: string
  company_id: string
  company_name: string
}

export const AcceptInvite: React.FC = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [validating, setValidating] = useState(true)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<AcceptFormData>({
    resolver: zodResolver(acceptSchema),
  })

  useEffect(() => {
    if (!token) {
      setValidating(false)
      setValidationError('Token de invitacion no proporcionado')
      return
    }

    api.validateInvitation(token)
      .then((data) => {
        setInvitation(data)
        if (data.name) {
          form.setValue('name', data.name)
        }
      })
      .catch((err: any) => {
        setValidationError(err?.message || 'Invitacion invalida o expirada')
      })
      .finally(() => setValidating(false))
  }, [token, form])

  const onSubmit = async (data: AcceptFormData) => {
    if (!token) return
    setLoading(true)
    setSubmitError(null)
    try {
      await api.acceptInvitation(token, { name: data.name, password: data.password })
      setSuccess(true)
    } catch (err: any) {
      setSubmitError(err?.message || 'Error al aceptar la invitacion')
    } finally {
      setLoading(false)
    }
  }

  const roleLabels: Record<string, string> = {
    owner: 'Propietario',
    admin: 'Administrador',
    gerente: 'Gerente',
    editor: 'Editor',
    vendedor: 'Vendedor',
    contable: 'Contable',
    viewer: 'Visualizador',
  }

  if (validating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardContent className="pt-8 text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Validando invitacion...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (validationError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardContent className="pt-8 text-center">
            <h2 className="text-xl font-bold text-red-600 mb-4">Invitacion invalida</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">{validationError}</p>
            <Link to="/" className="text-blue-600 hover:underline">Ir al login</Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-green-800 dark:text-green-200 font-medium">
                Tu cuenta fue creada exitosamente.
              </p>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Ya podes iniciar sesion con tu email y contrasena.
            </p>
            <Link
              to="/"
              className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Iniciar sesion
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="pt-8">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">BeckerVisual</h1>
            <p className="text-gray-600 dark:text-gray-400">Aceptar invitacion</p>
          </div>

          {invitation && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
              <p className="text-blue-800 dark:text-blue-200 text-sm">
                Fuiste invitado a unirte a <strong>{invitation.company_name}</strong> como{' '}
                <strong>{roleLabels[invitation.role] || invitation.role}</strong>.
              </p>
              <p className="text-blue-600 dark:text-blue-300 text-xs mt-1">
                Email: {invitation.email}
              </p>
            </div>
          )}

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {submitError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-red-700 dark:text-red-300 text-sm">{submitError}</p>
              </div>
            )}

            <Input
              label="Nombre completo"
              placeholder="Tu nombre"
              {...form.register('name')}
              error={form.formState.errors.name?.message}
            />
            <Input
              label="Contrasena"
              type="password"
              placeholder="Minimo 8 caracteres"
              {...form.register('password')}
              error={form.formState.errors.password?.message}
            />
            <Input
              label="Confirmar contrasena"
              type="password"
              placeholder="Repetir contrasena"
              {...form.register('confirmPassword')}
              error={form.formState.errors.confirmPassword?.message}
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              loading={loading}
            >
              Crear cuenta y unirme
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
