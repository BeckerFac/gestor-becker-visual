import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, mockClientQuery, resetMocks } from './helpers/setup'

import { ChequesService } from '../src/modules/cheques/cheques.service'

describe('ChequesService', () => {
  let service: ChequesService

  beforeEach(() => {
    resetMocks()
    service = new ChequesService()
  })

  function mockMigrations() {
    mockDbVoid() // ALTER TABLE cheque_type
    mockDbVoid() // ALTER TABLE drawer_cuit
    mockDbVoid() // ALTER TABLE cobro_id
    mockDbVoid() // ALTER TABLE direction
    mockDbVoid() // UPDATE direction default
    mockDbVoid() // ALTER TABLE issuer_type
    mockDbVoid() // UPDATE issuer_type default
    mockDbVoid() // CREATE UNIQUE INDEX
  }

  describe('createCheque', () => {
    it('creates cheque with new fields (cheque_type, drawer_cuit)', async () => {
      mockMigrations()
      mockDbVoid() // INSERT

      const result = await service.createCheque('company-1', 'user-1', {
        number: '12345678',
        bank: 'Banco Nacion',
        drawer: 'Juan Perez',
        drawer_cuit: '20-12345678-9',
        cheque_type: 'diferido',
        amount: 50000,
        issue_date: '2025-01-01',
        due_date: '2025-03-01',
      })

      expect(result).toHaveProperty('id')
      expect(result.status).toBe('a_cobrar')
    })

    it('defaults cheque_type to comun when not provided', async () => {
      mockMigrations()
      mockDbVoid()

      const result = await service.createCheque('company-1', 'user-1', {
        number: '99999',
        bank: 'Banco Galicia',
        drawer: 'Maria Lopez',
        amount: 10000,
        issue_date: '2025-01-01',
        due_date: '2025-02-01',
      })

      expect(result.status).toBe('a_cobrar')
    })
  })

  describe('updateChequeStatus', () => {
    it('allows valid transition: a_cobrar -> endosado', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'a_cobrar' }])
      mockDbVoid() // INSERT history
      mockDbVoid() // UPDATE cheque

      const result = await service.updateChequeStatus('company-1', 'cheque-1', 'endosado')

      expect(result.status).toBe('endosado')
    })

    it('allows valid transition: a_cobrar -> depositado', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'a_cobrar' }])
      mockDbVoid()
      mockDbVoid()

      const result = await service.updateChequeStatus('company-1', 'cheque-1', 'depositado')
      expect(result.status).toBe('depositado')
    })

    it('allows valid transition: a_cobrar -> cobrado', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'a_cobrar' }])
      mockDbVoid()
      mockDbVoid()

      const result = await service.updateChequeStatus('company-1', 'cheque-1', 'cobrado')
      expect(result.status).toBe('cobrado')
    })

    it('allows valid transition: rechazado -> a_cobrar', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'rechazado' }])
      mockDbVoid()
      mockDbVoid()

      const result = await service.updateChequeStatus('company-1', 'cheque-1', 'a_cobrar')
      expect(result.status).toBe('a_cobrar')
    })

    it('SECURITY: blocks direct transition endosado -> a_cobrar (only deletePago can revert)', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'endosado' }])

      await expect(
        service.updateChequeStatus('company-1', 'cheque-1', 'a_cobrar')
      ).rejects.toThrow('No se puede cambiar de "endosado" a "a_cobrar"')
    })

    it('throws error on invalid transition: cobrado -> endosado', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'cobrado' }])

      await expect(
        service.updateChequeStatus('company-1', 'cheque-1', 'endosado')
      ).rejects.toThrow('No se puede cambiar de "cobrado" a "endosado"')
    })

    it('throws error on invalid transition: rechazado -> cobrado', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'rechazado' }])

      await expect(
        service.updateChequeStatus('company-1', 'cheque-1', 'cobrado')
      ).rejects.toThrow('No se puede cambiar de "rechazado" a "cobrado"')
    })

    it('throws error on invalid status value', async () => {
      await expect(
        service.updateChequeStatus('company-1', 'cheque-1', 'invalid_status')
      ).rejects.toThrow('Estado invalido')
    })

    it('sets collected_date when status becomes cobrado', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'a_cobrar' }])
      mockDbVoid() // INSERT history

      let updateSqlStr = ''
      mockDbExecute.mockImplementationOnce((...args: any[]) => {
        const tpl = args[0]
        if (tpl?.strings) {
          updateSqlStr = tpl.strings.join('')
        }
        return Promise.resolve({ rows: [] })
      })

      await service.updateChequeStatus('company-1', 'cheque-1', 'cobrado')

      expect(updateSqlStr).toContain('collected_date = NOW()')
    })

    it('clears collected_date when status becomes a_cobrar', async () => {
      mockDbRows([{ id: 'cheque-1', status: 'cobrado' }])
      mockDbVoid() // INSERT history

      let updateSqlStr = ''
      mockDbExecute.mockImplementationOnce((...args: any[]) => {
        const tpl = args[0]
        if (tpl?.strings) {
          updateSqlStr = tpl.strings.join('')
        }
        return Promise.resolve({ rows: [] })
      })

      await service.updateChequeStatus('company-1', 'cheque-1', 'a_cobrar')

      expect(updateSqlStr).toContain('collected_date = NULL')
    })

    it('throws 404 when cheque not found', async () => {
      mockDbEmpty()

      await expect(
        service.updateChequeStatus('company-1', 'nonexistent', 'cobrado')
      ).rejects.toThrow('Cheque not found')
    })
  })

  describe('getCheques', () => {
    it('returns cheques list', async () => {
      mockMigrations()
      mockDbRows([
        { id: 'ch-1', number: '12345', bank: 'Nacion', status: 'a_cobrar', amount: '50000' },
        { id: 'ch-2', number: '67890', bank: 'Galicia', status: 'cobrado', amount: '30000' },
      ])

      const result = await service.getCheques('company-1')
      expect(result).toHaveLength(2)
    })

    it('applies search filter', async () => {
      mockMigrations()
      mockDbEmpty()

      const result = await service.getCheques('company-1', { search: 'Nacion' })
      expect(result).toEqual([])
    })

    it('applies status filter', async () => {
      mockMigrations()
      mockDbEmpty()

      const result = await service.getCheques('company-1', { status: 'cobrado' })
      expect(result).toEqual([])
    })

    it('skips status filter when value is todos', async () => {
      mockMigrations()
      mockDbEmpty()

      const result = await service.getCheques('company-1', { status: 'todos' })
      expect(result).toEqual([])
    })
  })

  describe('getSummary', () => {
    it('returns correct aggregation with all status totals', async () => {
      mockDbRows([{
        total_a_cobrar: '150000.00',
        total_cobrado: '50000.00',
        total_endosado: '20000.00',
        total_depositado: '10000.00',
        total_rechazado: '5000.00',
        count_a_cobrar: '5',
        count_cobrado: '2',
        count_endosado: '1',
        count_depositado: '1',
        count_rechazado: '1',
        vencidos_count: '2',
        vencidos_amount: '30000.00',
        vencen_semana_count: '1',
        vencen_semana_amount: '15000.00',
      }])

      const result = await service.getSummary('company-1')

      expect(result.total_a_cobrar).toBe(150000)
      expect(result.total_cobrado).toBe(50000)
      expect(result.count_a_cobrar).toBe(5)
      expect(result.vencidos_count).toBe(2)
      expect(result.vencidos_amount).toBe(30000)
      expect(result.vencen_semana_count).toBe(1)
    })

    it('returns zeros when no cheques exist', async () => {
      mockDbRows([{}])

      const result = await service.getSummary('company-1')

      expect(result.total_a_cobrar).toBe(0)
      expect(result.total_cobrado).toBe(0)
      expect(result.count_a_cobrar).toBe(0)
    })
  })

  describe('deleteCheque', () => {
    it('deletes pending cheque', async () => {
      mockDbRows([{ id: 'ch-1', status: 'a_cobrar' }])
      mockDbVoid() // DELETE

      const result = await service.deleteCheque('company-1', 'ch-1')
      expect(result.deleted).toBe(true)
    })

    it('blocks deletion of non-pending cheque', async () => {
      mockDbRows([{ id: 'ch-1', status: 'cobrado', direction: 'recibido' }])

      await expect(
        service.deleteCheque('company-1', 'ch-1')
      ).rejects.toThrow(/No se puede eliminar cheque en estado cobrado/)
    })

    it('throws 404 when cheque not found', async () => {
      mockDbEmpty()

      await expect(
        service.deleteCheque('company-1', 'nonexistent')
      ).rejects.toThrow('Cheque not found')
    })
  })

  describe('updateCheque', () => {
    it('updates pending cheque', async () => {
      mockDbRows([{ id: 'ch-1', status: 'a_cobrar' }])
      mockDbVoid() // UPDATE

      const result = await service.updateCheque('company-1', 'ch-1', {
        number: '99999',
        bank: 'HSBC',
        drawer: 'Updated Drawer',
        amount: 75000,
        issue_date: '2025-02-01',
        due_date: '2025-04-01',
      })

      expect(result.updated).toBe(true)
    })

    it('blocks update of non-pending cheque', async () => {
      mockDbRows([{ id: 'ch-1', status: 'depositado' }])

      await expect(
        service.updateCheque('company-1', 'ch-1', {
          number: '99999', bank: 'HSBC', drawer: 'X', amount: 1000,
          issue_date: '2025-01-01', due_date: '2025-02-01',
        })
      ).rejects.toThrow('Solo se pueden editar cheques pendientes')
    })
  })

  describe('endorseCheque (double-spending guard)', () => {
    // Helper: queue client.query responses in order
    function queueClient(responses: Array<{ rows?: any[]; rowCount?: number }>) {
      for (const r of responses) {
        mockClientQuery.mockResolvedValueOnce({ rows: r.rows || [], rowCount: r.rowCount ?? (r.rows?.length || 0) })
      }
    }

    it('endoses a cheque in a_cobrar successfully (locked path)', async () => {
      mockMigrations()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'a_cobrar', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: null }] }, // SELECT FOR UPDATE
        { rows: [{ id: 'ent-1' }] }, // SELECT enterprise
        { rowCount: 1 }, // INSERT pago
        { rowCount: 1 }, // UPDATE cheque
        { rowCount: 1 }, // INSERT history
        { rows: [] }, // COMMIT
      ])

      const result = await service.endorseCheque('company-1', 'user-1', 'ch-1', {
        enterprise_id: 'ent-1',
        amount: 50000,
      })

      expect(result.cheque_status).toBe('endosado')
      expect(result.amount_paid).toBe(50000)
      // Verify FOR UPDATE lock was used
      const lockCall = mockClientQuery.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('FOR UPDATE'))
      expect(lockCall).toBeDefined()
      // Verify BEGIN/COMMIT
      const sqls = mockClientQuery.mock.calls.map((c: any[]) => c[0])
      expect(sqls).toContain('BEGIN')
      expect(sqls).toContain('COMMIT')
    })

    it('rejects endoso when cheque not in a_cobrar (already endorsed)', async () => {
      mockMigrations()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'endosado', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: 'pago-existing' }] }, // SELECT FOR UPDATE
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.endorseCheque('company-1', 'user-1', 'ch-1', { enterprise_id: 'ent-1', amount: 50000 })
      ).rejects.toThrow(/no disponible para endosar/)
    })

    it('rejects endoso when endorsed_pago_id already set (defense in depth)', async () => {
      mockMigrations()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'a_cobrar', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: 'pago-existing' }] },
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.endorseCheque('company-1', 'user-1', 'ch-1', { enterprise_id: 'ent-1', amount: 50000 })
      ).rejects.toThrow(/ya endosado/)
    })

    it('rejects when UPDATE cheques affects 0 rows (race lost)', async () => {
      mockMigrations()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'a_cobrar', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: null }] },
        { rows: [{ id: 'ent-1' }] },
        { rowCount: 1 }, // INSERT pago
        { rowCount: 0 }, // UPDATE cheque -> 0 rows (lost the race somehow)
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.endorseCheque('company-1', 'user-1', 'ch-1', { enterprise_id: 'ent-1', amount: 50000 })
      ).rejects.toThrow(/ya fue endosado/)
    })

    it('rejects when amount > cheque amount', async () => {
      mockMigrations()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'a_cobrar', amount: '10000', number: '12345', business_unit_id: null, endorsed_pago_id: null }] },
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.endorseCheque('company-1', 'user-1', 'ch-1', { enterprise_id: 'ent-1', amount: 50000 })
      ).rejects.toThrow(/insuficiente/)
    })

    it('SECURITY: serial endorseCheque calls — second call sees endosado and rejects', async () => {
      mockMigrations()
      // First call: full success path
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'a_cobrar', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: null }] },
        { rows: [{ id: 'ent-1' }] },
        { rowCount: 1 }, // INSERT pago
        { rowCount: 1 }, // UPDATE cheque
        { rowCount: 1 }, // INSERT history
        { rows: [] }, // COMMIT
      ])
      // Second call: lock now sees status='endosado'
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'endosado', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: '00000000-0000-0000-0000-000000000001' }] },
        { rows: [] }, // ROLLBACK
      ])

      const r1 = await service.endorseCheque('company-1', 'user-1', 'ch-1', { enterprise_id: 'ent-1', amount: 50000 })
      expect(r1.cheque_status).toBe('endosado')

      await expect(
        service.endorseCheque('company-1', 'user-2', 'ch-1', { enterprise_id: 'ent-2', amount: 50000 })
      ).rejects.toThrow(/no disponible para endosar/)
    })

    it('H2: rejects endorsing an emitido cheque', async () => {
      mockMigrations()
      queueClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: 'ch-1', company_id: 'company-1', status: 'a_cobrar', amount: '50000', number: '12345', business_unit_id: null, endorsed_pago_id: null, direction: 'emitido' }] },
        { rows: [] }, // ROLLBACK
      ])

      await expect(
        service.endorseCheque('company-1', 'user-1', 'ch-1', { enterprise_id: 'ent-1', amount: 50000 })
      ).rejects.toThrow(/cheques recibidos de terceros/)
    })
  })

  describe('direction: emitido lifecycle', () => {
    describe('getCheques with direction filter', () => {
      it('returns only emitido cheques when direction=emitido', async () => {
        mockMigrations()
        mockDbRows([{ id: 'ch-e-1', direction: 'emitido', status: 'emitido' }])

        const result = await service.getCheques('company-1', { direction: 'emitido' })
        expect(result).toHaveLength(1)
        expect((result as any)[0].direction).toBe('emitido')
      })
    })

    describe('updateChequeStatus with direction=emitido', () => {
      it('allows emitido -> entregado', async () => {
        mockDbRows([{ id: 'ch-1', status: 'emitido', direction: 'emitido' }])
        mockDbVoid() // INSERT history
        mockDbVoid() // UPDATE cheque
        const result = await service.updateChequeStatus('company-1', 'ch-1', 'entregado')
        expect(result.status).toBe('entregado')
      })

      it('allows entregado -> cobrado', async () => {
        mockDbRows([{ id: 'ch-1', status: 'entregado', direction: 'emitido' }])
        mockDbVoid()
        mockDbVoid()
        const result = await service.updateChequeStatus('company-1', 'ch-1', 'cobrado')
        expect(result.status).toBe('cobrado')
      })

      it('rejects invalid emitido -> a_cobrar', async () => {
        mockDbRows([{ id: 'ch-1', status: 'emitido', direction: 'emitido' }])
        await expect(
          service.updateChequeStatus('company-1', 'ch-1', 'a_cobrar')
        ).rejects.toThrow(/No se puede cambiar de "emitido" a "a_cobrar"/)
      })

      it('rejects entregado -> entregado (no-op)', async () => {
        mockDbRows([{ id: 'ch-1', status: 'entregado', direction: 'emitido' }])
        await expect(
          service.updateChequeStatus('company-1', 'ch-1', 'entregado')
        ).rejects.toThrow(/No se puede cambiar de "entregado" a "entregado"/)
      })

      it('accepts anulado as a valid new status', async () => {
        mockDbRows([{ id: 'ch-1', status: 'emitido', direction: 'emitido' }])
        mockDbVoid()
        mockDbVoid()
        const result = await service.updateChequeStatus('company-1', 'ch-1', 'anulado')
        expect(result.status).toBe('anulado')
      })
    })

    describe('deleteCheque with direction', () => {
      it('allows deleting emitido cheque in status=emitido with no pago_id', async () => {
        mockDbRows([{ id: 'ch-1', status: 'emitido', direction: 'emitido', pago_id: null, cobro_id: null }])
        mockDbVoid() // DELETE
        const result = await service.deleteCheque('company-1', 'ch-1')
        expect(result.deleted).toBe(true)
      })

      it('blocks deleting emitido cheque when linked to pago', async () => {
        mockDbRows([{ id: 'ch-1', status: 'emitido', direction: 'emitido', pago_id: 'pago-xyz', cobro_id: null }])
        await expect(
          service.deleteCheque('company-1', 'ch-1')
        ).rejects.toThrow(/vinculado a pago\/cobro/)
      })

      it('blocks deleting emitido cheque in status=entregado', async () => {
        mockDbRows([{ id: 'ch-1', status: 'entregado', direction: 'emitido', pago_id: null, cobro_id: null }])
        await expect(
          service.deleteCheque('company-1', 'ch-1')
        ).rejects.toThrow(/No se puede eliminar cheque en estado entregado/)
      })
    })

    describe('createCheque H5: due_date >= issue_date', () => {
      it('rejects when due_date < issue_date', async () => {
        await expect(
          service.createCheque('company-1', 'user-1', {
            number: '123', bank: 'X', drawer: 'Y', amount: 100,
            issue_date: '2025-05-01', due_date: '2025-04-01',
          })
        ).rejects.toThrow(/Fecha de vencimiento no puede ser anterior/)
      })

      it('accepts when due_date = issue_date', async () => {
        mockMigrations()
        mockDbVoid() // INSERT
        const result = await service.createCheque('company-1', 'user-1', {
          number: '123', bank: 'X', drawer: 'Y', amount: 100,
          issue_date: '2025-05-01', due_date: '2025-05-01',
        })
        expect(result).toHaveProperty('id')
      })

      it('creates an emitido cheque with status=emitido', async () => {
        mockMigrations()
        mockDbVoid() // INSERT
        const result = await service.createCheque('company-1', 'user-1', {
          number: '456', bank: 'Banco Nacion', drawer: 'Mi Empresa', amount: 100000,
          issue_date: '2025-05-01', due_date: '2025-06-01',
          direction: 'emitido',
        }) as any
        expect(result.status).toBe('emitido')
        expect(result.direction).toBe('emitido')
      })
    })

    describe('getSummary buckets', () => {
      it('returns separate recibidos/emitidos buckets', async () => {
        mockDbRows([{
          r_total_a_cobrar: '150000', r_count_a_cobrar: '3',
          e_total_emitido: '75000', e_count_emitido: '2',
          e_total_entregado: '25000', e_count_entregado: '1',
          // legacy
          total_a_cobrar: '150000', count_a_cobrar: '3',
        }])

        const result = await service.getSummary('company-1') as any

        expect(result.recibidos.total_a_cobrar).toBe(150000)
        expect(result.recibidos.count_a_cobrar).toBe(3)
        expect(result.emitidos.total_emitido).toBe(75000)
        expect(result.emitidos.count_emitido).toBe(2)
        expect(result.emitidos.total_entregado).toBe(25000)
        // legacy flat keys preserved
        expect(result.total_a_cobrar).toBe(150000)
      })
    })
  })
})
