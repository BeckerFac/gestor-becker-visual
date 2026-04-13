/**
 * Safe numeric parser that never returns NaN.
 *
 * parseFloat sin guards devuelve NaN para strings vacios, null, undefined,
 * y strings corruptos (ej "$500"). Propagar NaN rompe comparaciones
 * (NaN > 0 es false), reduce (sum + NaN = NaN), y displays ("NaN").
 *
 * Usar este helper en lugar de parseFloat directo en cualquier cálculo o
 * comparación. Para preservar NaN como señal diagnóstica (CSV export),
 * pasar NaN como fallback: num(x, NaN).
 */
export const num = (v: unknown, fb = 0): number => {
  if (v === null || v === undefined || v === '') return fb;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fb;
  // Sanitize: strip currency symbols, thousand separators, spaces.
  const cleaned = String(v).replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fb;
};

/** Strict numeric check, returns null if invalid. */
export const numOrNull = (v: unknown): number | null => {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
};
