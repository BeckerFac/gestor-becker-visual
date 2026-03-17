import { vi } from 'vitest'

// Mock database - all tests run without real DB
export const mockDbExecute = vi.fn()
export const mockPoolQuery = vi.fn()

// Mock drizzle query builder chains
const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockSelectFrom = vi.fn()
const mockInsertValues = vi.fn()
const mockInsertReturning = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockUpdateReturning = vi.fn()
const mockDeleteWhere = vi.fn()

// Build chainable select mock
const mockSelectChain = {
  from: vi.fn(() => ({
    where: vi.fn(() => [{ id: 'session-id', user_id: 'test-user', refresh_token: 'test-token' }]),
  })),
}

// Build chainable insert mock - values returns a thenable so it works both with and without .returning()
const mockInsertChain = {
  values: vi.fn(() => {
    const result = {
      returning: vi.fn(() => [{ id: 'test-id' }]),
      then: (resolve: any) => resolve([{ id: 'test-id' }]),
    }
    return result
  }),
}

// Build chainable update mock
const mockUpdateChain = {
  set: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => [{ id: 'test-id' }]),
    })),
  })),
}

// Build chainable delete mock
const mockDeleteChain = {
  where: vi.fn(() => {}),
}

vi.mock('../../src/config/db', () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
    query: {
      products: { findFirst: mockFindFirst, findMany: mockFindMany },
      customers: { findFirst: vi.fn() },
      invoice_items: { findMany: mockFindMany },
      users: { findFirst: vi.fn() },
      companies: { findFirst: vi.fn() },
    },
    select: vi.fn(() => mockSelectChain),
    insert: vi.fn(() => mockInsertChain),
    update: vi.fn(() => mockUpdateChain),
    delete: vi.fn(() => mockDeleteChain),
    transaction: vi.fn(async (fn: any) => {
      const txMock = {
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(() => [{ id: 'test-id', sku: 'TEST-001', name: 'Test Product' }]),
          })),
        })),
      }
      return fn(txMock)
    }),
  },
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
}))

// Mock uuid to return deterministic values
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => {
    uuidCounter++
    return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`
  },
}))

// Mock drizzle-orm sql template tag and helpers
vi.mock('drizzle-orm', () => {
  const sql = (strings: TemplateStringsArray, ...values: any[]) => ({
    strings,
    values,
    append: (other: any) => other,
  })
  sql.raw = (str: string) => ({ raw: str })
  return {
    sql,
    eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
    and: vi.fn((...args: any[]) => ({ and: args })),
    ilike: vi.fn((a: any, b: any) => ({ ilike: [a, b] })),
    desc: vi.fn((a: any) => ({ desc: a })),
    lte: vi.fn((a: any, b: any) => ({ lte: [a, b] })),
  }
})

// Mock env config with valid test secrets
vi.mock('../../src/config/env', () => ({
  env: {
    JWT_SECRET: 'test-secret-minimum-16-chars-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-min-16-chars',
    JWT_EXPIRATION: '15m',
    JWT_REFRESH_EXPIRATION: '7d',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    CORS_ORIGIN: 'http://localhost:5173',
    PORT: 3000,
    RATE_LIMIT_WINDOW_MS: 900000,
    RATE_LIMIT_MAX_REQUESTS: 100,
  },
}))

// Mock the schema exports
vi.mock('../../src/db/schema', () => ({
  invoices: { id: 'invoices.id', company_id: 'invoices.company_id', invoice_id: 'invoices.invoice_id' },
  invoice_items: { id: 'invoice_items.id', invoice_id: 'invoice_items.invoice_id' },
  customers: { id: 'customers.id', company_id: 'customers.company_id' },
  products: { id: 'products.id', company_id: 'products.company_id', sku: 'products.sku', category_id: 'products.category_id' },
  categories: { id: 'categories.id', company_id: 'categories.company_id' },
  brands: { id: 'brands.id' },
  product_pricing: { id: 'product_pricing.id', product_id: 'product_pricing.product_id' },
  stock: { id: 'stock.id', product_id: 'stock.product_id', warehouse_id: 'stock.warehouse_id' },
  stock_movements: { id: 'stock_movements.id' },
  warehouses: { id: 'warehouses.id', company_id: 'warehouses.company_id' },
  users: { id: 'users.id', email: 'users.email' },
  companies: { id: 'companies.id' },
  sessions: { id: 'sessions.id', user_id: 'sessions.user_id', refresh_token: 'sessions.refresh_token' },
}))

// Mock the ApiError class
vi.mock('../../src/middlewares/errorHandler', () => ({
  ApiError: class ApiError extends Error {
    statusCode: number
    constructor(statusCode: number, message: string) {
      super(message)
      this.statusCode = statusCode
      this.name = 'ApiError'
    }
  },
}))

// Mock AFIP service
vi.mock('../../src/modules/afip/afip.service', () => ({
  afipService: {
    authorizeInvoice: vi.fn().mockResolvedValue({
      cae: '12345678901234',
      cae_expiry_date: '2025-01-31',
      invoice_number: 1,
    }),
    saveAuthorizedInvoice: vi.fn().mockResolvedValue(undefined),
  },
  AuthorizeInvoiceInput: {},
}))

export function mockDbRows(rows: any[]) {
  mockDbExecute.mockResolvedValueOnce({ rows })
}

export function mockDbEmpty() {
  mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

export function mockDbError(msg: string) {
  mockDbExecute.mockRejectedValueOnce(new Error(msg))
}

export function mockDbVoid() {
  mockDbExecute.mockResolvedValueOnce({ rows: [] })
}

export function resetMocks() {
  mockDbExecute.mockReset()
  mockPoolQuery.mockReset()
  uuidCounter = 0
}

export function resetUuidCounter() {
  uuidCounter = 0
}
