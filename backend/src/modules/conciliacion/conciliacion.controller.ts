import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import { parseCSV } from './parser.service';
import { matchingService } from './matching.service';
import { ApiError } from '../../middlewares/errorHandler';

export class ConciliacionController {
  /**
   * POST /conciliacion/upload
   * Body: { csvContent: string, bankId?: string, bankType?: string, fileName?: string, period?: string }
   */
  async upload(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    const { csvContent, bankId, bankType, fileName, period } = req.body;

    if (!csvContent || typeof csvContent !== 'string') {
      throw new ApiError(400, 'csvContent is required');
    }

    // Parse CSV
    const parsedLines = parseCSV(csvContent, bankType);
    if (parsedLines.length === 0) {
      throw new ApiError(400, 'No valid lines found in CSV');
    }

    // Create statement record
    const stmtResult = await db.execute(sql`
      INSERT INTO bank_statements (company_id, bank_id, period, file_name, total_lines)
      VALUES (
        ${companyId}::uuid,
        ${bankId || null}::uuid,
        ${period || null},
        ${fileName || 'upload.csv'},
        ${parsedLines.length}
      )
      RETURNING id
    `);
    const statementId = ((stmtResult as any).rows || [])[0]?.id;
    if (!statementId) throw new ApiError(500, 'Failed to create bank statement');

    // Insert lines
    for (const line of parsedLines) {
      await db.execute(sql`
        INSERT INTO bank_statement_lines (statement_id, line_date, description, amount, reference)
        VALUES (
          ${statementId}::uuid,
          ${line.date}::date,
          ${line.description},
          ${line.amount},
          ${line.reference}
        )
      `);
    }

    // Auto-match
    const matchResult = await matchingService.autoMatch(statementId, companyId);

    // Return created statement with summary
    const statement = await this.getStatementById(statementId, companyId);
    res.status(201).json({
      ...statement,
      autoMatchResult: matchResult,
    });
  }

  /**
   * GET /conciliacion/statements
   */
  async getStatements(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    const result = await db.execute(sql`
      SELECT bs.*,
        b.bank_name
      FROM bank_statements bs
      LEFT JOIN banks b ON b.id = bs.bank_id
      WHERE bs.company_id = ${companyId}
      ORDER BY bs.uploaded_at DESC
    `);
    res.json((result as any).rows || []);
  }

  /**
   * GET /conciliacion/statements/:id
   */
  async getStatement(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const statement = await this.getStatementById(id, companyId);
    if (!statement) throw new ApiError(404, 'Statement not found');
    res.json(statement);
  }

  /**
   * POST /conciliacion/match
   * Body: { lineId, type: 'cobro'|'pago', matchId }
   */
  async manualMatch(req: AuthRequest, res: Response) {
    const { lineId, type, matchId } = req.body;
    if (!lineId || !type || !matchId) {
      throw new ApiError(400, 'lineId, type and matchId are required');
    }
    if (type !== 'cobro' && type !== 'pago') {
      throw new ApiError(400, 'type must be "cobro" or "pago"');
    }
    await matchingService.confirmMatch(lineId, type, matchId);
    res.json({ success: true });
  }

  /**
   * DELETE /conciliacion/match/:lineId
   */
  async unmatch(req: AuthRequest, res: Response) {
    const { lineId } = req.params;
    await matchingService.unmatch(lineId);
    res.json({ success: true });
  }

  /**
   * POST /conciliacion/statements/:id/auto-match
   */
  async autoMatch(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    const { id } = req.params;
    const result = await matchingService.autoMatch(id, companyId);
    res.json(result);
  }

  private async getStatementById(id: string, companyId: string) {
    const stmtResult = await db.execute(sql`
      SELECT bs.*, b.bank_name
      FROM bank_statements bs
      LEFT JOIN banks b ON b.id = bs.bank_id
      WHERE bs.id = ${id}::uuid AND bs.company_id = ${companyId}
    `);
    const statement = ((stmtResult as any).rows || [])[0];
    if (!statement) return null;

    const linesResult = await db.execute(sql`
      SELECT bsl.*,
        CASE
          WHEN bsl.matched_type = 'cobro' THEN (
            SELECT json_build_object(
              'id', c.id,
              'amount', c.amount,
              'payment_method', c.payment_method,
              'payment_date', c.payment_date,
              'reference', c.reference,
              'enterprise_name', e.name
            )
            FROM cobros c
            LEFT JOIN enterprises e ON e.id = c.enterprise_id
            WHERE c.id = bsl.matched_id
          )
          WHEN bsl.matched_type = 'pago' THEN (
            SELECT json_build_object(
              'id', p.id,
              'amount', p.amount,
              'payment_method', p.payment_method,
              'payment_date', p.payment_date,
              'reference', p.reference,
              'enterprise_name', e.name
            )
            FROM pagos p
            LEFT JOIN enterprises e ON e.id = p.enterprise_id
            WHERE p.id = bsl.matched_id
          )
          ELSE NULL
        END as matched_record
      FROM bank_statement_lines bsl
      WHERE bsl.statement_id = ${id}::uuid
      ORDER BY bsl.line_date ASC, bsl.created_at ASC
    `);

    return {
      ...statement,
      lines: (linesResult as any).rows || [],
    };
  }
}

export const conciliacionController = new ConciliacionController();
