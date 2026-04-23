import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Regression guard for the 2026-04-23 production bug:
//   column reference "business_unit_id" is ambiguous (SQLSTATE 42702)
// Root cause: buFilter contains TWO occurrences of "business_unit_id", and
// String#replace without the /g flag only replaces the first one, leaving
// the second unaliased and triggering PostgreSQL's ambiguity error whenever
// more than one table in the UNION branch has that column.
//
// Any future buFilter.replace(...) call MUST use a global regex. This test
// fails if someone reintroduces the non-global form.

describe('cuenta-corriente buFilter aliasing (regression 2026-04-23)', () => {
  const src = readFileSync(
    join(__dirname, '../src/modules/cuenta-corriente/cuenta-corriente.service.ts'),
    'utf-8'
  )

  it("never uses buFilter.replace('business_unit_id', ...) without /g flag", () => {
    expect(src).not.toMatch(/buFilter\.replace\(\s*'business_unit_id'/)
  })

  it("every buFilter.replace is a global regex", () => {
    const matches = src.match(/buFilter\.replace\([^)]+\)/g) || []
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      expect(m).toMatch(/buFilter\.replace\(\s*\/business_unit_id\/g\s*,/)
    }
  })
})
