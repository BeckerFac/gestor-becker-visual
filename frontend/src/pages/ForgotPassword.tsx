import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { api } from '@/services/api'

const forgotSchema = z.object({
  email: z.string().email('Email invalido'),
})

type ForgotFormData = z.infer<typeof forgotSchema>

export const ForgotPassword: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
  })

  const onSubmit = async (data: ForgotFormData) => {
    setLoading(true)
    try {
      await api.forgotPassword(data.email)
      setSent(true)
    } catch {
      // Always show success to prevent user enumeration
      setSent(true)
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
            <p className="text-gray-600 dark:text-gray-400">Restablecer contrasena</p>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-green-800 dark:text-green-200">
                  Si el email esta registrado, recibiras un enlace para restablecer tu contrasena.
                  Revisa tu bandeja de entrada y spam.
                </p>
              </div>
              <Link to="/" className="text-blue-600 hover:underline text-sm">
                Volver al login
              </Link>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                Ingresa tu email y te enviaremos un enlace para restablecer tu contrasena.
              </p>
              <Input
                label="Email"
                type="email"
                placeholder="tu@email.com"
                {...form.register('email')}
                error={form.formState.errors.email?.message}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={loading}
              >
                Enviar enlace
              </Button>

              <div className="text-center">
                <Link to="/" className="text-blue-600 hover:underline text-sm">
                  Volver al login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
