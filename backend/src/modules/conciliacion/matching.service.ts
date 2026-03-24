import { db } from '../../config/db';
import { sql } from 'drizzle-orm';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

interface MatchCandidate {
  id: string;
  type: 'cobro' | 'pago';
  amount: number;
  date: string;
  reference: string;
}

export class MatchingService {
  /**
   * Auto-match bank statement lines against cobros and pagos.
   * Match criteria:
   * - Reference match = confidence 1.0
   * - Exact amount + date within 3 days = confidence 0.9
   * - Exact amount + date further away = confidence 0.6
   */
  async autoMatch(statementId: string, companyId: string): Promise<{ matched: number; total: number }> {
    // Get unmatched lines
    const linesResult = await db.execute(sql`
      SELECT id, line_date, description, amount, reference
      FROM bank_statement_lines
      WHERE statement_id = ${statementId} AND status = 'pending'
    `);
    const lines = (linesResult as any).rows || [];
    if (lines.length === 0) return { matched: 0, total: 0 };

    // Get cobros (positive amounts in bank = inflows = cobros)
    const cobrosResult = await db.execute(sql`
      SELECT c.id, c.amount, c.payment_date, c.reference
      FROM cobros c
      WHERE c.company_id = ${companyId}
        AND c.id NOT IN (
          SELECT matched_id FROM bank_statement_lines
          WHERE matched_id IS NOT NULL AND matched_type = 'cobro'
        )
    `);
    const cobros: MatchCandidate[] = ((cobrosResult as any).rows || []).map((r: any) => ({
      id: r.id,
      type: 'cobro' as const,
      amount: parseFloat(r.amount),
      date: r.payment_date,
      reference: r.reference || '',
    }));

    // Get pagos (negative amounts in bank = outflows = pagos)
    const pagosResult = await db.execute(sql`
      SELECT p.id, p.amount, p.payment_date, p.reference
      FROM pagos p
      WHERE p.company_id = ${companyId}
        AND p.id NOT IN (
          SELECT matched_id FROM bank_statement_lines
          WHERE matched_id IS NOT NULL AND matched_type = 'pago'
        )
    `);
    const pagos: MatchCandidate[] = ((pagosResult as any).rows || []).map((r: any) => ({
      id: r.id,
      type: 'pago' as const,
      amount: -parseFloat(r.amount), // Negate: pagos are outflows
      date: r.payment_date,
      reference: r.reference || '',
    }));

    const candidates = [...cobros, ...pagos];
    const usedCandidates = new Set<string>();
    let matchedCount = 0;

    for (const line of lines) {
      const lineAmount = parseFloat(line.amount);
      const lineDate = new Date(line.line_date).getTime();
      const lineRef = (line.reference || '').toLowerCase().trim();

      let bestMatch: { candidate: MatchCandidate; confidence: number } | null = null;

      for (const candidate of candidates) {
        if (usedCandidates.has(candidate.id)) continue;

        const candidateRef = candidate.reference.toLowerCase().trim();

        // Reference match (strongest)
        if (lineRef && candidateRef && lineRef === candidateRef) {
          bestMatch = { candidate, confidence: 1.0 };
          break;
        }

        // Partial reference match with amount
        if (lineRef && candidateRef && lineRef.includes(candidateRef) && Math.abs(lineAmount - candidate.amount) < 0.01) {
          bestMatch = { candidate, confidence: 0.95 };
          continue;
        }

        // Amount match + date proximity
        if (Math.abs(lineAmount - candidate.amount) < 0.01) {
          const candidateDate = new Date(candidate.date).getTime();
          const daysDiff = Math.abs(lineDate - candidateDate);

          if (daysDiff <= THREE_DAYS_MS) {
            const conf = 0.9;
            if (!bestMatch || conf > bestMatch.confidence) {
              bestMatch = { candidate, confidence: conf };
            }
          } else {
            const conf = 0.6;
            if (!bestMatch || conf > bestMatch.confidence) {
              bestMatch = { candidate, confidence: conf };
            }
          }
        }
      }

      if (bestMatch) {
        await db.execute(sql`
          UPDATE bank_statement_lines
          SET matched_type = ${bestMatch.candidate.type},
              matched_id = ${bestMatch.candidate.id}::uuid,
              match_confidence = ${bestMatch.confidence},
              status = 'matched'
          WHERE id = ${line.id}::uuid
        `);
        usedCandidates.add(bestMatch.candidate.id);
        matchedCount++;
      }
    }

    // Update statement matched count
    await db.execute(sql`
      UPDATE bank_statements
      SET matched_lines = (
        SELECT COUNT(*) FROM bank_statement_lines
        WHERE statement_id = ${statementId}::uuid AND status = 'matched'
      )
      WHERE id = ${statementId}::uuid
    `);

    return { matched: matchedCount, total: lines.length };
  }

  /**
   * Manually confirm a match between a statement line and a cobro/pago.
   */
  async confirmMatch(lineId: string, type: 'cobro' | 'pago', matchId: string): Promise<void> {
    await db.execute(sql`
      UPDATE bank_statement_lines
      SET matched_type = ${type},
          matched_id = ${matchId}::uuid,
          match_confidence = ${1.0},
          status = 'matched'
      WHERE id = ${lineId}::uuid
    `);

    // Update statement matched count
    await db.execute(sql`
      UPDATE bank_statements
      SET matched_lines = (
        SELECT COUNT(*) FROM bank_statement_lines
        WHERE statement_id = bank_statements.id AND status = 'matched'
      )
      WHERE id = (
        SELECT statement_id FROM bank_statement_lines WHERE id = ${lineId}::uuid
      )
    `);
  }

  /**
   * Remove a match from a statement line.
   */
  async unmatch(lineId: string): Promise<void> {
    await db.execute(sql`
      UPDATE bank_statement_lines
      SET matched_type = NULL,
          matched_id = NULL,
          match_confidence = NULL,
          status = 'pending'
      WHERE id = ${lineId}::uuid
    `);

    // Update statement matched count
    await db.execute(sql`
      UPDATE bank_statements
      SET matched_lines = (
        SELECT COUNT(*) FROM bank_statement_lines
        WHERE statement_id = bank_statements.id AND status = 'matched'
      )
      WHERE id = (
        SELECT statement_id FROM bank_statement_lines WHERE id = ${lineId}::uuid
      )
    `);
  }
}

export const matchingService = new MatchingService();
