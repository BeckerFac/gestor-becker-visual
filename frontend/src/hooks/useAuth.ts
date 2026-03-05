import { useAuthStore } from '@/stores/authStore'

/**
 * @deprecated Use useAuthStore directly instead
 * This hook is kept for backward compatibility
 */
export const useAuth = () => {
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)

  const loading = false

  return {
    user,
    loading,
    isAuthenticated: !!accessToken && !!user,
  }
}
