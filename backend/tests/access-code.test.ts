import { describe, it, expect } from 'vitest';
import {
  generateAccessCode,
  isLegacyAccessCode,
  ACCESS_CODE_MIN_LENGTH,
} from '../src/utils/access-code';

describe('generateAccessCode', () => {
  it('returns a string of at least ACCESS_CODE_MIN_LENGTH chars', () => {
    const code = generateAccessCode();
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThanOrEqual(ACCESS_CODE_MIN_LENGTH);
  });

  it('only uses URL-safe base64url characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAccessCode();
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('produces 1000 unique codes (entropy sanity)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateAccessCode());
    }
    expect(set.size).toBe(1000);
  });
});

describe('isLegacyAccessCode', () => {
  it('flags short codes as legacy', () => {
    expect(isLegacyAccessCode('abc123')).toBe(true);
    expect(isLegacyAccessCode('1234567')).toBe(true);
  });

  it('does not flag 12+ char codes', () => {
    expect(isLegacyAccessCode('abcdef123456')).toBe(false);
    expect(isLegacyAccessCode(generateAccessCode())).toBe(false);
  });

  it('handles non-string inputs safely', () => {
    expect(isLegacyAccessCode(undefined as unknown as string)).toBe(false);
    expect(isLegacyAccessCode(null as unknown as string)).toBe(false);
  });
});
