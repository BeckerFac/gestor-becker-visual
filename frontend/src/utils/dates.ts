/**
 * Convierte un timestamp (ISO string, Date o null) a YMD en hora LOCAL.
 *
 * Crítico: usar SIEMPRE para comparar contra dateFrom/dateTo generados por
 * PeriodSelector (que están en hora local AR). Usar `toISOString().split('T')[0]`
 * causa off-by-one cuando el timestamp UTC cae en un día distinto al local
 * (típico con eventos de la noche AR que en UTC ya son del día siguiente).
 */
export function toLocalYMD(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
