import React from 'react'
import { useAuthStore } from '@/stores/authStore'

interface PermissionGateProps {
  module: string
  action?: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  module,
  action = 'view',
  children,
  fallback = null,
}) => {
  const can = useAuthStore(state => state.can)
  if (!can(module, action)) return <>{fallback}</>
  return <>{children}</>
}

// Hook version
export function useCan(module: string, action: string = 'view'): boolean {
  return useAuthStore(state => state.can)(module, action)
}

export function useCanAny(module: string): boolean {
  return useAuthStore(state => state.canAny)(module)
}
