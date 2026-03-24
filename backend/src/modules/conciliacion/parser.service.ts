/**
 * CSV parser for bank statements.
 * Supports generic CSV and common Argentine bank formats (Galicia, Macro, Santander, BBVA).
 */

export interface ParsedLine {
  date: string;       // ISO date string YYYY-MM-DD
  description: string;
  amount: number;     // positive = credit, negative = debit
  reference: string;
}

interface ColumnMapping {
  date: number;
  description: number;
  debit?: number;
  credit?: number;
  amount?: number;
  reference?: number;
  balance?: number;
}

type BankType = 'galicia' | 'macro' | 'santander' | 'bbva' | 'generic';

const BANK_COLUMN_MAPS: Record<string, ColumnMapping> = {
  // Galicia: Fecha, Descripcion, Referencia, Debito, Credito, Saldo
  galicia: { date: 0, description: 1, reference: 2, debit: 3, credit: 4, balance: 5 },
  // Macro: Fecha, Concepto, Nro Comprobante, Debito, Credito, Saldo
  macro: { date: 0, description: 1, reference: 2, debit: 3, credit: 4, balance: 5 },
  // Santander: Fecha, Descripcion, Importe, Saldo
  santander: { date: 0, description: 1, amount: 2, balance: 3 },
  // BBVA: Fecha, Concepto, Referencia, Debe, Haber, Saldo
  bbva: { date: 0, description: 1, reference: 2, debit: 3, credit: 4, balance: 5 },
};

function parseArgDate(raw: string): string {
  const trimmed = raw.trim();
  // DD/MM/YYYY or DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${month}-${day}`;
  }
  // YYYY-MM-DD already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Fallback: try native parsing
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Cannot parse date: "${raw}"`);
}

function parseAmount(raw: string): number {
  if (!raw || !raw.trim()) return 0;
  // Argentine format: 1.234,56 or -1.234,56
  const cleaned = raw.trim().replace(/\s/g, '');
  // If contains comma as decimal separator
  if (cleaned.includes(',')) {
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized) || 0;
  }
  return parseFloat(cleaned) || 0;
}

function splitCSVLine(line: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function detectSeparator(firstLine: string): string {
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  if (tabCount >= semicolonCount && tabCount >= commaCount && tabCount > 0) return '\t';
  if (semicolonCount >= commaCount && semicolonCount > 0) return ';';
  return ',';
}

function detectBankType(headers: string[]): BankType {
  const joined = headers.map(h => h.toLowerCase()).join('|');
  if (joined.includes('galicia')) return 'galicia';
  if (joined.includes('macro') || joined.includes('nro comprobante')) return 'macro';
  if (joined.includes('santander')) return 'santander';
  if (joined.includes('bbva') || joined.includes('frances')) return 'bbva';
  return 'generic';
}

function detectGenericColumns(headers: string[]): ColumnMapping {
  const lower = headers.map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const mapping: Partial<ColumnMapping> = {};

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (!mapping.date && (h.includes('fecha') || h.includes('date'))) mapping.date = i;
    if (!mapping.description && (h.includes('concepto') || h.includes('descripcion') || h.includes('detalle') || h.includes('description'))) mapping.description = i;
    if (mapping.debit === undefined && (h.includes('debito') || h.includes('debe') || h.includes('debit'))) mapping.debit = i;
    if (mapping.credit === undefined && (h.includes('credito') || h.includes('haber') || h.includes('credit'))) mapping.credit = i;
    if (mapping.amount === undefined && (h.includes('importe') || h.includes('monto') || h.includes('amount'))) mapping.amount = i;
    if (mapping.reference === undefined && (h.includes('referencia') || h.includes('comprobante') || h.includes('reference') || h.includes('nro'))) mapping.reference = i;
    if (mapping.balance === undefined && (h.includes('saldo') || h.includes('balance'))) mapping.balance = i;
  }

  // Defaults if not found
  if (mapping.date === undefined) mapping.date = 0;
  if (mapping.description === undefined) mapping.description = 1;
  if (mapping.amount === undefined && mapping.debit === undefined) mapping.amount = 2;

  return mapping as ColumnMapping;
}

export function parseCSV(csvContent: string, bankType?: string): ParsedLine[] {
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const separator = detectSeparator(lines[0]);
  const headers = splitCSVLine(lines[0], separator);

  const resolvedType: BankType = (bankType as BankType) || detectBankType(headers);
  const columns: ColumnMapping = resolvedType === 'generic'
    ? detectGenericColumns(headers)
    : BANK_COLUMN_MAPS[resolvedType];

  const result: ParsedLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCSVLine(lines[i], separator);
    if (fields.length < 2) continue;

    try {
      const dateField = fields[columns.date] || '';
      if (!dateField.trim()) continue;

      const date = parseArgDate(dateField);
      const description = fields[columns.description] || '';
      const reference = columns.reference !== undefined ? (fields[columns.reference] || '') : '';

      let amount: number;
      if (columns.amount !== undefined) {
        amount = parseAmount(fields[columns.amount]);
      } else {
        const debit = columns.debit !== undefined ? parseAmount(fields[columns.debit]) : 0;
        const credit = columns.credit !== undefined ? parseAmount(fields[columns.credit]) : 0;
        // Debit is outflow (negative), Credit is inflow (positive)
        amount = credit > 0 ? credit : (debit > 0 ? -debit : 0);
      }

      if (amount === 0 && !description) continue;

      result.push({ date, description, amount, reference });
    } catch {
      // Skip unparseable lines
      continue;
    }
  }

  return result;
}
