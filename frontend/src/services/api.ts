import axios, { AxiosInstance } from 'axios'
import { User, Company, useAuthStore } from '@/stores/authStore'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const client: AxiosInstance = axios.create({
  baseURL: API_BASE,
})

// Agregar token + business_unit_id a requests
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // Auto-inject active business_unit_id as query param for GET requests
  // Only inject if it looks like a valid UUID to avoid breaking requests
  const activeUnitId = localStorage.getItem('gestia_active_business_unit_id')
  if (activeUnitId && config.method === 'get' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeUnitId)) {
    config.params = { ...config.params, business_unit_id: activeUnitId }
  }
  return config
})

// Separate client for customer portal (uses customerAccessToken)
const portalClient: AxiosInstance = axios.create({ baseURL: API_BASE })
portalClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('customerAccessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
portalClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('customerAccessToken')
      localStorage.removeItem('customerRefreshToken')
      localStorage.removeItem('customerName')
      localStorage.removeItem('customerCompanyName')
      window.location.href = '/portal'
    }
    const msg = error.response?.data?.error || error.response?.data?.message || error.message || 'Error de conexión'
    throw new Error(msg)
  }
)

// Auto-refresh on 401
let isRefreshing = false
let failedQueue: { resolve: (token: string) => void; reject: (err: any) => void }[] = []

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(p => {
    if (token) p.resolve(token)
    else p.reject(error)
  })
  failedQueue = []
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem('refreshToken')

      if (!refreshToken || originalRequest.url === '/auth/refresh') {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        window.location.href = '/'
        return Promise.reject(error)
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`
              resolve(client(originalRequest))
            },
            reject: (err: any) => reject(err),
          })
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken })
        const newAccessToken = data.accessToken
        const newRefreshToken = data.refreshToken

        localStorage.setItem('accessToken', newAccessToken)
        if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken)

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        processQueue(null, newAccessToken)

        // Refresh permissions after token refresh
        try {
          const meRes = await client.get('/auth/me')
          const meUser = meRes.data?.user || meRes.data
          if (meUser?.permissions !== undefined) {
            useAuthStore.getState().updatePermissions(meUser.permissions)
          }
        } catch (_) { /* permissions refresh failed, not critical */ }

        return client(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        window.location.href = '/'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    if (error.response?.status === 403) {
      const msg = error.response?.data?.message || error.response?.data?.error || 'No tiene permisos para esta accion'
      throw new Error(msg)
    }

    const msg = error.response?.data?.error || error.response?.data?.message || error.message || 'Error de conexión'
    throw new Error(msg)
  }
)

interface AuthResponse {
  user: User
  company?: Company | null  // Optional because backend might not return it
  accessToken: string
  refreshToken: string
  permissions?: Record<string, string[]> | null
}

export const api = {
  // Auth
  register: async (
    email: string,
    password: string,
    name: string,
    company_name: string,
    cuit: string
  ): Promise<AuthResponse> => {
    const { data } = await client.post<AuthResponse>('/auth/register', {
      email,
      password,
      name,
      company_name,
      cuit,
    })
    return data
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const { data } = await client.post<AuthResponse>('/auth/login', { email, password })
    return data
  },

  getMe: async () => {
    const { data } = await client.get('/auth/me')
    return data.user || data
  },

  // Email verification
  verifyEmail: async (token: string) => {
    const { data } = await client.get(`/auth/verify-email/${token}`)
    return data
  },

  // Password reset
  forgotPassword: async (email: string) => {
    const { data } = await client.post('/auth/forgot-password', { email })
    return data
  },

  resetPassword: async (token: string, password: string) => {
    const { data } = await client.post('/auth/reset-password', { token, password })
    return data
  },

  resendVerification: async () => {
    const { data } = await client.post('/auth/resend-verification')
    return data
  },

  // Billing / Subscription
  getSubscription: async () => {
    const { data } = await client.get('/billing/subscription')
    return data
  },

  getPlans: async () => {
    const { data } = await client.get('/billing/plans')
    return data
  },

  // Invitations
  getInvitations: async () => {
    const { data } = await client.get('/invitations')
    return data.invitations || data
  },

  createInvitation: async (invitationData: { email: string; role: string; name?: string }) => {
    const { data } = await client.post('/invitations', invitationData)
    return data
  },

  cancelInvitation: async (id: string) => {
    const { data } = await client.delete(`/invitations/${id}`)
    return data
  },

  resendInvitation: async (id: string) => {
    const { data } = await client.post(`/invitations/${id}/resend`)
    return data
  },

  validateInvitation: async (token: string) => {
    const { data } = await client.get(`/invitations/validate/${token}`)
    return data
  },

  acceptInvitation: async (token: string, acceptData: { name: string; password: string }) => {
    const { data } = await client.post(`/invitations/accept/${token}`, acceptData)
    return data
  },

  // Business Units (Razones Sociales)
  getBusinessUnits: async () => {
    const { data } = await client.get('/business-units')
    return data
  },
  getBusinessUnit: async (id: string) => {
    const { data } = await client.get(`/business-units/${id}`)
    return data
  },
  getDefaultBusinessUnit: async () => {
    const { data } = await client.get('/business-units/default')
    return data
  },
  createBusinessUnit: async (buData: any) => {
    const { data } = await client.post('/business-units', buData)
    return data
  },
  updateBusinessUnit: async (id: string, buData: any) => {
    const { data } = await client.patch(`/business-units/${id}`, buData)
    return data
  },
  deleteBusinessUnit: async (id: string) => {
    const { data } = await client.delete(`/business-units/${id}`)
    return data
  },

  // Payment Applications (Cobro ↔ Factura N:N)
  linkCobroToInvoice: async (cobroId: string, invoiceId: string, amountApplied: number, notes?: string) => {
    const { data } = await client.post(`/payment-applications/cobros/${cobroId}/link`, {
      invoice_id: invoiceId,
      amount_applied: amountApplied,
      notes,
    })
    return data
  },
  unlinkCobroFromInvoice: async (cobroId: string, invoiceId: string) => {
    const { data } = await client.delete(`/payment-applications/cobros/${cobroId}/unlink`, {
      data: { invoice_id: invoiceId },
    })
    return data
  },
  getCobroApplications: async (cobroId: string) => {
    const { data } = await client.get(`/payment-applications/cobros/${cobroId}/applications`)
    return data
  },
  getCobroBalance: async (cobroId: string) => {
    const { data } = await client.get(`/payment-applications/cobros/${cobroId}/balance`)
    return data
  },
  getInvoiceCobros: async (invoiceId: string) => {
    const { data } = await client.get(`/payment-applications/invoices/${invoiceId}/cobros`)
    return data
  },
  getInvoiceBalance: async (invoiceId: string) => {
    const { data } = await client.get(`/payment-applications/invoices/${invoiceId}/balance`)
    return data
  },
  getPendingCobros: async (filters?: { enterprise_id?: string; business_unit_id?: string }) => {
    const { data } = await client.get('/payment-applications/pending-cobros', { params: filters })
    return data
  },
  getAvailableInvoicesForLinking: async (filters?: { enterprise_id?: string; business_unit_id?: string }) => {
    const { data } = await client.get('/payment-applications/available-invoices', { params: filters })
    return data
  },
  getOrderRemainingToInvoice: async (orderId: string) => {
    const { data } = await client.get(`/invoices/order/${orderId}/remaining`)
    return data
  },
  getInvoicesByOrder: async (orderId: string) => {
    const { data } = await client.get(`/invoices/order/${orderId}/invoices`)
    return data
  },

  // Purchase Invoices (Facturas de Compra)
  getPurchaseInvoices: async (filters?: any) => {
    const { data } = await client.get('/purchase-invoices', { params: filters })
    return data
  },
  getPurchaseInvoice: async (id: string) => {
    const { data } = await client.get(`/purchase-invoices/${id}`)
    return data
  },
  createPurchaseInvoice: async (piData: any) => {
    const { data } = await client.post('/purchase-invoices', piData)
    return data
  },
  updatePurchaseInvoice: async (id: string, piData: any) => {
    const { data } = await client.patch(`/purchase-invoices/${id}`, piData)
    return data
  },
  deletePurchaseInvoice: async (id: string) => {
    const { data } = await client.delete(`/purchase-invoices/${id}`)
    return data
  },
  getPurchaseInvoiceBalance: async (id: string) => {
    const { data } = await client.get(`/purchase-invoices/${id}/balance`)
    return data
  },
  getPurchaseInvoiceItems: async (id: string) => {
    const { data } = await client.get(`/purchase-invoices/${id}/items`)
    return data
  },
  getAvailableOrderItemsForInvoicing: async (filters?: { enterprise_id?: string }) => {
    const { data } = await client.get('/invoices/available-order-items', { params: filters })
    return data
  },
  getAvailablePurchaseItemsForInvoicing: async (filters?: { enterprise_id?: string }) => {
    const { data } = await client.get('/purchase-invoices/available-purchase-items', { params: filters })
    return data
  },
  getInvoiceItemsWithRemaining: async (invoiceId: string) => {
    const { data } = await client.get(`/invoices/${invoiceId}/items-remaining`)
    return data
  },
  getPurchaseInvoicesByPurchase: async (purchaseId: string) => {
    const { data } = await client.get(`/purchase-invoices/by-purchase/${purchaseId}`)
    return data
  },

  // Pago Applications (Pago ↔ Factura Compra N:N)
  linkPagoToPurchaseInvoice: async (pagoId: string, purchaseInvoiceId: string, amountApplied: number) => {
    const { data } = await client.post(`/pago-applications/pagos/${pagoId}/link`, {
      purchase_invoice_id: purchaseInvoiceId,
      amount_applied: amountApplied,
    })
    return data
  },
  unlinkPagoFromPurchaseInvoice: async (pagoId: string, purchaseInvoiceId: string) => {
    const { data } = await client.delete(`/pago-applications/pagos/${pagoId}/unlink`, {
      data: { purchase_invoice_id: purchaseInvoiceId },
    })
    return data
  },
  getPagoApplications: async (pagoId: string) => {
    const { data } = await client.get(`/pago-applications/pagos/${pagoId}/applications`)
    return data
  },
  getPurchaseInvoicePagos: async (purchaseInvoiceId: string) => {
    const { data } = await client.get(`/pago-applications/purchase-invoices/${purchaseInvoiceId}/pagos`)
    return data
  },
  getPendingPagos: async (filters?: { enterprise_id?: string; business_unit_id?: string }) => {
    const { data } = await client.get('/pago-applications/pending-pagos', { params: filters })
    return data
  },
  getAvailablePurchaseInvoicesForLinking: async (filters?: { enterprise_id?: string; business_unit_id?: string }) => {
    const { data } = await client.get('/pago-applications/available-purchase-invoices', { params: filters })
    return data
  },

  // Cheque Endorsement
  endorseCheque: async (chequeId: string, endorseData: { enterprise_id: string; amount: number; purchase_invoice_id?: string; notes?: string }) => {
    const { data } = await client.post(`/cheques/${chequeId}/endorse`, endorseData)
    return data
  },
  getChequesForEndorsement: async (businessUnitId?: string) => {
    const { data } = await client.get('/cheques/for-endorsement', { params: businessUnitId ? { business_unit_id: businessUnitId } : {} })
    return data
  },

  // Enterprises
  getEnterprises: async () => {
    const { data } = await client.get('/enterprises')
    return data
  },
  getEnterprise: async (id: string) => {
    const { data } = await client.get(`/enterprises/${id}`)
    return data
  },
  createEnterprise: async (enterpriseData: any) => {
    const { data } = await client.post('/enterprises', enterpriseData)
    return data
  },
  updateEnterprise: async (id: string, enterpriseData: any) => {
    const { data } = await client.put(`/enterprises/${id}`, enterpriseData)
    return data
  },
  deleteEnterprise: async (id: string) => {
    const { data } = await client.delete(`/enterprises/${id}`)
    return data
  },

  // Products
  getProducts: async (filters?: { skip?: number; limit?: number; search?: string; stock_status?: string; category_id?: string; product_type?: string; active?: string }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/products?${params.toString()}`)
    return data
  },
  createProduct: async (productData: any) => {
    const { data } = await client.post('/products', productData)
    return data
  },
  getProduct: async (id: string) => {
    const { data } = await client.get(`/products/${id}`)
    return data
  },
  updateProduct: async (id: string, productData: any) => {
    const { data } = await client.put(`/products/${id}`, productData)
    return data
  },
  deleteProduct: async (id: string) => {
    const { data } = await client.delete(`/products/${id}`)
    return data
  },
  duplicateProduct: async (id: string) => {
    const { data } = await client.post(`/products/${id}/duplicate`)
    return data
  },
  getProductTypes: async () => {
    const { data } = await client.get('/products/types')
    return data
  },
  createProductType: async (typeData: { name: string; description?: string }) => {
    const { data } = await client.post('/products/types', typeData)
    return data
  },
  updateProductType: async (id: string, typeData: { name?: string; description?: string; sort_order?: number }) => {
    const { data } = await client.put(`/products/types/${id}`, typeData)
    return data
  },
  deleteProductType: async (id: string) => {
    const { data } = await client.delete(`/products/types/${id}`)
    return data
  },
  reorderProductTypes: async (orderedIds: string[]) => {
    const { data } = await client.post('/products/types/reorder', { ordered_ids: orderedIds })
    return data
  },
  getCategoryTree: async (filters?: { search?: string; stock_status?: string }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/products/category-tree?${params.toString()}`)
    return data
  },
  getProductsByCategory: async (filters: { category_id: string; skip?: number; limit?: number; search?: string; stock_status?: string }) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
    })
    const { data } = await client.get(`/products/by-category?${params.toString()}`)
    return data
  },
  getCategories: async () => {
    const { data } = await client.get('/products/categories')
    return data
  },
  createCategory: async (catData: { name: string; description?: string; parent_id?: string; default_vat_rate?: number; default_margin_percent?: number; color?: string }) => {
    const { data } = await client.post('/products/categories', catData)
    return data
  },
  updateCategory: async (id: string, catData: any) => {
    const { data } = await client.put(`/products/categories/${id}`, catData)
    return data
  },
  reorderCategories: async (orderedIds: string[]) => {
    const { data } = await client.post('/products/categories/reorder', { ordered_ids: orderedIds })
    return data
  },
  getCategoryDefaults: async (id: string) => {
    const { data } = await client.get(`/products/categories/${id}/defaults`)
    return data
  },
  deleteCategory: async (id: string) => {
    const { data } = await client.delete(`/products/categories/${id}`)
    return data
  },
  bulkUpdatePrice: async (productIds: string[], percent: number) => {
    const { data } = await client.post('/products/bulk-price', { product_ids: productIds, percent })
    return data
  },
  bulkPricePreview: async (productIds: string[], percent: number) => {
    const { data } = await client.post('/products/bulk-price-preview', { product_ids: productIds, percent })
    return data
  },

  // Price Lists
  getPriceLists: async () => { const { data } = await client.get('/price-lists'); return data },
  getPriceList: async (id: string) => { const { data } = await client.get(`/price-lists/${id}`); return data },
  createPriceList: async (listData: any) => { const { data } = await client.post('/price-lists', listData); return data },
  updatePriceList: async (id: string, listData: any) => { const { data } = await client.put(`/price-lists/${id}`, listData); return data },
  deletePriceList: async (id: string) => { const { data } = await client.delete(`/price-lists/${id}`); return data },
  setPriceListItems: async (id: string, items: any[]) => { const { data } = await client.put(`/price-lists/${id}/items`, { items }); return data },
  getEnterprisePriceForProduct: async (enterpriseId: string, productId: string) => { const { data } = await client.get(`/price-lists/enterprise-price/${enterpriseId}/${productId}`); return data },
  linkEnterpriseToPriceList: async (enterpriseId: string, priceListId: string) => { const { data } = await client.put(`/price-lists/link-enterprise/${enterpriseId}`, { price_list_id: priceListId }); return data },

  // Price List Rules
  getPriceListRules: async (id: string) => { const { data } = await client.get(`/price-lists/${id}/rules`); return data },
  addPriceListRule: async (id: string, ruleData: any) => { const { data } = await client.post(`/price-lists/${id}/rules`, ruleData); return data },
  updatePriceListRule: async (id: string, ruleId: string, ruleData: any) => { const { data } = await client.put(`/price-lists/${id}/rules/${ruleId}`, ruleData); return data },
  deletePriceListRule: async (id: string, ruleId: string) => { const { data } = await client.delete(`/price-lists/${id}/rules/${ruleId}`); return data },

  // Price Resolution
  resolvePrice: async (params: { enterprise_id?: string; product_id: string; quantity?: number; price_list_id?: string }) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, String(v)) })
    const { data } = await client.get(`/price-lists/resolve?${qs.toString()}`)
    return data
  },
  resolveAllPrices: async (id: string, quantity?: number) => {
    const qs = quantity ? `?quantity=${quantity}` : ''
    const { data } = await client.get(`/price-lists/${id}/resolved-prices${qs}`)
    return data
  },

  // Bulk operations on price lists
  bulkUpdatePriceListRules: async (id: string, operation: any) => {
    const { data } = await client.post(`/price-lists/${id}/bulk`, operation)
    return data
  },

  // Price History
  getPriceHistory: async (productId: string, limit?: number, offset?: number) => {
    const qs = new URLSearchParams()
    if (limit) qs.append('limit', String(limit))
    if (offset) qs.append('offset', String(offset))
    const { data } = await client.get(`/price-lists/price-history/${productId}?${qs.toString()}`)
    return data
  },

  // Quantity tiers
  getQuantityTiers: async (priceListId: string, productId: string) => {
    const { data } = await client.get(`/price-lists/quantity-tiers?price_list_id=${priceListId}&product_id=${productId}`)
    return data
  },

  // Bulk operations with history
  bulkUpdatePriceWithHistory: async (productIds: string[], percent: number) => {
    const { data } = await client.post('/price-lists/bulk-update-with-history', { product_ids: productIds, percent })
    return data
  },
  getRecentBulkOperations: async () => {
    const { data } = await client.get('/price-lists/bulk-operations')
    return data
  },
  undoBulkOperation: async (operationId: string) => {
    const { data } = await client.post(`/price-lists/bulk-operations/${operationId}/undo`)
    return data
  },

  // Import supplier prices
  importSupplierPrices: async (items: { sku: string; new_cost: number }[]) => {
    const { data } = await client.post('/price-lists/import-supplier-prices', { items })
    return data
  },

  // Price Criteria
  getPriceCriteria: async () => {
    const { data } = await client.get('/price-criteria')
    return data
  },
  createPriceCriteria: async (name: string) => {
    const { data } = await client.post('/price-criteria', { name })
    return data
  },
  deletePriceCriteria: async (id: string) => {
    const { data } = await client.delete(`/price-criteria/${id}`)
    return data
  },
  getProductPrices: async (productId: string) => {
    const { data } = await client.get(`/products/${productId}/prices`)
    return data
  },
  setProductPrices: async (productId: string, prices: Record<string, number>) => {
    const { data } = await client.put(`/products/${productId}/prices`, { prices })
    return data
  },

  // Product Components (BOM)
  getProductComponents: async (productId: string) => {
    const { data } = await client.get(`/products/${productId}/components`)
    return data
  },
  addProductComponent: async (productId: string, componentData: any) => {
    const { data } = await client.post(`/products/${productId}/components`, componentData)
    return data
  },
  updateProductComponent: async (productId: string, componentId: string, updateData: any) => {
    const { data } = await client.put(`/products/${productId}/components/${componentId}`, updateData)
    return data
  },
  removeProductComponent: async (productId: string, componentId: string) => {
    const { data } = await client.delete(`/products/${productId}/components/${componentId}`)
    return data
  },
  getProductBOMCost: async (productId: string) => {
    const { data } = await client.get(`/products/${productId}/bom-cost`)
    return data
  },
  getProductBOMAvailability: async (productId: string, quantity: number) => {
    const { data } = await client.get(`/products/${productId}/bom-availability?quantity=${quantity}`)
    return data
  },
  getProductsUsingComponent: async (productId: string) => {
    const { data } = await client.get(`/products/${productId}/used-in`)
    return data
  },

  // Materials
  getMaterials: async (search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    const { data } = await client.get(`/materials${params}`)
    return data
  },
  getMaterial: async (id: string) => {
    const { data } = await client.get(`/materials/${id}`)
    return data
  },
  createMaterial: async (materialData: any) => {
    const { data } = await client.post('/materials', materialData)
    return data
  },
  updateMaterial: async (id: string, materialData: any) => {
    const { data } = await client.put(`/materials/${id}`, materialData)
    return data
  },
  deleteMaterial: async (id: string) => {
    const { data } = await client.delete(`/materials/${id}`)
    return data
  },
  adjustMaterialStock: async (id: string, adjustData: { quantity_change: number; reason: string }) => {
    const { data } = await client.post(`/materials/${id}/adjust-stock`, adjustData)
    return data
  },
  getMaterialMovements: async (id: string) => {
    const { data } = await client.get(`/materials/${id}/movements`)
    return data
  },
  getProductMaterials: async (productId: string) => {
    const { data } = await client.get(`/materials/product/${productId}/materials`)
    return data
  },
  setProductMaterials: async (productId: string, materials: any[]) => {
    const { data } = await client.put(`/materials/product/${productId}/materials`, { materials })
    return data
  },
  getProductMaterialBOMCost: async (productId: string) => {
    const { data } = await client.get(`/materials/product/${productId}/bom-cost`)
    return data
  },
  checkMaterialAvailability: async (productId: string, quantity: number) => {
    const { data } = await client.get(`/materials/product/${productId}/availability?quantity=${quantity}`)
    return data
  },

  // Purchases
  getPurchases: async (filters?: any) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/purchases?${params.toString()}`)
    return data
  },
  getPurchase: async (id: string) => {
    const { data } = await client.get(`/purchases/${id}`)
    return data
  },
  createPurchase: async (purchaseData: any) => {
    const { data } = await client.post('/purchases', purchaseData)
    return data
  },
  updatePurchase: async (id: string, data: any) => {
    const { data: result } = await client.put(`/purchases/${id}`, data)
    return result
  },
  updatePurchasePaymentStatus: async (id: string, payment_status: string) => {
    const { data } = await client.put(`/purchases/${id}/payment-status`, { payment_status })
    return data
  },
  deletePurchase: async (id: string) => {
    const { data } = await client.delete(`/purchases/${id}`)
    return data
  },

  // Customers
  getCustomers: async () => {
    const { data } = await client.get('/customers')
    return data
  },
  createCustomer: async (customerData: any) => {
    const { data } = await client.post('/customers', customerData)
    return data
  },
  getCustomer: async (id: string) => {
    const { data } = await client.get(`/customers/${id}`)
    return data
  },
  updateCustomer: async (id: string, customerData: any) => {
    const { data } = await client.put(`/customers/${id}`, customerData)
    return data
  },
  deleteCustomer: async (id: string) => {
    const { data } = await client.delete(`/customers/${id}`)
    return data
  },

  // Invoices
  getInvoices: async (filters?: any) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/invoices?${params.toString()}`)
    return data
  },
  createInvoice: async (invoiceData: any) => {
    const { data } = await client.post('/invoices', invoiceData)
    return data
  },
  importInvoice: async (importData: any) => {
    const { data } = await client.post('/invoices/import', importData)
    return data
  },
  getInvoice: async (id: string) => {
    const { data } = await client.get(`/invoices/${id}`)
    return data
  },
  updateDraftInvoice: async (id: string, updateData: any) => {
    const { data } = await client.put(`/invoices/${id}`, updateData)
    return data
  },
  deleteDraftInvoice: async (id: string) => {
    const { data } = await client.delete(`/invoices/${id}`)
    return data
  },
  authorizeInvoice: async (id: string, puntoVenta: number = 3, condicionIvaReceptorId?: number) => {
    const { data } = await client.post(`/invoices/${id}/authorize`, {
      punto_venta: puntoVenta,
      condicion_iva_receptor_id: condicionIvaReceptorId,
    })
    return data
  },
  downloadInvoicePdf: async (invoiceId: string): Promise<Blob> => {
    const response = await client.get(`/pdf/invoice/${invoiceId}`, { responseType: 'blob' })
    return response.data
  },
  linkOrderToInvoice: async (invoiceId: string, orderId: string) => {
    const { data } = await client.post(`/invoices/${invoiceId}/link-order`, { order_id: orderId })
    return data
  },
  unlinkOrderFromInvoice: async (invoiceId: string) => {
    const { data } = await client.delete(`/invoices/${invoiceId}/link-order`)
    return data
  },

  // Reports
  getDashboard: async (dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams()
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const qs = params.toString()
    const { data } = await client.get(`/reports/dashboard${qs ? `?${qs}` : ''}`)
    return data
  },
  getSalesReport: async (days: number = 7) => {
    const { data } = await client.get(`/reports/sales?days=${days}`)
    return data
  },
  getTopProducts: async () => {
    const { data } = await client.get('/reports/top-products')
    return data
  },
  getInsights: async () => {
    const { data } = await client.get('/reports/insights')
    return data
  },
  getAgingReport: async () => {
    const { data } = await client.get('/reports/aging')
    return data
  },
  getLibroIVAVentas: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/libro-iva-ventas', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getLibroIVACompras: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/libro-iva-compras', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getPosicionIVA: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/posicion-iva', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getFlujoCaja: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/flujo-caja', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  // Business Intelligence Reports
  getBusinessVentas: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/business/ventas', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getBusinessRentabilidad: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/business/rentabilidad', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getBusinessClientes: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/business/clientes', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getBusinessCobranzas: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/business/cobranzas', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  getBusinessInventario: async () => {
    const { data } = await client.get('/reports/business/inventario')
    return data
  },
  getBusinessConversion: async (dateFrom: string, dateTo: string) => {
    const { data } = await client.get('/reports/business/conversion', { params: { date_from: dateFrom, date_to: dateTo } })
    return data
  },
  globalSearch: async (query: string) => {
    const { data } = await client.get(`/reports/search?q=${encodeURIComponent(query)}`)
    return data
  },

  // Cobros (money in)
  getCobros: async (filters?: any) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/cobros?${params.toString()}`)
    return data
  },
  createCobro: async (cobroData: any) => {
    const { data } = await client.post('/cobros', cobroData)
    return data
  },
  deleteCobro: async (id: string) => {
    const { data } = await client.delete(`/cobros/${id}`)
    return data
  },
  getCobrosSummary: async () => {
    const { data } = await client.get('/cobros/summary')
    return data
  },
  getOrderPaymentDetails: async (orderId: string) => {
    const { data } = await client.get(`/cobros/order/${orderId}/payment-details`)
    return data
  },
  getCobroReceipt: async (id: string) => {
    const { data } = await client.get(`/cobros/${id}/receipt`)
    return data
  },

  // Receipts (recibos)
  getReceipts: async () => {
    const { data } = await client.get('/receipts')
    return data
  },
  createReceipt: async (receiptData: any) => {
    const { data } = await client.post('/receipts', receiptData)
    return data
  },
  deleteReceipt: async (id: string) => {
    const { data } = await client.delete(`/receipts/${id}`)
    return data
  },

  // Recurring Invoices (Facturas recurrentes / abonos)
  getRecurringInvoices: async () => {
    const { data } = await client.get('/recurring-invoices')
    return data
  },
  createRecurringInvoice: async (invoiceData: any) => {
    const { data } = await client.post('/recurring-invoices', invoiceData)
    return data
  },
  updateRecurringInvoice: async (id: string, invoiceData: any) => {
    const { data } = await client.put(`/recurring-invoices/${id}`, invoiceData)
    return data
  },
  deactivateRecurringInvoice: async (id: string) => {
    const { data } = await client.post(`/recurring-invoices/${id}/deactivate`)
    return data
  },
  deleteRecurringInvoice: async (id: string) => {
    const { data } = await client.delete(`/recurring-invoices/${id}`)
    return data
  },

  // Integrations
  getIntegrations: async () => {
    const { data } = await client.get('/integrations')
    return data
  },
  createIntegration: async (integrationData: any) => {
    const { data } = await client.post('/integrations', integrationData)
    return data
  },
  updateIntegration: async (id: string, integrationData: any) => {
    const { data } = await client.put(`/integrations/${id}`, integrationData)
    return data
  },
  deleteIntegration: async (id: string) => {
    const { data } = await client.delete(`/integrations/${id}`)
    return data
  },

  // Reminders
  getReminderConfig: async () => {
    const { data } = await client.get('/reminders/config')
    return data
  },
  updateReminderConfig: async (configData: any) => {
    const { data } = await client.put('/reminders/config', configData)
    return data
  },
  getReminders: async () => {
    const { data } = await client.get('/reminders')
    return data
  },
  getOverdueInvoices: async () => {
    const { data } = await client.get('/reminders/overdue')
    return data
  },

  // Payment links (MercadoPago)
  generatePaymentLink: async (invoiceId: string) => {
    const { data } = await client.post(`/invoices/${invoiceId}/payment-link`)
    return data
  },

  // Tags
  getTags: async () => {
    const { data } = await client.get('/tags')
    return data
  },
  createTag: async (tagData: { name: string; color?: string }) => {
    const { data } = await client.post('/tags', tagData)
    return data
  },
  updateTag: async (id: string, tagData: { name?: string; color?: string }) => {
    const { data } = await client.put(`/tags/${id}`, tagData)
    return data
  },
  deleteTag: async (id: string) => {
    const { data } = await client.delete(`/tags/${id}`)
    return data
  },
  assignTag: async (entity_id: string, entity_type: string, tag_id: string) => {
    const { data } = await client.post('/tags/assign', { entity_id, entity_type, tag_id })
    return data
  },
  removeTag: async (entity_id: string, entity_type: string, tag_id: string) => {
    const { data } = await client.post('/tags/remove', { entity_id, entity_type, tag_id })
    return data
  },

  // Pagos (money out)
  getPagos: async (filters?: any) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/pagos?${params.toString()}`)
    return data
  },
  createPago: async (pagoData: any) => {
    const { data } = await client.post('/pagos', pagoData)
    return data
  },
  deletePago: async (id: string) => {
    const { data } = await client.delete(`/pagos/${id}`)
    return data
  },
  getPagosSummary: async () => {
    const { data } = await client.get('/pagos/summary')
    return data
  },

  // Inventory
  getInventory: async () => {
    const { data } = await client.get('/inventory')
    return data
  },
  getStockMovements: async (filters?: { skip?: number; limit?: number; product_id?: string }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/inventory/movements?${params.toString()}`)
    return data
  },
  createInventoryMovement: async (movementData: any) => {
    const { data } = await client.post('/inventory/movements', movementData)
    return data
  },
  getLowStock: async () => {
    const { data } = await client.get('/inventory/low-stock')
    return data
  },
  adjustStock: async (adjustData: { product_id: string; warehouse_id?: string; quantity_change: number; reason: string }) => {
    const { data: result } = await client.post('/inventory/adjust', adjustData)
    return result
  },
  addStockFromPurchase: async (purchaseId: string, items: { product_id: string; quantity: number }[]) => {
    const { data: result } = await client.post('/inventory/from-purchase', { purchase_id: purchaseId, items })
    return result
  },

  // Orders
  getOrders: async (filters?: any) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/orders?${params.toString()}`)
    return data
  },
  createOrder: async (orderData: any) => {
    const { data } = await client.post('/orders', orderData)
    return data
  },
  getOrder: async (id: string) => {
    const { data } = await client.get(`/orders/${id}`)
    return data
  },
  updateOrder: async (id: string, orderData: any) => {
    const { data } = await client.put(`/orders/${id}`, orderData)
    return data
  },
  updateOrderStatus: async (id: string, statusData: any) => {
    const { data } = await client.post(`/orders/${id}/status`, statusData)
    return data
  },
  linkInvoiceToOrder: async (orderId: string, invoiceId: string) => {
    const { data } = await client.post(`/orders/${orderId}/link-invoice`, { invoice_id: invoiceId })
    return data
  },
  deleteOrder: async (id: string) => {
    const { data } = await client.delete(`/orders/${id}`)
    return data
  },
  getOrdersWithoutInvoice: async () => {
    const { data } = await client.get('/orders/without-invoice')
    return data
  },
  getOrderInvoicingStatus: async (orderId: string) => {
    const { data } = await client.get(`/orders/${orderId}/invoicing-status`)
    return data
  },
  getOrderUninvoicedItems: async (orderId: string) => {
    const { data } = await client.get(`/orders/${orderId}/uninvoiced-items`)
    return data
  },
  checkOrderBOM: async (orderId: string) => {
    const { data } = await client.get(`/orders/${orderId}/bom-check`)
    return data
  },

  // Quotes
  getQuotes: async (filters?: Record<string, any>) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/quotes?${params.toString()}`)
    return data
  },
  createQuote: async (quoteData: any) => {
    const { data } = await client.post('/quotes', quoteData)
    return data
  },
  getQuote: async (id: string) => {
    const { data } = await client.get(`/quotes/${id}`)
    return data
  },
  getQuotePdf: async (id: string, template?: string, bannerUrl?: string): Promise<Blob> => {
    const params: Record<string, string> = {}
    if (template) params.template = template
    if (bannerUrl) params.banner_url = bannerUrl
    const response = await client.get(`/quotes/${id}/pdf`, { responseType: 'blob', params })
    return response.data
  },
  updateQuote: async (id: string, quoteData: any) => {
    const { data } = await client.put(`/quotes/${id}`, quoteData)
    return data
  },
  updateQuoteStatus: async (id: string, status: string) => {
    const { data } = await client.put(`/quotes/${id}/status`, { status })
    return data
  },
  uploadQuoteBanner: async (base64: string, mimeType: string) => {
    const { data } = await client.post('/quotes/banner', { base64, mime_type: mimeType })
    return data
  },
  getQuoteBanner: async () => {
    const { data } = await client.get('/quotes/banner')
    return data
  },
  deleteQuoteBanner: async () => {
    const { data } = await client.delete('/quotes/banner')
    return data
  },

  // Cheques
  getCheques: async (filters?: { status?: string; search?: string; due_from?: string; due_to?: string }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.append('status', filters.status)
    if (filters?.search) params.append('search', filters.search)
    if (filters?.due_from) params.append('due_from', filters.due_from)
    if (filters?.due_to) params.append('due_to', filters.due_to)
    const { data } = await client.get(`/cheques?${params}`)
    return data
  },
  createCheque: async (chequeData: any) => {
    const { data } = await client.post('/cheques', chequeData)
    return data
  },
  updateCheque: async (id: string, data: any) => {
    const { data: result } = await client.put(`/cheques/${id}`, data)
    return result
  },
  deleteCheque: async (id: string) => {
    const { data } = await client.delete(`/cheques/${id}`)
    return data
  },
  updateChequeStatus: async (id: string, status: string) => {
    const { data } = await client.put(`/cheques/${id}/status`, { status })
    return data
  },
  getChequeHistory: async (id: string) => {
    const { data } = await client.get(`/cheques/${id}/history`)
    return data
  },
  getChequesSummary: async () => {
    const { data } = await client.get('/cheques/summary')
    return data
  },

  // Remitos
  getRemitos: async (filters?: any) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/remitos?${params.toString()}`)
    return data
  },
  getRemito: async (id: string) => {
    const { data } = await client.get(`/remitos/${id}`)
    return data
  },
  createRemito: async (remitoData: any) => {
    const { data } = await client.post('/remitos', remitoData)
    return data
  },
  updateRemito: async (id: string, remitoData: any) => {
    const { data } = await client.put(`/remitos/${id}`, remitoData)
    return data
  },
  getRemitoPdf: async (id: string): Promise<Blob> => {
    const response = await client.get(`/remitos/${id}/pdf`, { responseType: 'blob' })
    return response.data
  },
  updateRemitoStatus: async (id: string, status: string) => {
    const { data } = await client.put(`/remitos/${id}/status`, { status })
    return data
  },
  deleteRemito: async (id: string) => {
    const { data } = await client.delete(`/remitos/${id}`)
    return data
  },
  uploadSignedRemitoPdf: async (id: string, base64: string) => {
    const { data } = await client.post(`/remitos/${id}/signed-pdf`, { base64 })
    return data
  },
  getSignedRemitoPdf: async (id: string) => {
    const { data } = await client.get(`/remitos/${id}/signed-pdf`)
    return data
  },

  // Cuenta Corriente
  getCuentaCorrienteResumen: async () => {
    const { data } = await client.get('/cuenta-corriente')
    return data
  },
  getCuentaCorrienteDetalle: async (enterpriseId: string) => {
    const { data } = await client.get(`/cuenta-corriente/${enterpriseId}`)
    return data
  },
  downloadCuentaCorrientePdf: async (enterpriseId: string, dateFrom: string, dateTo: string): Promise<Blob> => {
    const response = await client.get(`/cuenta-corriente/${enterpriseId}/pdf`, {
      params: { date_from: dateFrom, date_to: dateTo },
      responseType: 'blob',
    })
    return response.data
  },
  createCuentaCorrienteAdjustment: async (enterpriseId: string, data: { amount: number; reason: string; adjustment_type: 'credit' | 'debit' }) => {
    const { data: result } = await client.post(`/cuenta-corriente/${enterpriseId}/adjustment`, data)
    return result
  },
  getCuentaCorrienteAdjustments: async (enterpriseId: string) => {
    const { data } = await client.get(`/cuenta-corriente/${enterpriseId}/adjustments`)
    return data
  },
  deleteCuentaCorrienteAdjustment: async (enterpriseId: string, adjustmentId: string) => {
    const { data } = await client.delete(`/cuenta-corriente/${enterpriseId}/adjustment/${adjustmentId}`)
    return data
  },

  // Banks
  getBanks: async () => {
    const { data } = await client.get('/banks')
    return data
  },
  createBank: async (bankData: any) => {
    const { data } = await client.post('/banks', bankData)
    return data
  },
  updateBank: async (id: string, bankData: any) => {
    const { data } = await client.put(`/banks/${id}`, bankData)
    return data
  },
  deleteBank: async (id: string) => {
    const { data } = await client.delete(`/banks/${id}`)
    return data
  },
  getBankBreakdown: async () => {
    const { data } = await client.get('/banks/breakdown')
    return data
  },
  getBankBalances: async () => {
    const { data } = await client.get('/banks/balances')
    return data
  },
  getBankMovements: async (bankId: string, filters?: { date_from?: string; date_to?: string }) => {
    const params = new URLSearchParams()
    if (filters?.date_from) params.append('date_from', filters.date_from)
    if (filters?.date_to) params.append('date_to', filters.date_to)
    const { data } = await client.get(`/banks/${bankId}/movements?${params}`)
    return data
  },
  getBankMethodTransactions: async (bankId: string, method: string) => {
    const { data } = await client.get(`/banks/${bankId}/method/${method}/transactions`)
    return data
  },

  // Companies
  getMyCompany: async (): Promise<Company> => {
    const { data } = await client.get<Company>('/companies/me')
    return data
  },
  updateMyCompany: async (companyData: any): Promise<Company> => {
    const { data } = await client.put<Company>('/companies/me', companyData)
    return data
  },

  // AFIP
  uploadAfipCertificates: async (cert: string, key: string) => {
    const { data } = await client.post('/companies/me/certificates', { cert, key })
    return data
  },
  removeAfipCertificates: async () => {
    const { data } = await client.delete('/companies/me/certificates')
    return data
  },
  testAfipConnection: async () => {
    const { data } = await client.get('/afip/test-connection')
    return data
  },
  getLastAfipVoucher: async (puntoVenta: number = 1, invoiceType: string = 'B') => {
    const { data } = await client.get(`/afip/last-voucher?punto_venta=${puntoVenta}&invoice_type=${invoiceType}`)
    return data
  },

  // Users
  getUsers: async () => {
    const { data } = await client.get('/users')
    return data.users
  },
  getUser: async (id: string) => {
    const { data } = await client.get(`/users/${id}`)
    return data.user
  },
  createUser: async (userData: any) => {
    const { data } = await client.post('/users', userData)
    return data.user
  },
  updateUser: async (id: string, userData: any) => {
    const { data } = await client.put(`/users/${id}`, userData)
    return data.user
  },
  deleteUser: async (id: string) => {
    const { data } = await client.delete(`/users/${id}`)
    return data
  },
  getUserPermissions: async (id: string) => {
    const { data } = await client.get(`/users/${id}/permissions`)
    return data.permissions
  },
  setUserPermissions: async (id: string, permissions: Record<string, string[]>) => {
    const { data } = await client.put(`/users/${id}/permissions`, { permissions })
    return data.permissions
  },
  applyTemplate: async (id: string, template: string) => {
    const { data } = await client.post(`/users/${id}/apply-template`, { template })
    return data.permissions
  },
  resetUserPassword: async (id: string, password: string) => {
    const { data } = await client.post(`/users/${id}/reset-password`, { password })
    return data
  },

  // Role templates
  getRoleTemplates: async () => {
    const { data } = await client.get('/users/roles')
    return data.templates
  },
  updateRoleTemplate: async (roleName: string, permissions: Record<string, string[]>, description?: string) => {
    const { data } = await client.put(`/users/roles/${roleName}`, { permissions, description })
    return data.template
  },
  applyRoleToAllUsers: async (roleName: string) => {
    const { data } = await client.post(`/users/roles/${roleName}/apply-all`)
    return data
  },

  // Transfer ownership (owner only)
  transferOwnership: async (newOwnerId: string) => {
    const { data } = await client.post('/users/transfer-ownership', { new_owner_id: newOwnerId })
    return data
  },

  // Session management
  getUserSessions: async (userId: string) => {
    const { data } = await client.get(`/users/${userId}/sessions`)
    return data.sessions
  },
  revokeSession: async (userId: string, sessionId: string) => {
    const { data } = await client.delete(`/users/${userId}/sessions/${sessionId}`)
    return data
  },
  revokeAllSessions: async (userId: string) => {
    const { data } = await client.post(`/users/${userId}/revoke-all-sessions`)
    return data
  },

  // Audit log
  getAuditLog: async (filters?: { user_id?: string; action?: string; entity_type?: string; date_from?: string; date_to?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/audit?${params.toString()}`)
    return data
  },

  // Activity Logs
  getActivityLogs: async (params: any) => {
    const { data } = await client.get('/activity/logs', { params })
    return data
  },

  // CRM Pipeline
  getCrmDeals: async (filters?: { stage?: string; enterprise_id?: string; priority?: string; search?: string }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/crm/deals?${params.toString()}`)
    return data
  },
  getCrmDealsByStage: async () => {
    const { data } = await client.get('/crm/deals/by-stage')
    return data
  },
  createCrmDeal: async (dealData: any) => {
    const { data } = await client.post('/crm/deals', dealData)
    return data
  },
  updateCrmDeal: async (id: string, dealData: any) => {
    const { data } = await client.put(`/crm/deals/${id}`, dealData)
    return data
  },
  moveCrmDealStage: async (id: string, stage: string) => {
    const { data } = await client.post(`/crm/deals/${id}/move`, { stage })
    return data
  },
  closeCrmDeal: async (id: string, won: boolean, reason?: string) => {
    const { data } = await client.post(`/crm/deals/${id}/close`, { won, reason })
    return data
  },
  deleteCrmDeal: async (id: string) => {
    const { data } = await client.delete(`/crm/deals/${id}`)
    return data
  },
  getCrmActivities: async (filters?: { deal_id?: string; enterprise_id?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, String(val))
      })
    }
    const { data } = await client.get(`/crm/activities?${params.toString()}`)
    return data
  },
  createCrmActivity: async (activityData: any) => {
    const { data } = await client.post('/crm/activities', activityData)
    return data
  },
  getCrmPipelineSummary: async () => {
    const { data } = await client.get('/crm/summary')
    return data
  },
  getCrmCustomerHealth: async () => {
    const { data } = await client.get('/crm/health')
    return data
  },
  bootstrapCrmDeals: async () => {
    const { data } = await client.post('/crm/bootstrap')
    return data
  },

  // CRM Stages
  getCrmStages: async () => {
    const { data } = await client.get('/crm/stages')
    return data
  },
  createCrmStage: async (stage: any) => {
    const { data } = await client.post('/crm/stages', stage)
    return data
  },
  updateCrmStage: async (id: string, stage: any) => {
    const { data } = await client.put(`/crm/stages/${id}`, stage)
    return data
  },
  deleteCrmStage: async (id: string) => {
    const { data } = await client.delete(`/crm/stages/${id}`)
    return data
  },
  reorderCrmStages: async (stages: { id: string; order: number }[]) => {
    const { data } = await client.put('/crm/stages/reorder', { stages })
    return data
  },

  // CRM Deal Documents
  getCrmDealDocuments: async (dealId: string) => {
    const { data } = await client.get(`/crm/deals/${dealId}/documents`)
    return data
  },

  // Export
  exportCompanyData: async () => {
    const { data } = await client.get('/export/company')
    return data
  },

  // Onboarding
  getOnboardingStatus: async () => {
    const { data } = await client.get('/onboarding/status')
    return data
  },
  completeOnboardingStep: async (step: number, stepData: any) => {
    const { data } = await client.put(`/onboarding/step/${step}`, stepData)
    return data
  },
  completeOnboarding: async () => {
    const { data } = await client.post('/onboarding/complete')
    return data
  },
  resetOnboarding: async () => {
    const { data } = await client.post('/onboarding/reset')
    return data
  },
  updateEnabledModules: async (modules: string[]) => {
    const { data } = await client.put('/onboarding/modules', { modules })
    return data
  },
  lookupCUIT: async (cuit: string) => {
    const { data } = await client.post('/onboarding/cuit-lookup', { cuit })
    return data
  },

  // Customer Portal Auth
  customerLogin: async (access_code: string) => {
    const { data } = await client.post('/auth/customer-login', { access_code })
    return data
  },

  // Customer Portal (uses customer token)
  portalGetSummary: async () => {
    const { data } = await portalClient.get('/portal/summary')
    return data
  },
  portalGetOrders: async () => {
    const { data } = await portalClient.get('/portal/orders')
    return data
  },
  portalGetOrder: async (id: string) => {
    const { data } = await portalClient.get(`/portal/orders/${id}`)
    return data
  },
  portalGetInvoices: async () => {
    const { data } = await portalClient.get('/portal/invoices')
    return data
  },
  portalGetQuotes: async () => {
    const { data } = await portalClient.get('/portal/quotes')
    return data
  },
  portalGetQuotePdf: async (id: string): Promise<Blob> => {
    const response = await portalClient.get(`/portal/quotes/${id}/pdf`, { responseType: 'blob' })
    return response.data
  },
  portalGetPublicConfig: async () => {
    const { data } = await portalClient.get('/portal/public-config')
    return data
  },
  portalUpdateQuoteStatus: async (id: string, status: 'accepted' | 'rejected', reason?: string) => {
    const { data } = await portalClient.put(`/portal/quotes/${id}/status`, { status, reason })
    return data
  },
  portalGetRemitos: async () => {
    const { data } = await portalClient.get('/portal/remitos')
    return data
  },

  // Portal Config (admin)
  getPortalConfig: async () => {
    const { data } = await client.get('/portal/config')
    return data
  },
  updatePortalConfig: async (config: Record<string, any>) => {
    const { data } = await client.put('/portal/config', config)
    return data
  },
  getPortalPreviewToken: async () => {
    const { data } = await client.post('/portal/preview-token')
    return data.token
  },

  // Billing & Subscriptions
  getBillingSubscription: async () => {
    const { data } = await client.get('/billing/subscription')
    return data
  },
  getBillingPlans: async () => {
    const { data } = await client.get('/billing/plans')
    return data
  },
  getBillingUsage: async () => {
    const { data } = await client.get('/billing/usage')
    return data
  },
  createBillingSubscription: async (planId: string) => {
    const { data } = await client.post('/billing/create-subscription', { plan_id: planId })
    return data
  },
  cancelBillingSubscription: async () => {
    const { data } = await client.post('/billing/cancel')
    return data
  },
  checkBillingLimits: async (action: string) => {
    const { data } = await client.post('/billing/check-limits', { action })
    return data
  },

  // Superadmin
  adminGetAllCompanies: async (params?: {
    search?: string; plan?: string; status?: string; sortBy?: string; sortDir?: string
  }) => {
    const { data } = await client.get('/admin/companies', { params })
    return data
  },
  adminGetCompanyDetail: async (id: string) => {
    const { data } = await client.get(`/admin/companies/${id}`)
    return data
  },
  adminBlockCompany: async (id: string, category: string, reason: string) => {
    const { data } = await client.post(`/admin/companies/${id}/block`, { category, reason })
    return data
  },
  adminUnblockCompany: async (id: string) => {
    const { data } = await client.post(`/admin/companies/${id}/unblock`)
    return data
  },
  adminDisableCompany: async (id: string, reason: string) => {
    const { data } = await client.post(`/admin/companies/${id}/disable`, { reason })
    return data
  },
  adminEnableCompany: async (id: string) => {
    const { data } = await client.post(`/admin/companies/${id}/enable`)
    return data
  },
  adminImpersonateCompany: async (id: string) => {
    const { data } = await client.post(`/admin/companies/${id}/impersonate`)
    return data
  },
  adminCreateCompany: async (data: {
    name: string; cuit: string; adminEmail: string; adminName: string; plan: string; billingPeriod: string
  }) => {
    const { data: result } = await client.post('/admin/companies', data)
    return result
  },
  adminUpdateCompanyPlan: async (id: string, data: {
    plan?: string; billingPeriod?: string; planOverrides?: Record<string, any>; trialExtensionDays?: number
  }) => {
    const { data: result } = await client.put(`/admin/companies/${id}/plan`, data)
    return result
  },
  adminListBackups: async (id: string) => {
    const { data } = await client.get(`/admin/companies/${id}/backups`)
    return data
  },
  adminRestoreBackup: async (id: string, backupId: string) => {
    const { data } = await client.post(`/admin/companies/${id}/restore`, { backupId })
    return data
  },
  adminGetAuditTrail: async (id: string, limit?: number) => {
    const { data } = await client.get(`/admin/companies/${id}/audit`, { params: { limit } })
    return data
  },
  adminGetBlockReasonCategories: async () => {
    const { data } = await client.get('/admin/block-reasons')
    return data
  },
  adminGetSystemStats: async () => {
    const { data } = await client.get('/admin/stats')
    return data
  },
  adminGetSystemHealth: async () => {
    const { data } = await client.get('/admin/health')
    return data
  },
  adminGetLogs: async (params: any) => {
    const { data } = await client.get('/admin/logs', { params })
    return data
  },
  adminGetLogStats: async () => {
    const { data } = await client.get('/admin/logs/stats')
    return data
  },

  // AI Features (Premium)
  getAiStatus: async () => {
    const { data } = await client.get('/ai/status')
    return data
  },
  aiChat: async (question: string, mode?: 'context' | 'sql') => {
    const { data } = await client.post('/ai/chat', { question, mode: mode || 'context' })
    return data
  },
  getAiInsights: async () => {
    const { data } = await client.get('/ai/insights')
    return data
  },
  generateAiNarrative: async (reportType: string, reportData: any) => {
    const { data } = await client.post('/ai/narrative', { report_type: reportType, report_data: reportData })
    return data
  },

  // SecretarIA (WhatsApp Assistant + In-App Chat)
  secretariaChat: async (message: string) => {
    const { data } = await client.post('/secretaria/chat', { message, type: 'text' })
    return data
  },
  secretariaChatHistory: async (limit?: number) => {
    const params = new URLSearchParams()
    if (limit) params.append('limit', String(limit))
    const { data } = await client.get(`/secretaria/chat/history?${params.toString()}`)
    return data
  },

  getSecretariaConfig: async () => {
    const { data } = await client.get('/secretaria/config')
    return data
  },
  updateSecretariaConfig: async (config: any) => {
    const { data } = await client.put('/secretaria/config', config)
    return data
  },
  generateLinkingCode: async (phoneNumber: string) => {
    const { data } = await client.post('/secretaria/link', { phone_number: phoneNumber })
    return data
  },
  getSecretariaUsage: async () => {
    const { data } = await client.get('/secretaria/usage')
    return data
  },
  getSecretariaConversations: async (limit?: number, offset?: number) => {
    const params = new URLSearchParams()
    if (limit) params.append('limit', String(limit))
    if (offset) params.append('offset', String(offset))
    const { data } = await client.get(`/secretaria/conversations?${params.toString()}`)
    return data
  },
  getLinkedPhones: async () => {
    const { data } = await client.get('/secretaria/linked-phones')
    return data
  },
  unlinkPhone: async (id: string) => {
    const { data } = await client.delete(`/secretaria/linked-phones/${id}`)
    return data
  },
  sendBriefNow: async () => {
    const { data } = await client.post('/secretaria/brief/send')
    return data
  },

  // Account / Legal (Ley 25.326)
  exportMyData: async () => {
    const { data } = await client.get('/account/my-data')
    return data
  },
  requestAccountDeletion: async () => {
    const { data } = await client.delete('/account')
    return data
  },
  getAccountDeletionStatus: async () => {
    const { data } = await client.get('/account/deletion-status')
    return data
  },
}

export default api
