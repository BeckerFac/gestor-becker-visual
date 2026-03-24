import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { accountingEntriesService, accountingEnabledCache } from './accounting-entries.service';
import { seedChartOfAccounts, migrateChartOfAccounts } from './chart-seed';

export class AccountingController {
  async getChartOfAccounts(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getChartOfAccounts(req.user!.company_id);
    res.json(data);
  }

  async createAccount(req: AuthRequest, res: Response) {
    const { code, name, type, parent_id, level, is_header } = req.body;
    if (!code || !name || !type) {
      return res.status(400).json({ error: 'code, name y type son requeridos' });
    }
    const validTypes = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'egreso'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type debe ser uno de: ${validTypes.join(', ')}` });
    }
    const data = await accountingEntriesService.createAccount(req.user!.company_id, {
      code, name, type, parent_id, level, is_header,
    });
    res.status(201).json(data);
  }

  async getEntries(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getEntries(req.user!.company_id, {
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
      reference_type: req.query.reference_type as string,
      is_auto: req.query.is_auto as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(data);
  }

  async createManualEntry(req: AuthRequest, res: Response) {
    const { date, description, lines } = req.body;
    if (!date || !lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'date y lines son requeridos' });
    }
    const data = await accountingEntriesService.createEntry({
      companyId: req.user!.company_id,
      date,
      description: description || 'Asiento manual',
      isAuto: false,
      createdBy: req.user!.id,
      lines,
    });
    res.status(201).json(data);
  }

  async deleteEntry(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.deleteEntry(
      req.user!.company_id,
      req.params.id,
    );
    res.json(data);
  }

  async getBalance(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getBalance(req.user!.company_id, {
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    });
    res.json(data);
  }

  async getLedger(req: AuthRequest, res: Response) {
    const accountCode = req.query.account_code as string;
    if (!accountCode) {
      return res.status(400).json({ error: 'account_code es requerido' });
    }
    const data = await accountingEntriesService.getLedger(req.user!.company_id, accountCode, {
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    });
    res.json(data);
  }

  async getBalanceSheet(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getBalanceSheet(
      req.user!.company_id,
      req.query.date as string,
    );
    res.json(data);
  }

  async getIncomeStatement(req: AuthRequest, res: Response) {
    const data = await accountingEntriesService.getIncomeStatement(req.user!.company_id, {
      date_from: req.query.date_from as string,
      date_to: req.query.date_to as string,
    });
    res.json(data);
  }

  async seedChart(req: AuthRequest, res: Response) {
    const data = await seedChartOfAccounts(req.user!.company_id);
    res.json(data);
  }

  async createOpeningEntry(req: AuthRequest, res: Response) {
    const { date, balances } = req.body;
    if (!date || !balances || !Array.isArray(balances) || balances.length === 0) {
      return res.status(400).json({ error: 'date y balances son requeridos' });
    }
    const result = await accountingEntriesService.createOpeningEntry(
      req.user!.company_id,
      date,
      balances,
    );
    res.status(201).json({ success: true, ...result });
  }

  async enableAccounting(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;

    // 1. Set flag
    await db.execute(sql`UPDATE companies SET accounting_enabled = true WHERE id = ${companyId}`);

    // 2. Seed chart if needed
    await seedChartOfAccounts(companyId);

    // 3. Migrate if old chart exists
    await migrateChartOfAccounts(companyId);

    // 4. Add to enabled_modules
    await db.execute(sql`
      UPDATE companies SET enabled_modules = array_append(
        COALESCE(enabled_modules, ARRAY[]::text[]), 'accounting'
      ) WHERE id = ${companyId} AND NOT ('accounting' = ANY(COALESCE(enabled_modules, ARRAY[]::text[])))
    `);

    // 5. Clear cache
    accountingEnabledCache.delete(companyId);

    res.json({ success: true, message: 'Contabilidad activada' });
  }
}

export const accountingController = new AccountingController();
