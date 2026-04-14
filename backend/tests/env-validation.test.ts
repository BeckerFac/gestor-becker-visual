/**
 * Tests for env var fail-fast validation (CRIT-02).
 *
 * These tests exercise the REAL requireEnv/requireSecret functions from
 * src/config/env.ts, bypassing the test-wide mock defined in
 * tests/helpers/setup.ts via vi.importActual.
 */
// Seed valid secrets BEFORE the env module is evaluated on import — otherwise
// the top-level `export const env = { JWT_SECRET: requireSecret(...) }` would
// throw the moment we load the module.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-min-16-chars'
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-16chars'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Use importActual so we always get the real implementation (not any mock).
async function loadReal() {
  return await vi.importActual<typeof import('../src/config/env')>('../src/config/env')
}

describe('env validation - requireEnv / requireSecret (CRIT-02)', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // NODE_ENV=test is already set by vitest; keep the 16-char test threshold.
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('requireEnv', () => {
    it('throws when the env var is missing', async () => {
      const { requireEnv } = await loadReal()
      delete process.env.__TEST_SECRET__
      expect(() => requireEnv('__TEST_SECRET__')).toThrow(/Missing required env var/)
    })

    it('throws when the env var is empty string', async () => {
      const { requireEnv } = await loadReal()
      process.env.__TEST_SECRET__ = ''
      expect(() => requireEnv('__TEST_SECRET__')).toThrow(/Missing required env var/)
    })

    it('throws when the env var is only whitespace', async () => {
      const { requireEnv } = await loadReal()
      process.env.__TEST_SECRET__ = '   '
      expect(() => requireEnv('__TEST_SECRET__')).toThrow(/Missing required env var/)
    })

    it('returns the value when set', async () => {
      const { requireEnv } = await loadReal()
      process.env.__TEST_SECRET__ = 'hello'
      expect(requireEnv('__TEST_SECRET__')).toBe('hello')
    })
  })

  describe('requireSecret - length check', () => {
    it('throws when secret is below minimum (test mode: <16 chars)', async () => {
      const { requireSecret } = await loadReal()
      process.env.__TEST_SECRET__ = 'short-12345' // 11 chars
      expect(() => requireSecret('__TEST_SECRET__')).toThrow(/at least 16 characters/)
    })

    it('throws when secret is unset', async () => {
      const { requireSecret } = await loadReal()
      delete process.env.__TEST_SECRET__
      expect(() => requireSecret('__TEST_SECRET__')).toThrow(/Missing required env var/)
    })

    it('accepts 16-char secret in test mode', async () => {
      const { requireSecret } = await loadReal()
      process.env.__TEST_SECRET__ = 'abcdefghijklmnop' // 16 chars, mixed
      expect(requireSecret('__TEST_SECRET__')).toBe('abcdefghijklmnop')
    })

    it('enforces >=32 chars when NODE_ENV=production', async () => {
      const { requireSecret } = await loadReal()
      process.env.NODE_ENV = 'production'
      process.env.__TEST_SECRET__ = 'only-24-chars-xxxxxxxxxx' // 24 chars
      expect(() => requireSecret('__TEST_SECRET__')).toThrow(/at least 32 characters/)
    })

    it('accepts a 32+ char random-looking secret in production', async () => {
      const { requireSecret } = await loadReal()
      process.env.NODE_ENV = 'production'
      process.env.__TEST_SECRET__ = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7' // 34 chars, varied
      expect(requireSecret('__TEST_SECRET__')).toBe('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7')
    })
  })

  describe('requireSecret - entropy / known-default checks', () => {
    it('rejects secrets with all identical characters', async () => {
      const { requireSecret } = await loadReal()
      process.env.__TEST_SECRET__ = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' // 32 x's
      expect(() => requireSecret('__TEST_SECRET__')).toThrow(/low entropy/)
    })

    it('rejects well-known default "secret"', async () => {
      const { requireSecret } = await loadReal()
      // Use minLength=4 so the length check does not fire before the default check.
      process.env.__TEST_SECRET__ = 'secret'
      expect(() => requireSecret('__TEST_SECRET__', 4)).toThrow(/well-known default/)
    })

    it('rejects well-known default "changeme" (case-insensitive)', async () => {
      const { requireSecret } = await loadReal()
      process.env.__TEST_SECRET__ = 'CHANGEME'
      expect(() => requireSecret('__TEST_SECRET__', 4)).toThrow(/well-known default/)
    })
  })
})
