import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks, mockPoolQuery } from './helpers/setup'

import { billingService } from '../src/modules/billing/billing.service'

describe('BillingService', () => {
  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
  })

  describe('getSubscription', () => {
    it('creates trial subscription if none exists', async () => {
      // ensureMigrations (7 calls: 2 CREATE TABLE + 3 CREATE INDEX)
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - no existing subscription
      mockDbEmpty()

      // createTrialSubscription - INSERT
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'trial',
        status: 'trial',
        trial_ends_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        current_period_start: null,
        current_period_end: null,
        payment_provider: null,
        payment_provider_subscription_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      // getUsage query
      mockDbEmpty()

      const result = await billingService.getSubscription('company-1')

      expect(result.plan).toBe('trial')
      expect(result.status).toBe('trial')
      expect(result.is_trial).toBe(true)
      expect(result.can_use).toBe(true)
      expect(result.plan_details.displayName).toBe('Prueba Gratuita')
      expect(result.days_remaining).toBeGreaterThan(0)
    })

    it('returns existing subscription with plan details', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - existing active subscription
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'pyme',
        status: 'active',
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_provider: 'mercadopago',
        payment_provider_subscription_id: 'mp-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      // getUsage query
      mockDbRows([{
        invoices_count: 10,
        orders_count: 5,
        users_count: 3,
        storage_mb: '100.50',
      }])

      const result = await billingService.getSubscription('company-1')

      expect(result.plan).toBe('pyme')
      expect(result.status).toBe('active')
      expect(result.is_trial).toBe(false)
      expect(result.can_use).toBe(true)
      expect(result.plan_details.displayName).toBe('PyME')
      expect(result.usage.invoices_count).toBe(10)
      expect(result.usage.orders_count).toBe(5)
      expect(result.usage.total_documents).toBe(15)
    })
  })

  describe('checkLimits', () => {
    it('allows action when within limits', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'starter',
        status: 'active',
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_provider: 'mercadopago',
        payment_provider_subscription_id: 'mp-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      // getUsage (from getSubscription)
      mockDbRows([{
        invoices_count: 10,
        orders_count: 5,
        users_count: 1,
        storage_mb: '50',
      }])

      const result = await billingService.checkLimits('company-1', 'invoice')

      expect(result.allowed).toBe(true)
      expect(result.current).toBe(15) // 10 invoices + 5 orders
      expect(result.limit).toBe(50)
      expect(result.message).toBeNull()
    })

    it('blocks action when limit exceeded', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'starter',
        status: 'active',
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_provider: 'mercadopago',
        payment_provider_subscription_id: 'mp-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      // getUsage - at the limit
      mockDbRows([{
        invoices_count: 40,
        orders_count: 15,
        users_count: 2,
        storage_mb: '400',
      }])

      const result = await billingService.checkLimits('company-1', 'invoice')

      expect(result.allowed).toBe(false)
      expect(result.current).toBe(55) // over 50 limit
      expect(result.limit).toBe(50)
      expect(result.message).toContain('limite')
      expect(result.message).toContain('Starter')
    })

    it('blocks action when subscription expired', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - trial expired
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'trial',
        status: 'trial',
        trial_ends_at: expiredDate,
        current_period_start: null,
        current_period_end: null,
        payment_provider: null,
        payment_provider_subscription_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      // UPDATE to expired status
      mockDbVoid()

      // getUsage
      mockDbEmpty()

      const result = await billingService.checkLimits('company-1', 'invoice')

      expect(result.allowed).toBe(false)
      expect(result.message).toContain('expiro')
    })
  })

  describe('trackUsage', () => {
    it('increments invoice count', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // INSERT ON CONFLICT DO NOTHING
      mockDbVoid()
      // UPDATE - incremented by pool.query mock
      // (already mocked by mockPoolQuery)

      await billingService.trackUsage('company-1', 'invoice')

      // Verify pool.query was called for the UPDATE
      expect(mockPoolQuery).toHaveBeenCalled()
    })
  })

  describe('getPlans', () => {
    it('returns sorted plans without trial', () => {
      const plans = billingService.getPlans()

      expect(plans.length).toBe(4)
      expect(plans[0].id).toBe('starter')
      expect(plans[1].id).toBe('pyme')
      expect(plans[2].id).toBe('profesional')
      expect(plans[3].id).toBe('enterprise')
    })
  })
})
