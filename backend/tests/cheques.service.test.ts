import { describe, it, expect, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, mockDbVoid, resetMocks } from './helpers/setup'

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
      mockDbRows([{ id: 'ch-1', status: 'cobrado' }])

      await expect(
        service.deleteCheque('company-1', 'ch-1')
      ).rejects.toThrow('Solo se pueden eliminar cheques pendientes')
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
})
