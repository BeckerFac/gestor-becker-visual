/**
 * HTML escaping helpers for safe interpolation of user-controlled values
 * into HTML templates (PDFs rendered via Puppeteer, emails, etc.).
 *
 * HIGH-4 fix: prevents XSS/HTML injection when untrusted fields such as
 * client names, addresses or notes are interpolated into template strings.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

const ESCAPE_REGEX = /[&<>"'/]/g;

/**
 * Escape a value for safe use inside HTML text nodes or attribute values.
 * null/undefined become ''. Non-string inputs are coerced via String().
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(ESCAPE_REGEX, (char) => ESCAPE_MAP[char]);
}

/**
 * Alias for attribute contexts — same implementation as escapeHtml,
 * kept as a separate symbol so call sites document intent.
 */
export function escapeAttr(input: unknown): string {
  return escapeHtml(input);
}

/**
 * For pre-formatted numeric / currency strings that the caller trusts.
 * Strips anything that isn't a digit, punctuation or common currency glyph.
 */
export function safeNumber(n: number | string): string {
  return String(n).replace(/[^0-9.,\-$\s]/g, '');
}
