// Password strength validation helper.
// Used by auth, users, and invitations services to enforce consistent rules.

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

// Top common passwords (Spanish + English). Kept lowercase for case-insensitive
// comparison. Rejecting these blocks the most trivial credential stuffing.
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'admin',
  'admin123',
  'administrator',
  'welcome',
  'welcome1',
  'letmein',
  'iloveyou',
  'monkey',
  'dragon',
  'abc12345',
  'contrasena',
  'contrasena1',
  'contrasena123',
  'contraseña',
  'hola1234',
  'argentina',
  'boca1234',
  'river1234',
  'usuario',
  'usuario1',
  'changeme',
]);

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('Minimo 8 caracteres');
  }
  if (password && password.length > 128) {
    errors.push('Maximo 128 caracteres');
  }
  if (!/[a-z]/.test(password || '')) {
    errors.push('Al menos 1 letra minuscula');
  }
  if (!/[A-Z]/.test(password || '')) {
    errors.push('Al menos 1 letra mayuscula');
  }
  if (!/[0-9]/.test(password || '')) {
    errors.push('Al menos 1 numero');
  }
  if (password && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password muy comun, usa uno mas unico');
  }

  return { valid: errors.length === 0, errors };
}
