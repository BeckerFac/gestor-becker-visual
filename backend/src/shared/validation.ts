// Password validation: min 8 chars, 1 uppercase, 1 lowercase, 1 number
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('La contrasena debe tener al menos 8 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('La contrasena debe contener al menos una mayuscula');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('La contrasena debe contener al menos una minuscula');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('La contrasena debe contener al menos un numero');
  }

  return { valid: errors.length === 0, errors };
}

// CUIT validation: 11 digits, valid format XX-XXXXXXXX-X
export function validateCuit(cuit: string): boolean {
  const clean = cuit.replace(/-/g, '');
  if (!/^\d{11}$/.test(clean)) return false;

  // Validate check digit
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean[i], 10) * multipliers[i];
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;

  return checkDigit === parseInt(clean[10], 10);
}

// Email validation
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
