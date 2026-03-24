import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDbExecute, mockDbRows, mockDbEmpty, resetMocks } from './helpers/setup'

import {
  AccountingEntriesService,
  accountingEnabledCache,
  ACCOUNTS,
} from '../src/modules/accounting/accounting-entries.service'

describe('AccountingEntriesService', () => {
  let service: AccountingEntriesService

  beforeEach(() => {
    resetMocks()
    vi.clearAllMocks()
    accountingEnabledCache.clear()
    service = new AccountingEntriesService()
  })

  // ── Helpers ──────────────────────────────────────────────────────────────
  /** Mock isAccountingEnabled -> true */
  function mockAccountingEnabled() {
    mockDbRows([{ accounting_enabled: true }])
  }

  /** Mock isAccountingEnabled -> false */
  function mockAccountingDisabled() {
    mockDbRows([{ accounting_enabled: false }])
  }

  /** Mock resolveAccountId to return a deterministic ID based on code */
  function mockResolveAccount(code?: string) {
    mockDbRows([{ id: `account-${code || 'x'}` }])
  }

  /** Mock createEntry: entry INSERT RETURNING, then N resolveAccountId + line INSERTs */
  function mockCreateEntryFlow(lineCount: number) {
    // Entry INSERT RETURNING
    mockDbRows([{ id: 'entry-1', entry_number: 1 }])
    // For each line: resolveAccountId + line INSERT
    for (let i = 0; i < lineCount; i++) {
      mockResolveAccount(`line-${i}`)
      mockDbRows([{ id: `line-${i}` }])
    }
  }

  // ── createEntryForInvoice ────────────────────────────────────────────────
  describe('createEntryForInvoice', () => {
    it('should create entry for normal invoice with IVA 21%', async () => {
      mockAccountingEnabled()
      // createEntry: entry INSERT + 3 lines (Deudores, Ventas, IVA DF 21%)
      mockCreateEntryFlow(3)

      const result = await service.createEntryForInvoice({
        id: 'inv-1',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 12100,
        subtotal: 10000,
        vat_amount: 2100,
        invoice_type: 'A',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
      // Verify db.execute was called (isAccountingEnabled + createEntry + lines)
      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should create entry with multi-aliquot IVA (21% + 10.5%)', async () => {
      mockAccountingEnabled()
      // 4 lines: Deudores, Ventas, IVA DF 21%, IVA DF 10.5%
      mockCreateEntryFlow(4)

      const result = await service.createEntryForInvoice({
        id: 'inv-2',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 11575, // 10000 + 1050 + 525
        items: [
          { quantity: 1, unit_price: 5000, vat_rate: 21 },
          { quantity: 1, unit_price: 5000, vat_rate: 10.5 },
        ],
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create reverse entry for NC (nota credito)', async () => {
      mockAccountingEnabled()
      // NC: 3 lines: Ventas(D), IVA DF(D), Deudores(C)
      mockCreateEntryFlow(3)

      const result = await service.createEntryForInvoice({
        id: 'nc-1',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 12100,
        subtotal: 10000,
        vat_amount: 2100,
        invoice_type: 'NC_A',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create entry for ND (nota debito) with Otros Ingresos', async () => {
      mockAccountingEnabled()
      // ND: 3 lines: Deudores(D), Otros Ingresos(C), IVA DF(C)
      mockCreateEntryFlow(3)

      const result = await service.createEntryForInvoice({
        id: 'nd-1',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 12100,
        subtotal: 10000,
        vat_amount: 2100,
        invoice_type: 'ND_A',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should skip if accounting not enabled', async () => {
      mockAccountingDisabled()

      const result = await service.createEntryForInvoice({
        id: 'inv-skip',
        company_id: 'company-1',
        total: 12100,
      })

      expect(result).toBeNull()
      // Only the isAccountingEnabled query should have been called
      expect(mockDbExecute).toHaveBeenCalledTimes(1)
    })

    it('should still create entry when total is 0 (zero-amount invoice)', async () => {
      mockAccountingEnabled()
      // 2 lines: Deudores(D:0), Ventas(C:0) - no IVA line since vat=0
      mockCreateEntryFlow(2)

      const result = await service.createEntryForInvoice({
        id: 'inv-zero',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 0,
        subtotal: 0,
        vat_amount: 0,
      })

      expect(result).toBeDefined()
    })
  })

  // ── createEntryForCobro ──────────────────────────────────────────────────
  describe('createEntryForCobro', () => {
    it('should create entry for cash cobro (Caja)', async () => {
      // createEntry: entry INSERT + 2 lines (Caja, Deudores)
      mockCreateEntryFlow(2)

      const result = await service.createEntryForCobro({
        id: 'cobro-1',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 5000,
        payment_method: 'efectivo',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create entry for transfer cobro (uses Caja account)', async () => {
      mockCreateEntryFlow(2)

      const result = await service.createEntryForCobro({
        id: 'cobro-2',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 8000,
        payment_method: 'transferencia',
        bank_id: 'bank-1',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create entry for cheque cobro (uses Caja account)', async () => {
      mockCreateEntryFlow(2)

      const result = await service.createEntryForCobro({
        id: 'cobro-3',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 15000,
        payment_method: 'cheque',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create entry for advance cobro (uses Caja account)', async () => {
      mockCreateEntryFlow(2)

      const result = await service.createEntryForCobro({
        id: 'cobro-4',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 3000,
        payment_method: 'anticipo',
        pending_status: 'advance',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })
  })

  // ── createEntryForPago ───────────────────────────────────────────────────
  describe('createEntryForPago', () => {
    it('should create entry for pago without retentions', async () => {
      // createEntry: entry INSERT + 2 lines (Proveedores, Caja)
      mockCreateEntryFlow(2)

      const result = await service.createEntryForPago({
        id: 'pago-1',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 10000,
        payment_method: 'efectivo',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create entry for pago with IIBB + Ganancias retentions (main entry only)', async () => {
      // The current implementation creates the main entry with Proveedores/Caja
      // Retentions are in the data but the main pago entry uses full amount
      mockCreateEntryFlow(2)

      const result = await service.createEntryForPago({
        id: 'pago-2',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 8500,
        payment_method: 'transferencia',
        retenciones: [
          { type: 'iibb', amount: 1000 },
          { type: 'ganancias', amount: 500 },
        ],
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should skip for cheque_endosado payment method', async () => {
      const result = await service.createEntryForPago({
        id: 'pago-3',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 5000,
        payment_method: 'cheque_endosado',
      })

      expect(result).toBeNull()
      expect(mockDbExecute).not.toHaveBeenCalled()
    })

    it('should create entry for advance pago (uses standard Proveedores/Caja)', async () => {
      mockCreateEntryFlow(2)

      const result = await service.createEntryForPago({
        id: 'pago-4',
        company_id: 'company-1',
        date: '2025-06-15',
        amount: 2000,
        payment_method: 'anticipo',
        pending_status: 'advance',
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })
  })

  // ── createEntryForPurchaseInvoice ────────────────────────────────────────
  describe('createEntryForPurchaseInvoice', () => {
    it('should create entry with IVA CF 21%', async () => {
      // 3 lines: CMV(D), IVA CF 21%(D), Proveedores(C)
      mockCreateEntryFlow(3)

      const result = await service.createEntryForPurchaseInvoice({
        id: 'pi-1',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 12100,
        subtotal: 10000,
        vat_amount: 2100,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })

    it('should create entry with no IVA when vat_amount is 0', async () => {
      // 2 lines: CMV(D), Proveedores(C) - no IVA line
      mockCreateEntryFlow(2)

      const result = await service.createEntryForPurchaseInvoice({
        id: 'pi-2',
        company_id: 'company-1',
        date: '2025-06-15',
        total: 10000,
        subtotal: 10000,
        vat_amount: 0,
      })

      expect(result).toBeDefined()
      expect(result.id).toBe('entry-1')
    })
  })

  // ── createEntryForChequeTransition ───────────────────────────────────────
  describe('createEntryForChequeTransition', () => {
    it('should create entry for depositado (Cartera -> Depositados)', async () => {
      mockAccountingEnabled()
      // getAccountId x2, entry INSERT, 2 line INSERTs
      mockResolveAccount(ACCOUNTS.CHEQUES_DEPOSITADOS)
      mockResolveAccount(ACCOUNTS.CHEQUES_CARTERA)
      mockDbRows([{ id: 'entry-cheque-1' }]) // entry INSERT
      mockDbEmpty() // line INSERT 1
      mockDbEmpty() // line INSERT 2

      await service.createEntryForChequeTransition({
        id: 'cheque-1',
        company_id: 'company-1',
        amount: 5000,
        old_status: 'en_cartera',
        new_status: 'depositado',
        date: '2025-06-15',
      })

      // isAccountingEnabled + 2 getAccountId + entry INSERT + 2 line INSERTs = 6 calls
      expect(mockDbExecute).toHaveBeenCalledTimes(6)
    })

    it('should create entry for cobrado from depositado (Depositados -> Banco)', async () => {
      mockAccountingEnabled()
      // ensureBankAccount: check existing account
      mockDbRows([{ code: '1.1.2.bank1234' }]) // bank account exists
      // getAccountId x2
      mockResolveAccount('bank')
      mockResolveAccount(ACCOUNTS.CHEQUES_DEPOSITADOS)
      // entry INSERT + 2 line INSERTs
      mockDbRows([{ id: 'entry-cheque-2' }])
      mockDbEmpty()
      mockDbEmpty()

      await service.createEntryForChequeTransition({
        id: 'cheque-2',
        company_id: 'company-1',
        amount: 5000,
        old_status: 'depositado',
        new_status: 'cobrado',
        bank_id: 'bank12345678',
        date: '2025-06-15',
      })

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should create entry for endosado (Cartera -> Proveedores)', async () => {
      mockAccountingEnabled()
      // getAccountId x2
      mockResolveAccount(ACCOUNTS.PROVEEDORES)
      mockResolveAccount(ACCOUNTS.CHEQUES_CARTERA)
      // entry INSERT + 2 line INSERTs
      mockDbRows([{ id: 'entry-cheque-3' }])
      mockDbEmpty()
      mockDbEmpty()

      await service.createEntryForChequeTransition({
        id: 'cheque-3',
        company_id: 'company-1',
        amount: 8000,
        old_status: 'en_cartera',
        new_status: 'endosado',
        date: '2025-06-15',
      })

      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('should create entry for rechazado (recrea deuda)', async () => {
      mockAccountingEnabled()
      // getAccountId x2
      mockResolveAccount(ACCOUNTS.DEUDORES_VENTAS)
      mockResolveAccount(ACCOUNTS.CHEQUES_CARTERA)
      // entry INSERT + 2 line INSERTs
      mockDbRows([{ id: 'entry-cheque-4' }])
      mockDbEmpty()
      mockDbEmpty()

      await service.createEntryForChequeTransition({
        id: 'cheque-4',
        company_id: 'company-1',
        amount: 5000,
        old_status: 'en_cartera',
        new_status: 'rechazado',
        date: '2025-06-15',
      })

      expect(mockDbExecute).toHaveBeenCalled()
    })
  })

  // ── createReverseEntry ───────────────────────────────────────────────────
  describe('createReverseEntry', () => {
    it('should create reverse entry swapping debit/credit', async () => {
      mockAccountingEnabled()
      // Find original entry
      mockDbRows([{ id: 'original-entry', description: 'Cobro registrado', date: '2025-06-15' }])
      // Get original lines
      mockDbRows([
        { account_id: 'acc-1', debit: 5000, credit: 0, description: 'Caja' },
        { account_id: 'acc-2', debit: 0, credit: 5000, description: 'Deudores' },
      ])
      // Create reverse entry INSERT
      mockDbRows([{ id: 'reverse-entry-1' }])
      // Insert reversed lines (2 lines)
      mockDbEmpty()
      mockDbEmpty()

      await service.createReverseEntry('company-1', 'cobro', 'cobro-1')

      // isAccountingEnabled + find original + get lines + insert reverse + 2 line inserts = 6
      expect(mockDbExecute).toHaveBeenCalledTimes(6)
    })

    it('should skip if no original entry found', async () => {
      mockAccountingEnabled()
      // Find original entry - empty
      mockDbEmpty()

      await service.createReverseEntry('company-1', 'cobro', 'cobro-nonexistent')

      // isAccountingEnabled + find original = 2 calls
      expect(mockDbExecute).toHaveBeenCalledTimes(2)
    })
  })

  // ── Balance validation ───────────────────────────────────────────────────
  describe('balance validation', () => {
    it('should always have DEBE = HABER in every entry (rejects unbalanced)', async () => {
      await expect(
        service.createEntry({
          companyId: 'company-1',
          date: '2025-06-15',
          description: 'Unbalanced entry',
          lines: [
            { accountCode: ACCOUNTS.CAJA, debit: 5000, credit: 0 },
            { accountCode: ACCOUNTS.DEUDORES_VENTAS, debit: 0, credit: 3000 },
          ],
        })
      ).rejects.toThrow('Asiento desbalanceado')
    })
  })

  // ── createOpeningEntry ───────────────────────────────────────────────────
  describe('createOpeningEntry', () => {
    it('should create opening entry with valid balances', async () => {
      mockAccountingEnabled()
      // Check no existing opening entry
      mockDbEmpty()
      // Create entry INSERT
      mockDbRows([{ id: 'opening-1' }])
      // getAccountId + line INSERT for each balance line
      mockResolveAccount(ACCOUNTS.CAJA)
      mockDbEmpty()
      mockResolveAccount(ACCOUNTS.CAPITAL)
      mockDbEmpty()

      const result = await service.createOpeningEntry('company-1', '2025-01-01', [
        { account_code: ACCOUNTS.CAJA, debit: 50000, credit: 0 },
        { account_code: ACCOUNTS.CAPITAL, debit: 0, credit: 50000 },
      ])

      expect(result).toEqual({ id: 'opening-1' })
    })

    it('should reject if DEBE != HABER', async () => {
      mockAccountingEnabled()

      await expect(
        service.createOpeningEntry('company-1', '2025-01-01', [
          { account_code: ACCOUNTS.CAJA, debit: 50000, credit: 0 },
          { account_code: ACCOUNTS.CAPITAL, debit: 0, credit: 30000 },
        ])
      ).rejects.toThrow('El asiento no balancea')
    })

    it('should reject if opening entry already exists', async () => {
      mockAccountingEnabled()
      // Check existing opening entry -> found one
      mockDbRows([{ id: 'existing-opening' }])

      await expect(
        service.createOpeningEntry('company-1', '2025-01-01', [
          { account_code: ACCOUNTS.CAJA, debit: 10000, credit: 0 },
          { account_code: ACCOUNTS.CAPITAL, debit: 0, credit: 10000 },
        ])
      ).rejects.toThrow('Ya existe un asiento de apertura')
    })
  })
})
