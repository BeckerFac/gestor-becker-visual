import { describe, it, expect } from 'vitest';
import { validatePasswordStrength } from '../src/utils/password';

describe('validatePasswordStrength', () => {
  it('rejects empty password', () => {
    const r = validatePasswordStrength('');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Minimo 8 caracteres');
  });

  it('rejects passwords shorter than 8 chars', () => {
    const r = validatePasswordStrength('Ab1x');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Minimo 8 caracteres');
  });

  it('rejects passwords without uppercase', () => {
    const r = validatePasswordStrength('abcdef123');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Al menos 1 letra mayuscula');
  });

  it('rejects passwords without lowercase', () => {
    const r = validatePasswordStrength('ABCDEF123');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Al menos 1 letra minuscula');
  });

  it('rejects passwords without digits', () => {
    const r = validatePasswordStrength('AbcdefGhi');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Al menos 1 numero');
  });

  it('rejects passwords longer than 128 chars', () => {
    const r = validatePasswordStrength('A1' + 'a'.repeat(200));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Maximo 128 caracteres');
  });

  it('rejects common password "Password1" when normalized is in blacklist', () => {
    // "password1" is in the blacklist; case-insensitive check.
    const r = validatePasswordStrength('Password1');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Password muy comun, usa uno mas unico');
  });

  it('rejects common password "admin123" after upper tweak', () => {
    const r = validatePasswordStrength('Admin123');
    // "admin123" is in the blacklist.
    expect(r.errors).toContain('Password muy comun, usa uno mas unico');
  });

  it('rejects "Contrasena123" (spanish common)', () => {
    const r = validatePasswordStrength('Contrasena123');
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Password muy comun, usa uno mas unico');
  });

  it('accepts strong unique password', () => {
    const r = validatePasswordStrength('M1Cl4ve#Seg2026');
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accumulates multiple errors for very weak input', () => {
    const r = validatePasswordStrength('abc');
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
