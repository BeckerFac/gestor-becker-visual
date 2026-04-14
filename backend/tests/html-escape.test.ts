import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, safeNumber } from '../src/lib/html-escape';

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters plus forward slash', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
    expect(escapeHtml('/')).toBe('&#x2F;');
  });

  it('returns empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through plain strings unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
    expect(escapeHtml('Juan Perez')).toBe('Juan Perez');
  });

  it('escapes a script injection payload', () => {
    const payload = "<script>alert('xss')</script>";
    const out = escapeHtml(payload);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&#39;');
  });

  it('escapes img onerror payloads', () => {
    const payload = '"><img src=x onerror=alert(1)>';
    const out = escapeHtml(payload);
    expect(out).not.toContain('<img');
    expect(out).toContain('&quot;');
    expect(out).toContain('&gt;');
    expect(out).toContain('&lt;img');
  });

  it('coerces numbers and booleans', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
  });

  it('escapes ampersands before other entities (no double-escape)', () => {
    // A raw & should become &amp; exactly once.
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });
});

describe('escapeAttr', () => {
  it('is equivalent to escapeHtml', () => {
    expect(escapeAttr('" onload="alert(1)')).toBe(escapeHtml('" onload="alert(1)'));
  });
});

describe('safeNumber', () => {
  it('keeps digits and currency punctuation', () => {
    expect(safeNumber('$ 1.234,56')).toBe('$ 1.234,56');
    expect(safeNumber(42)).toBe('42');
    expect(safeNumber('-100.00')).toBe('-100.00');
  });

  it('strips letters and tags', () => {
    expect(safeNumber('1<script>2')).toBe('12');
    expect(safeNumber('abc42xyz')).toBe('42');
  });
});
