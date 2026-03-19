import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { api } from '@/services/api'

const resetSchema = z.object({
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

type ResetFormData = z.infer<typeof resetSchema>

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  })

  const onSubmit = async (data: ResetFormData) => {
    if (!token) {
      setError('Token no proporcionado')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.resetPassword(token, data.password)
      setSuccess(true)
    } catch (err: any) {
      setError(err?.message || 'Error al restablecer la contrasena')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardContent className="pt-8 text-center">
            <h2 className="text-xl font-bold text-red-600 mb-4">Enlace invalido</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              El enlace de restablecimiento es invalido o ha expirado.
            </p>
            <Link to="/forgot-password" className="text-blue-600 hover:underline">
              Solicitar nuevo enlace
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
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">BeckerVisual</h1>
            <p className="text-gray-600 dark:text-gray-400">Nueva contrasena</p>
          </div>

          {success ? (
            <div className="text-center space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-green-800 dark:text-green-200">
                  Tu contrasena fue restablecida exitosamente.
                </p>
              </div>
              <Link to="/" className="text-blue-600 hover:underline text-sm font-medium">
                Iniciar sesion
              </Link>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
                </div>
              )}

              <Input
                label="Nueva contrasena"
                type="password"
                placeholder="Minimo 8 caracteres, 1 mayuscula, 1 numero"
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

              <div className="text-xs text-gray-500 space-y-1">
                <p>La contrasena debe contener:</p>
                <ul className="list-disc pl-4">
                  <li>Minimo 8 caracteres</li>
                  <li>Al menos 1 mayuscula</li>
                  <li>Al menos 1 minuscula</li>
                  <li>Al menos 1 numero</li>
                </ul>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={loading}
              >
                Restablecer contrasena
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
