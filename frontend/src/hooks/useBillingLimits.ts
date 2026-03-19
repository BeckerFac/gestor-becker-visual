import { useState, useCallback } from 'react'
import { api } from '@/services/api'

interface LimitCheckResult {
  allowed: boolean
  current: number
  limit: number
  message: string | null
  code?: string
}

// Hook to check plan limits before creating resources
// Usage:
//   const { checkLimit, showUpgrade, upgradeMessage, setShowUpgrade } = useBillingLimits()
//   const handleCreate = async () => {
//     const canProceed = await checkLimit('invoice')
//     if (!canProceed) return // modal will show automatically
//     // ... proceed with creation
//   }
export function useBillingLimits() {
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null)

  const checkLimit = useCallback(async (action: string): Promise<boolean> => {
    try {
      const result: LimitCheckResult = await api.checkBillingLimits(action)
      if (!result.allowed) {
        setUpgradeMessage(result.message)
        setShowUpgrade(true)
        return false
      }
      return true
    } catch (error) {
      // If billing check fails, allow the action (graceful degradation)
      console.error('Billing limit check failed:', error)
      return true
    }
  }, [])

  return {
    checkLimit,
    showUpgrade,
    upgradeMessage,
    setShowUpgrade,
  }
}
