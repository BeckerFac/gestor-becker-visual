import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, resetMocks } from './helpers/setup'

import { RetencionesService } from '../src/modules/retenciones/retenciones.service'

/**
 * Tests for the 8 bug fixes in retenciones.service.ts (H1-H8).
 *
 * H1: getRetentions supports direction filter (sufrida | practicada)
 * H2: getRetentions supports jurisdiction filter (caba, pba, otra)
 * H3: createRetention rejects duplicate certificate_number per (company, type, period, jurisdiction)
 * H4: createRetention accepts purchase_invoice_id / invoice_id directly
 * H5: createRetention rejects bases below the minimum no imponible (ganancias, suss)
 * H6: deleteRetention requires reason, blocks when linked to active pago/cobro, soft-deletes with audit
 * H7: lookupPadron uses retentionDate, not today
 * H8: calculateRetention preview; updateRetention returns 405
 */
describe('RetencionesService - hardening H1-H8', () => {
  let service: RetencionesService
  const companyId = 'company-1'
  const userId = 'user-1'

  beforeEach(() => {
    resetMocks()
    service = new RetencionesService()
  })

  // Helper: deep stringify a call argument. The drizzle `sql` mock stores
  // nested fragments under `strings` / `values`, so we walk recursively and
  // concatenate every string literal we find. This is the only reliable way
  // to assert against SQL built from composed templates under this mock.
  function deepSql(node: any, out: string[] = []): string {
    if (node == null) return out.join(' ')
    if (typeof node === 'string') { out.push(node); return out.join(' ') }
    if (Array.isArray(node)) { node.forEach(n => deepSql(n, out)); return out.join(' ') }
    if (typeof node === 'object') {
      if (node.strings) deepSql(node.strings, out)
      if (node.values) deepSql(node.values, out)
      if (node.raw) out.push(String(node.raw))
    }
    return out.join(' ')
  }
  function sqlOf(call: any): string {
    return deepSql(call?.[0])
  }
  function valuesOf(call: any): any[] {
    const out: any[] = []
    const walk = (node: any) => {
      if (node == null) return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node === 'object' && (node.strings || node.values)) {
        if (node.values) node.values.forEach(walk)
        return
      }
      out.push(node)
    }
    walk(call?.[0])
    return out
  }

  // ============ H1: direction filter ============
  describe('H1 - getRetentions direction filter', () => {
    it('passes direction=practicada into the SQL WHERE clause', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'r1', direction: 'practicada' }] })
      const res = await service.getRetentions(companyId, { direction: 'practicada' })
      expect(res.length).toBe(1)
      const call = mockDbExecute.mock.calls[0]
      const combined = sqlOf(call)
      expect(combined).toContain('r.direction =')
      // The 'practicada' literal should be interpolated somewhere in the values tree.
      const dump = JSON.stringify(valuesOf(call))
      expect(dump).toContain('practicada')
    })

    it('does NOT include r.direction predicate when filter omitted', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await service.getRetentions(companyId, {})
      const combined = sqlOf(mockDbExecute.mock.calls[0])
      expect(combined).not.toContain('r.direction =')
    })
  })

  // ============ H2: jurisdiction filter ============
  describe('H2 - getRetentions jurisdiction filter', () => {
    it('passes jurisdiction=caba into SQL', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'r2', jurisdiction: 'caba' }] })
      await service.getRetentions(companyId, { jurisdiction: 'caba' })
      const call = mockDbExecute.mock.calls[0]
      expect(sqlOf(call)).toContain('r.jurisdiction =')
      expect(JSON.stringify(valuesOf(call))).toContain('caba')
    })
  })

  // ============ H3: duplicate certificate_number ============
  describe('H3 - duplicate certificate_number', () => {
    it('throws 409 when the same certificate exists for type/period/jurisdiction', async () => {
      // 1st call: duplicate-check SELECT returns one row.
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'existing' }] })
      await expect(
        service.createRetention(companyId, userId, {
          type: 'ganancias',
          base_amount: 100000,
          rate: 2,
          amount: 2000,
          certificate_number: 'CERT-001',
          period: '2026-04',
        }),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('passes duplicate check when no existing certificate found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // dup check
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // INSERT
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'new-ret' }] }) // SELECT after insert
      const res = await service.createRetention(companyId, userId, {
        type: 'ganancias',
        base_amount: 100000,
        rate: 2,
        amount: 2000,
        certificate_number: 'CERT-002',
        period: '2026-04',
      })
      expect(res).toEqual({ id: 'new-ret' })
    })
  })

  // ============ H4: accepts purchase_invoice_id / invoice_id ============
  describe('H4 - createRetention accepts purchase_invoice_id / invoice_id', () => {
    it('INSERT SQL references purchase_invoice_id and invoice_id columns', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // insert
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'r-pi' }] }) // select
      await service.createRetention(companyId, userId, {
        type: 'ganancias',
        base_amount: 100000,
        rate: 2,
        amount: 2000,
        purchase_invoice_id: 'pi-1',
        invoice_id: 'inv-1',
        period: '2026-04',
      })
      const insertCall = mockDbExecute.mock.calls[0]
      const combined = sqlOf(insertCall)
      expect(combined).toContain('purchase_invoice_id')
      expect(combined).toContain('invoice_id')
      const dump = JSON.stringify(valuesOf(insertCall))
      expect(dump).toContain('pi-1')
      expect(dump).toContain('inv-1')
    })
  })

  // ============ H5: minimum base check ============
  describe('H5 - minimum no imponible', () => {
    it('rejects ganancias retention with base below $60k', async () => {
      await expect(
        service.createRetention(companyId, userId, {
          type: 'ganancias',
          base_amount: 5000,
          rate: 2,
          amount: 100,
          period: '2026-04',
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/minimo/i) })
    })

    it('allows iibb with any base (no minimum configured)', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // insert
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'r-iibb' }] }) // select
      const res = await service.createRetention(companyId, userId, {
        type: 'iibb',
        jurisdiction: 'caba',
        base_amount: 1000,
        rate: 3,
        amount: 30,
        period: '2026-04',
      })
      expect(res).toEqual({ id: 'r-iibb' })
    })
  })

  // ============ H6: deleteRetention guards ============
  describe('H6 - deleteRetention', () => {
    it('rejects missing/short reason', async () => {
      await expect(
        service.deleteRetention(companyId, 'ret-1', userId, ''),
      ).rejects.toMatchObject({ statusCode: 400 })
      await expect(
        service.deleteRetention(companyId, 'ret-1', userId, 'abc'),
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('returns 404 when retention not found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      await expect(
        service.deleteRetention(companyId, 'ret-404', userId, 'motivo valido'),
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('blocks delete when linked to an active (non-anulado) pago', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'ret-1',
          pago_id: 'pago-1',
          pago_status: 'confirmado',
          cobro_id: null,
          cobro_status: null,
          status: 'activa',
        }],
      })
      await expect(
        service.deleteRetention(companyId, 'ret-1', userId, 'motivo valido'),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('blocks delete when linked to an active cobro', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'ret-2',
          pago_id: null,
          pago_status: null,
          cobro_id: 'cobro-1',
          cobro_status: 'confirmado',
          status: 'activa',
        }],
      })
      await expect(
        service.deleteRetention(companyId, 'ret-2', userId, 'motivo valido'),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('soft-deletes with audit when reason is valid and no active link', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'ret-3',
          pago_id: null,
          pago_status: null,
          cobro_id: null,
          cobro_status: null,
          status: 'activa',
        }],
      })
      mockDbExecute.mockResolvedValueOnce({ rows: [] }) // UPDATE
      const res = await service.deleteRetention(companyId, 'ret-3', userId, 'carga duplicada corregida')
      expect(res).toEqual({ success: true, id: 'ret-3', status: 'anulada' })
      // Verify UPDATE SQL mentions status='anulada' and audit columns.
      const updateCall = mockDbExecute.mock.calls[1]
      const combined = sqlOf(updateCall)
      expect(combined).toContain("status = 'anulada'")
      expect(combined).toContain('anulled_at')
      expect(combined).toContain('anulled_by')
      expect(combined).toContain('anulled_reason')
      // reason was trimmed and passed as a value.
      expect(JSON.stringify(valuesOf(updateCall))).toContain('carga duplicada corregida')
    })

    it('rejects anulando una retencion ya anulada', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 'ret-4', pago_id: null, cobro_id: null, status: 'anulada' }],
      })
      await expect(
        service.deleteRetention(companyId, 'ret-4', userId, 'intento doble'),
      ).rejects.toMatchObject({ statusCode: 409 })
    })
  })

  // ============ H7: lookupPadron uses retentionDate ============
  describe('H7 - lookupPadron uses retentionDate not today', () => {
    it('passes the supplied retentionDate into the SQL query', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ rate: '1.5', regime: '401' }] })
      const res = await service.lookupPadron(companyId, 'ganancias', '20304050607', null, '2025-11-03')
      expect(res).toEqual({ rate: 1.5, regime: '401' })
      const dump = JSON.stringify(valuesOf(mockDbExecute.mock.calls[0]))
      expect(dump).toContain('2025-11-03')
      // Must NOT contain today's date.
      const today = new Date().toISOString().slice(0, 10)
      if (today !== '2025-11-03') {
        expect(dump).not.toContain(today)
      }
    })

    it('falls back to today when retentionDate not provided', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ rate: '2.0', regime: null }] })
      await service.lookupPadron(companyId, 'ganancias', '20304050607')
      const today = new Date().toISOString().slice(0, 10)
      expect(JSON.stringify(valuesOf(mockDbExecute.mock.calls[0]))).toContain(today)
    })
  })

  // ============ H8: calculate preview + reject update ============
  describe('H8 - calculate preview + immutability', () => {
    it('calculateRetention returns rate/amount/source=padron when padron hits', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ rate: '4.5', regime: '111' }] })
      const res = await service.calculateRetention({
        companyId,
        type: 'iibb',
        base_amount: 100000,
        jurisdiction: 'caba',
        cuit: '20304050607',
        date: '2026-04-10',
      })
      expect(res.rate).toBe(4.5)
      expect(res.amount).toBe(4500)
      expect(res.source).toBe('padron')
    })

    it('calculateRetention falls back to DEFAULT_RATES when padron misses', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] })
      const res = await service.calculateRetention({
        companyId,
        type: 'ganancias',
        base_amount: 100000,
        cuit: '20304050607',
      })
      expect(res.rate).toBe(2.0) // DEFAULT_RATES.ganancias
      expect(res.amount).toBe(2000)
      expect(res.source).toBe('default')
    })

    it('calculateRetention without CUIT skips padron lookup and uses default', async () => {
      const res = await service.calculateRetention({
        companyId,
        type: 'ganancias',
        base_amount: 100000,
      })
      expect(res.source).toBe('default')
      expect(mockDbExecute).not.toHaveBeenCalled()
    })

    it('calculateRetention reports below_minimum for ganancias under $60k', async () => {
      const res = await service.calculateRetention({
        companyId,
        type: 'ganancias',
        base_amount: 5000,
      })
      expect(res.below_minimum).toBe(true)
      expect(res.minimum_base).toBe(60000)
    })

    it('updateRetention always throws 405', async () => {
      await expect(service.updateRetention()).rejects.toMatchObject({ statusCode: 405 })
    })
  })
})
