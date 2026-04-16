import { useAuthStore } from '@/stores/authStore'

/**
 * Sol/Luna dual-circuit: the single source of truth for "which circuits is
 * this user allowed to see?". Components should never read
 * `user.can_access_luna` directly — they call this hook and destructure.
 *
 * Invisible-by-default rule: a user without Luna access should never see a
 * Luna tab, badge, filter, toggle, chip, or menu item. If `canAccessLuna`
 * is false the UI must render as if Luna did not exist.
 */
export type Circuit = 'fiscal' | 'no_fiscal'

export interface CircuitAccess {
  canAccessLuna: boolean
  visibleCircuits: Circuit[]
  defaultCircuit: Circuit
  hasBoth: boolean
}

export function useCircuitAccess(): CircuitAccess {
  const user = useAuthStore(s => s.user)
  const canLuna = Boolean(user?.can_access_luna)
  return {
    canAccessLuna: canLuna,
    visibleCircuits: (canLuna ? ['fiscal', 'no_fiscal'] : ['fiscal']) as Circuit[],
    defaultCircuit: 'fiscal',
    hasBoth: canLuna,
  }
}
