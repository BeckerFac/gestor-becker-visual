/**
 * Tests for chart-seed + getBalance / getBalanceSheet empty-state handling.
 *
 * Bug context (2026-04-21): fresh companies hit POST /accounting/seed,
 * GET /accounting/balance and GET /accounting/balance-sheet and all three
 * returned 500. Root cause: legacy prod schema lacked chart_of_accounts.is_header
 * + UNIQUE(company_id, code), and the read endpoints had no empty-state guard.
 *
 * These tests ensure:
 *   - seedChartOfAccounts is idempotent (can be called twice)
 *   - seedChartOfAccounts does not throw when a single row fails
 *   - getBalance returns [] when the chart is empty
 *   - getBalance returns [] when the query throws
 *   - getBalanceSheet returns a valid empty shape when the chart is empty
 *   - getBalanceSheet returns a valid empty shape when the query throws
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, resetMocks } from './helpers/setup'

import { seedChartOfAccounts, BASE_ACCOUNTS } from '../src/modules/accounting/chart-seed'
import { AccountingEntriesService } from '../src/modules/accounting/accounting-entries.service'

describe('seedChartOfAccounts', () => {
  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
  })

  // Swallow the three ensureChartOfAccountsSchema DDL calls the seed issues
  // before the real work starts.
  function mockEnsureSchemaCalls() {
    mockDbEmpty() // ALTER TABLE ... is_header
    mockDbEmpty() // ALTER TABLE ... level
    mockDbEmpty() // CREATE UNIQUE INDEX
  }

  it('creates every base account on a fresh company', async () => {
    mockEnsureSchemaCalls()
    // First SELECT existing: returns no rows (fresh company).
    mockDbEmpty()
    // Each INSERT RETURNING id.
    for (let i = 0; i < BASE_ACCOUNTS.length; i++) {
      mockDbRows([{ id: `account-${i}` }])
    }

    const result = await seedChartOfAccounts('fresh-company')

    expect(result.created).toBe(BASE_ACCOUNTS.length)
    expect(result.skipped).toBe(0)
  })

  it('is idempotent: seeding twice skips already-existing accounts', async () => {
    mockEnsureSchemaCalls()
    // SELECT existing: returns ALL base accounts already present.
    const existing = BASE_ACCOUNTS.map((a, i) => ({ code: a.code, id: `account-${i}` }))
    mockDbRows(existing)
    // No INSERTs are issued because every code already exists in codeToId.

    const result = await seedChartOfAccounts('seeded-company')

    expect(result.created).toBe(0)
    expect(result.skipped).toBe(BASE_ACCOUNTS.length)
  })

  it('does not throw if an individual INSERT fails (logged, counted as skipped)', async () => {
    mockEnsureSchemaCalls()
    mockDbEmpty() // SELECT existing — empty
    // First INSERT throws; seed MUST recover and continue.
    mockDbExecute.mockRejectedValueOnce(new Error('simulated insert failure'))
    // Subsequent INSERTs succeed.
    for (let i = 1; i < BASE_ACCOUNTS.length; i++) {
      mockDbRows([{ id: `account-${i}` }])
    }

    const result = await seedChartOfAccounts('broken-company')

    expect(result.created).toBe(BASE_ACCOUNTS.length - 1)
    expect(result.skipped).toBe(1)
  })
})

describe('AccountingEntriesService empty-state handling', () => {
  let service: AccountingEntriesService

  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
    service = new AccountingEntriesService()
  })

  describe('getBalance', () => {
    it('returns [] when the chart is empty (no accounts yet)', async () => {
      mockDbEmpty()

      const result = await service.getBalance('fresh-company')

      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([])
    })

    it('returns [] when the query throws (e.g. missing legacy column)', async () => {
      mockDbExecute.mockRejectedValueOnce(
        new Error('column "is_header" does not exist')
      )

      const result = await service.getBalance('legacy-company')

      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([])
    })
  })

  describe('getBalanceSheet', () => {
    const EMPTY_SHAPE_KEYS = ['activo', 'pasivo', 'patrimonio', 'resultado', 'balanced']

    it('returns an empty-but-valid shape when the chart has no rows', async () => {
      mockDbEmpty()

      const result = await service.getBalanceSheet('fresh-company')

      for (const key of EMPTY_SHAPE_KEYS) {
        expect(result).toHaveProperty(key)
      }
      expect(result.activo).toEqual({ total: 0, cuentas: [] })
      expect(result.pasivo).toEqual({ total: 0, cuentas: [] })
      expect(result.patrimonio).toEqual({ total: 0, cuentas: [] })
      expect(result.resultado).toBe(0)
      expect(result.balanced).toBe(true)
    })

    it('returns an empty-but-valid shape when the query throws', async () => {
      mockDbExecute.mockRejectedValueOnce(
        new Error('column "is_header" does not exist')
      )

      const result = await service.getBalanceSheet('legacy-company')

      for (const key of EMPTY_SHAPE_KEYS) {
        expect(result).toHaveProperty(key)
      }
      expect(result.activo.cuentas).toEqual([])
      expect(result.pasivo.cuentas).toEqual([])
      expect(result.patrimonio.cuentas).toEqual([])
    })
  })
})
