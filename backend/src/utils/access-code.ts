import { randomBytes } from 'crypto';
import { logger } from '../lib/logger';

// Minimum acceptable length for new access codes. Legacy codes may be shorter;
// see isLegacyAccessCode below for the warn-but-allow path.
export const ACCESS_CODE_MIN_LENGTH = 12;

/**
 * Generate a cryptographically-strong URL-safe access code.
 *
 * 12 random bytes encoded as base64url yields 16 URL-safe characters with
 * 96 bits of entropy — sufficient to make online brute force infeasible even
 * without rate limiting.
 */
export function generateAccessCode(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Treat anything shorter than ACCESS_CODE_MIN_LENGTH as a legacy code from
 * before HIGH-6 was fixed. Callers should still accept it, but emit a warning
 * so operators can track rotation progress.
 */
export function isLegacyAccessCode(code: string): boolean {
  return typeof code === 'string' && code.length < ACCESS_CODE_MIN_LENGTH;
}

export function warnIfLegacyAccessCode(code: string, context: Record<string, unknown> = {}): void {
  if (isLegacyAccessCode(code)) {
    logger.warn(
      'Legacy short access_code used; consider rotating to a 12+ char code',
      { ...context, codeLength: code.length },
    );
  }
}
