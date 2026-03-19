import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks, mockPoolQuery } from './helpers/setup'

import { billingService } from '../src/modules/billing/billing.service'
import { planHasFeature, getRequiredPlanForFeature } from '../src/modules/billing/plans.config'

describe('BillingService', () => {
  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
  })

  describe('getSubscription', () => {
    it('creates trial subscription if none exists', async () => {
      // ensureMigrations (multiple calls: CREATE TABLE + ALTER + CREATE INDEX)
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - no existing subscription
      mockDbEmpty()

      // createTrialSubscription - INSERT
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'trial',
        billing_period: null,
        status: 'trial',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
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

      // getSubscription query - existing active Estandar subscription
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'estandar_monthly',
        billing_period: 'monthly',
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
        users_count: 1,
        storage_mb: '100.50',
      }])

      const result = await billingService.getSubscription('company-1')

      expect(result.plan).toBe('estandar_monthly')
      expect(result.status).toBe('active')
      expect(result.is_trial).toBe(false)
      expect(result.is_estandar).toBe(true)
      expect(result.is_premium).toBe(false)
      expect(result.can_use).toBe(true)
      expect(result.plan_details.displayName).toBe('Estandar')
      expect(result.usage.invoices_count).toBe(10)
      expect(result.usage.orders_count).toBe(5)
      expect(result.usage.total_documents).toBe(15)
    })

    it('returns premium subscription with correct flags', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'premium_annual',
        billing_period: 'annual',
        status: 'active',
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        payment_provider: 'mercadopago',
        payment_provider_subscription_id: 'mp-456',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      mockDbRows([{
        invoices_count: 50,
        orders_count: 20,
        users_count: 5,
        storage_mb: '500',
      }])

      const result = await billingService.getSubscription('company-1')

      expect(result.plan).toBe('premium_annual')
      expect(result.is_estandar).toBe(false)
      expect(result.is_premium).toBe(true)
      expect(result.plan_details.displayName).toBe('Premium')
      expect(result.plan_details.billingPeriod).toBe('annual')
    })
  })

  describe('checkLimits', () => {
    it('allows action when within limits', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - Estandar with 600/mes limit
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'estandar_monthly',
        billing_period: 'monthly',
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
      expect(result.limit).toBe(600)
      expect(result.message).toBeNull()
    })

    it('blocks action when limit exceeded', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - Estandar at limit
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'estandar_monthly',
        billing_period: 'monthly',
        status: 'active',
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_provider: 'mercadopago',
        payment_provider_subscription_id: 'mp-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      // getUsage - at the 600 limit
      mockDbRows([{
        invoices_count: 400,
        orders_count: 210,
        users_count: 2,
        storage_mb: '400',
      }])

      const result = await billingService.checkLimits('company-1', 'invoice')

      expect(result.allowed).toBe(false)
      expect(result.current).toBe(610) // over 600 limit
      expect(result.limit).toBe(600)
      expect(result.message).toContain('limite')
      expect(result.message).toContain('Estandar')
    })

    it('blocks action when subscription expired', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      // getSubscription query - trial expired
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'trial',
        billing_period: null,
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

    it('allows unlimited for Premium plans', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] })

      mockDbRows([{
        id: 'sub-1',
        company_id: 'company-1',
        plan: 'premium_monthly',
        billing_period: 'monthly',
        status: 'active',
        trial_ends_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payment_provider: 'mercadopago',
        payment_provider_subscription_id: 'mp-789',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])

      mockDbRows([{
        invoices_count: 9999,
        orders_count: 5000,
        users_count: 50,
        storage_mb: '10000',
      }])

      const result = await billingService.checkLimits('company-1', 'invoice')

      expect(result.allowed).toBe(true)
      expect(result.limit).toBe(Infinity)
      expect(result.message).toBeNull()
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
      expect(plans[0].id).toBe('estandar_monthly')
      expect(plans[1].id).toBe('estandar_annual')
      expect(plans[2].id).toBe('premium_monthly')
      expect(plans[3].id).toBe('premium_annual')
    })

    it('has correct pricing structure', () => {
      const plans = billingService.getPlans()

      const estandarMonthly = plans.find(p => p.id === 'estandar_monthly')!
      const estandarAnnual = plans.find(p => p.id === 'estandar_annual')!
      const premiumMonthly = plans.find(p => p.id === 'premium_monthly')!
      const premiumAnnual = plans.find(p => p.id === 'premium_annual')!

      expect(estandarMonthly.priceArs).toBe(28999)
      expect(premiumMonthly.priceArs).toBe(73999)

      // Annual effective monthly should be less than monthly
      expect(estandarAnnual.priceArsMonthly).toBeLessThan(estandarMonthly.priceArsMonthly)
      expect(premiumAnnual.priceArsMonthly).toBeLessThan(premiumMonthly.priceArsMonthly)

      // Annual should be roughly 32% discount
      const estandarDiscount = 1 - (estandarAnnual.priceArs / (estandarMonthly.priceArs * 12))
      const premiumDiscount = 1 - (premiumAnnual.priceArs / (premiumMonthly.priceArs * 12))
      expect(estandarDiscount).toBeCloseTo(0.32, 1)
      expect(premiumDiscount).toBeCloseTo(0.32, 1)
    })

    it('has correct feature sets', () => {
      const plans = billingService.getPlans()
      const estandar = plans.find(p => p.id === 'estandar_monthly')!
      const premium = plans.find(p => p.id === 'premium_monthly')!

      // Estandar: no AI, no advanced reports, no custom branding
      expect(estandar.features.aiChat).toBe(false)
      expect(estandar.features.aiInsights).toBe(false)
      expect(estandar.features.reportesAvanzados).toBe(false)
      expect(estandar.features.customBranding).toBe(false)

      // Estandar: has core features (no CRM - Premium only)
      expect(estandar.features.facturacion).toBe(true)
      expect(estandar.features.pedidos).toBe(true)
      expect(estandar.features.stock).toBe(true)
      expect(estandar.features.crm).toBe(false)

      // Premium: all features
      expect(premium.features.aiChat).toBe(true)
      expect(premium.features.aiInsights).toBe(true)
      expect(premium.features.reportesAvanzados).toBe(true)
      expect(premium.features.customBranding).toBe(true)
      expect(premium.features.crm).toBe(true)
    })
  })

  describe('getPlansGrouped', () => {
    it('returns grouped plans with monthly and annual variants', () => {
      const groups = billingService.getPlansGrouped()

      expect(groups.length).toBe(2)
      expect(groups[0].group).toBe('estandar')
      expect(groups[1].group).toBe('premium')

      expect(groups[0].monthly.billingPeriod).toBe('monthly')
      expect(groups[0].annual.billingPeriod).toBe('annual')
      expect(groups[1].monthly.billingPeriod).toBe('monthly')
      expect(groups[1].annual.billingPeriod).toBe('annual')
    })
  })

  describe('planHasFeature', () => {
    it('trial has all features', () => {
      expect(planHasFeature('trial', 'crm')).toBe(true)
      expect(planHasFeature('trial', 'ai')).toBe(true)
      expect(planHasFeature('trial', 'advanced_reports')).toBe(true)
      expect(planHasFeature('trial', 'custom_branding')).toBe(true)
    })

    it('estandar lacks premium features', () => {
      expect(planHasFeature('estandar_monthly', 'crm')).toBe(false)
      expect(planHasFeature('estandar_monthly', 'ai')).toBe(false)
      expect(planHasFeature('estandar_monthly', 'ai_chat')).toBe(false)
      expect(planHasFeature('estandar_monthly', 'advanced_reports')).toBe(false)
      expect(planHasFeature('estandar_monthly', 'custom_branding')).toBe(false)
    })

    it('premium has all features', () => {
      expect(planHasFeature('premium_monthly', 'crm')).toBe(true)
      expect(planHasFeature('premium_monthly', 'ai')).toBe(true)
      expect(planHasFeature('premium_monthly', 'ai_chat')).toBe(true)
      expect(planHasFeature('premium_monthly', 'advanced_reports')).toBe(true)
      expect(planHasFeature('premium_monthly', 'custom_branding')).toBe(true)
    })

    it('getRequiredPlanForFeature returns correct tier', () => {
      expect(getRequiredPlanForFeature('crm')).toBe('premium')
      expect(getRequiredPlanForFeature('ai')).toBe('premium')
      expect(getRequiredPlanForFeature('advanced_reports')).toBe('premium')
      expect(getRequiredPlanForFeature('export_completo')).toBe('estandar')
    })
  })
})
