import React, { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useUIStore } from '@/stores/uiStore'
import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'
import { TrialBanner } from '@/components/billing/TrialBanner'
import { api } from '@/services/api'

interface AppShellProps {
  children: React.ReactNode
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const [billingInfo, setBillingInfo] = useState<{
    plan: string
    status: string
    days_remaining: number | null
  } | null>(null)

  useEffect(() => {
    api.getBillingSubscription()
      .then((data: any) => setBillingInfo({
        plan: data.plan,
        status: data.status,
        days_remaining: data.days_remaining,
      }))
      .catch(() => { /* billing not available yet */ })
  }, [])

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Impersonation banner */}
        <ImpersonationBanner />

        {/* Trial/billing banner */}
        {billingInfo && (
          <div className="px-4 pt-2 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
            <TrialBanner
              daysRemaining={billingInfo.days_remaining}
              status={billingInfo.status}
              plan={billingInfo.plan}
            />
          </div>
        )}

        {/* Header */}
        <Header />

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
