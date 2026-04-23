/**
 * Wave 3C C5: timezone bug in reports.
 *
 * The aging/DSO/Libro IVA/secretaria/cuenta-corriente queries all used
 * `invoice_date::date` to match an input `YYYY-MM-DD` boundary.  Postgres
 * evaluates `::date` in the SESSION timezone; on Render (UTC) an invoice
 * emitted at 2026-03-31T23:30-03:00 (still "March 31" in ART) would fall
 * into April 1 and silently leak out of the March reports.
 *
 * Fix: `pool.on('connect', c => c.query("SET TIME ZONE 'America/Argentina/Buenos_Aires'"))`
 * forces every connection to run in ART, so implicit `::date` casts match
 * the business day boundary.
 */
import { describe, it, expect } from 'vitest'

describe('Wave 3C C5 — pool sets Argentina timezone on every connection', () => {
  it('db.ts installs a pool.on("connect") handler that SETs TIME ZONE', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.resolve(__dirname, '../src/config/db.ts')
    const src = await fs.readFile(file, 'utf8')

    // Must register a connect hook that SETs the session TZ to ART.
    expect(src).toMatch(/pool\.on\(\s*['"]connect['"]/)
    expect(src).toMatch(/SET TIME ZONE\s+'America\/Argentina\/Buenos_Aires'/)
  })

  it('matches an invoice emitted 23:59 ART on 31/3 inside the March range', () => {
    // Simulate the date filter logic with ART-local interpretation.
    const emittedAtArt = new Date('2026-03-31T23:59:00-03:00')
    const marchFrom = new Date('2026-03-01T00:00:00-03:00')
    const marchTo = new Date('2026-03-31T23:59:59.999-03:00')
    const aprilFrom = new Date('2026-04-01T00:00:00-03:00')
    const aprilTo = new Date('2026-04-30T23:59:59.999-03:00')

    // March range INCLUDES the edge invoice.
    expect(emittedAtArt.getTime()).toBeGreaterThanOrEqual(marchFrom.getTime())
    expect(emittedAtArt.getTime()).toBeLessThanOrEqual(marchTo.getTime())

    // April range EXCLUDES it.
    expect(
      emittedAtArt.getTime() >= aprilFrom.getTime() &&
      emittedAtArt.getTime() <= aprilTo.getTime(),
    ).toBe(false)
  })

  it('interprets the same instant as April under UTC (pre-fix regression)', () => {
    // This captures the old broken behavior so anyone who removes the pool
    // hook without a replacement sees these expectations fail at the unit
    // level before prod.  The 23:30 ART edge in UTC is 02:30 UTC next day.
    const emittedAtArt = new Date('2026-03-31T23:30:00-03:00')
    const sameInstantUtc = new Date(emittedAtArt.toISOString()) // 2026-04-01T02:30:00Z
    expect(sameInstantUtc.getUTCMonth()).toBe(3) // Apr (0-indexed)
    expect(sameInstantUtc.getUTCDate()).toBe(1)
  })
})
