import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

// Mock quotes service so we can assert the PDF generator is NOT called on IDOR
vi.mock('../src/modules/quotes/quotes.service', () => ({
  quotesService: {
    generateQuotePdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
    getQuote: vi.fn(),
  },
}))

// Mock portal service (not used by getQuotePdf path but imported by controller)
vi.mock('../src/modules/portal/portal.service', () => ({
  portalService: {},
}))

import { portalController } from '../src/modules/portal/portal.controller'
import { quotesService } from '../src/modules/quotes/quotes.service'

function makeRes() {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  res.setHeader = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  return res
}

describe('Portal getQuotePdf IDOR protection', () => {
  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
  })

  it('rejects getQuotePdf of another customer (404, does not generate pdf)', async () => {
    // Attacker is enterprise-A asking for a quote that belongs to enterprise-B.
    // The ownership query must return zero rows => 404.
    mockDbExecute.mockResolvedValueOnce({ rows: [] })

    const req: any = {
      user: { company_id: 'company-1', enterprise_id: 'enterprise-A' },
      params: { id: 'quote-belonging-to-B' },
    }
    const res = makeRes()

    await portalController.getQuotePdf(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Quote not found' })
    expect(quotesService.generateQuotePdf).not.toHaveBeenCalled()
  })

  it('allows getQuotePdf when quote belongs to the requesting enterprise', async () => {
    // Ownership query returns the matching quote row.
    mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'quote-A' }] })

    const req: any = {
      user: { company_id: 'company-1', enterprise_id: 'enterprise-A' },
      params: { id: 'quote-A' },
    }
    const res = makeRes()

    await portalController.getQuotePdf(req, res)

    expect(quotesService.generateQuotePdf).toHaveBeenCalledWith('company-1', 'quote-A')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf')
    expect(res.send).toHaveBeenCalled()
  })

  it('rejects getQuotePdf when no enterprise_id on token', async () => {
    const req: any = {
      user: { company_id: 'company-1' },
      params: { id: 'quote-A' },
    }
    const res = makeRes()

    await portalController.getQuotePdf(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(quotesService.generateQuotePdf).not.toHaveBeenCalled()
  })
})
