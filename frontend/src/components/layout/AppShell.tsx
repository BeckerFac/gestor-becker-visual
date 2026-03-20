import React from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useUIStore } from '@/stores/uiStore'
import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'
import { AIChatPanel } from '@/components/ai/AIChatPanel'
import { SecretarIAChatPanel } from '@/components/secretaria/SecretarIAChatPanel'

interface AppShellProps {
  children: React.ReactNode
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 dark:text-gray-100">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Impersonation banner */}
        <ImpersonationBanner />

        {/* Header */}
        <Header />

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>

      {/* AI Chat Panel - floating button (Premium only, auto-hides if no access) */}
      <AIChatPanel />

      {/* SecretarIA Chat Panel - floating button (visible if SecretarIA enabled) */}
      <SecretarIAChatPanel />
    </div>
  )
}
