import React from 'react'

/**
 * Yellow banner shown when a superadmin is viewing the app as another company.
 * Stored in localStorage: is_impersonating, impersonation_company, original_accessToken, etc.
 */
export const ImpersonationBanner: React.FC = () => {
  const isImpersonating = localStorage.getItem('is_impersonating') === 'true'

  if (!isImpersonating) return null

  const companyData = localStorage.getItem('impersonation_company')
  let companyName = 'Desconocida'
  try {
    if (companyData) {
      const parsed = JSON.parse(companyData)
      companyName = parsed.name || 'Desconocida'
    }
  } catch {
    // ignore parse errors
  }

  const handleExit = () => {
    // Restore original auth data
    const originalToken = localStorage.getItem('original_accessToken')
    const originalUser = localStorage.getItem('original_user')
    const originalCompany = localStorage.getItem('original_company')

    if (originalToken) localStorage.setItem('accessToken', originalToken)
    if (originalUser) localStorage.setItem('user', originalUser)
    if (originalCompany) localStorage.setItem('company', originalCompany)

    // Clean up impersonation data
    localStorage.removeItem('is_impersonating')
    localStorage.removeItem('impersonation_token')
    localStorage.removeItem('impersonation_company')
    localStorage.removeItem('impersonation_user')
    localStorage.removeItem('original_accessToken')
    localStorage.removeItem('original_user')
    localStorage.removeItem('original_company')

    window.location.href = '/admin'
  }

  return (
    <div className="bg-yellow-400 text-yellow-900 px-4 py-2 text-sm font-medium flex items-center justify-between z-50 sticky top-0">
      <span>
        Estas viendo como <strong>{companyName}</strong> - modo solo lectura
      </span>
      <button
        onClick={handleExit}
        className="px-3 py-1 bg-yellow-600 text-white rounded text-xs font-bold hover:bg-yellow-700 transition-colors"
      >
        Volver a admin
      </button>
    </div>
  )
}
