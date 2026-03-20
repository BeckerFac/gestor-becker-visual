import React from 'react'
import { SecretarIASection } from '@/components/secretaria/SecretarIASection'

export default function SecretarIA() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">SecretarIA</h1>
        <p className="text-gray-500 dark:text-gray-400">Asistente WhatsApp para tu negocio</p>
      </div>
      <SecretarIASection />
    </div>
  )
}
