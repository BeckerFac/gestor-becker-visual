/**
 * Extract rows from a drizzle db.execute() result.
 * Drizzle's execute() returns a type that doesn't expose .rows in TypeScript
 * but the underlying pg driver always returns { rows: T[] }.
 */
export function getRows<T = Record<string, any>>(result: unknown): T[] {
  if (result && typeof result === 'object') {
    if ('rows' in result && Array.isArray((result as Record<string, any>).rows)) {
      return (result as Record<string, any>).rows as T[];
    }
    if (Array.isArray(result)) {
      return result as T[];
    }
  }
  return [];
}

/**
 * Extract first row from a drizzle db.execute() result.
 */
export function getFirstRow<T = Record<string, any>>(result: unknown): T | undefined {
  return getRows<T>(result)[0];
}
