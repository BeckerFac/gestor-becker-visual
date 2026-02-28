import axios from 'axios'

const API_BASE = '/api'

const client = axios.create({
  baseURL: API_BASE,
})

// Agregar token a requests
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export const api = {
  // Auth
  register: (email: string, password: string, name: string, company_name: string, cuit: string) =>
    client.post('/auth/register', { email, password, name, company_name, cuit }),

  login: (email: string, password: string) =>
    client.post('/auth/login', { email, password }),

  getMe: () => client.get('/auth/me'),

  // Products
  getProducts: () => client.get('/products'),
  createProduct: (data: any) => client.post('/products', data),
  getProduct: (id: string) => client.get(`/products/${id}`),
  updateProduct: (id: string, data: any) => client.put(`/products/${id}`, data),
  deleteProduct: (id: string) => client.delete(`/products/${id}`),

  // Customers
  getCustomers: () => client.get('/customers'),
  createCustomer: (data: any) => client.post('/customers', data),
  getCustomer: (id: string) => client.get(`/customers/${id}`),
  updateCustomer: (id: string, data: any) => client.put(`/customers/${id}`, data),
  deleteCustomer: (id: string) => client.delete(`/customers/${id}`),

  // Invoices
  getInvoices: () => client.get('/invoices'),
  createInvoice: (data: any) => client.post('/invoices', data),
  getInvoice: (id: string) => client.get(`/invoices/${id}`),
  authorizeInvoice: (id: string) => client.post(`/invoices/${id}/authorize`, {}),
}

export default api
