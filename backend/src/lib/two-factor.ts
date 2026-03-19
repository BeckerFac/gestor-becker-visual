import * as OTPAuth from 'otpauth';
import crypto from 'crypto';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../middlewares/errorHandler';
import { auditService } from '../modules/audit/audit.service';

// Application name shown in authenticator apps
const ISSUER = 'GestorBeckerVisual';

export interface TwoFactorSetupResult {
  secret: string; // Base32 encoded secret (for manual entry)
  otpauth_url: string; // URL for QR code generation
  qr_data_url: string; // Pre-generated QR code as data URL (optional, if qrcode lib is available)
}

export interface TwoFactorVerifyResult {
  valid: boolean;
}

export class TwoFactorService {
  /**
   * Generate a new 2FA secret for a user.
   * Does NOT enable 2FA yet - user must verify a code first.
   * Stores the secret encrypted in users.two_factor_secret.
   */
  async setup2FA(userId: string, userEmail: string): Promise<TwoFactorSetupResult> {
    // Check if already enabled
    const existing = await db.execute(sql`
      SELECT two_factor_enabled FROM users WHERE id = ${userId}
    `);
    const rows = (existing as any).rows || existing || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }
    if (rows[0].two_factor_enabled === true) {
      throw new ApiError(400, '2FA ya esta habilitado. Deshabilitelo primero para regenerar.');
    }

    // Generate a new TOTP secret
    const secret = new OTPAuth.Secret({ size: 20 });

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: userEmail,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const otpauthUrl = totp.toString();
    const secretBase32 = secret.base32;

    // Store the secret (not yet enabled)
    // In production, this should be encrypted with ENCRYPTION_KEY
    await db.execute(sql`
      UPDATE users
      SET two_factor_secret = ${secretBase32},
          two_factor_enabled = false
      WHERE id = ${userId}
    `);

    // Generate QR code data URL
    let qrDataUrl = '';
    try {
      const QRCode = await import('qrcode');
      qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    } catch (_err) {
      // QR code generation is optional - user can enter secret manually
    }

    return {
      secret: secretBase32,
      otpauth_url: otpauthUrl,
      qr_data_url: qrDataUrl,
    };
  }

  /**
   * Verify a TOTP code and enable 2FA if this is the first verification.
   * Called during setup (to confirm the user has set up their authenticator)
   * and during login (to verify the second factor).
   */
  async verify2FA(userId: string, token: string): Promise<TwoFactorVerifyResult> {
    if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
      throw new ApiError(400, 'Codigo 2FA invalido. Debe ser 6 digitos.');
    }

    const result = await db.execute(sql`
      SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ${userId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    const { two_factor_secret, two_factor_enabled } = rows[0] as {
      two_factor_secret: string | null;
      two_factor_enabled: boolean;
    };

    if (!two_factor_secret) {
      throw new ApiError(400, '2FA no configurado. Ejecute el setup primero.');
    }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(two_factor_secret),
    });

    // window: 1 allows +/- 30 seconds clock drift
    const delta = totp.validate({ token, window: 1 });
    const valid = delta !== null;

    if (!valid) {
      return { valid: false };
    }

    // If 2FA was not yet enabled, enable it now (first successful verification after setup)
    if (!two_factor_enabled) {
      // Generate backup codes
      const backupCodes = this.generateBackupCodes();
      const backupCodesJson = JSON.stringify(backupCodes);

      await db.execute(sql`
        UPDATE users
        SET two_factor_enabled = true,
            two_factor_backup_codes = ${backupCodesJson}
        WHERE id = ${userId}
      `);
    }

    return { valid: true };
  }

  /**
   * Disable 2FA for a user. Requires password re-verification in the controller.
   */
  async disable2FA(userId: string, companyId: string, ipAddress?: string): Promise<{ message: string }> {
    const result = await db.execute(sql`
      SELECT two_factor_enabled FROM users WHERE id = ${userId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) {
      throw new ApiError(404, 'Usuario no encontrado');
    }

    if (rows[0].two_factor_enabled !== true) {
      throw new ApiError(400, '2FA no esta habilitado');
    }

    await db.execute(sql`
      UPDATE users
      SET two_factor_enabled = false,
          two_factor_secret = NULL,
          two_factor_backup_codes = NULL
      WHERE id = ${userId}
    `);

    await auditService.log({
      companyId,
      userId,
      action: 'disable_2fa',
      entityType: 'user',
      entityId: userId,
      ipAddress,
    });

    return { message: '2FA deshabilitado exitosamente' };
  }

  /**
   * Check if a user has 2FA enabled.
   */
  async is2FAEnabled(userId: string): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT two_factor_enabled FROM users WHERE id = ${userId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) return false;
    return rows[0].two_factor_enabled === true;
  }

  /**
   * Verify a backup code (single use - consumed after verification).
   */
  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT two_factor_backup_codes FROM users WHERE id = ${userId}
    `);
    const rows = (result as any).rows || result || [];
    if (rows.length === 0) return false;

    const backupCodesRaw = rows[0].two_factor_backup_codes;
    if (!backupCodesRaw) return false;

    let backupCodes: string[];
    try {
      backupCodes = typeof backupCodesRaw === 'string'
        ? JSON.parse(backupCodesRaw)
        : backupCodesRaw;
    } catch {
      return false;
    }

    const normalizedCode = code.replace(/-/g, '').toUpperCase();
    const index = backupCodes.findIndex(
      (c: string) => c.replace(/-/g, '').toUpperCase() === normalizedCode,
    );

    if (index === -1) return false;

    // Consume the code (remove it from the list)
    const updatedCodes = [...backupCodes.slice(0, index), ...backupCodes.slice(index + 1)];
    await db.execute(sql`
      UPDATE users SET two_factor_backup_codes = ${JSON.stringify(updatedCodes)} WHERE id = ${userId}
    `);

    return true;
  }

  /**
   * Generate 10 single-use backup codes.
   * Format: XXXX-XXXX (alphanumeric, uppercase)
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
      codes.push(`${part1}-${part2}`);
    }
    return codes;
  }
}

export const twoFactorService = new TwoFactorService();

/*
 * ============================================================
 * HOW TO WIRE 2FA INTO THE LOGIN FLOW
 * ============================================================
 *
 * 1. After successful password verification in auth.service.ts login():
 *    - Check if user has 2FA enabled: await twoFactorService.is2FAEnabled(user.id)
 *    - If YES: return a partial response with { requires_2fa: true, temp_token: <short-lived JWT> }
 *      The temp_token should have a short expiry (5 min) and contain only the user ID.
 *    - If NO: return the normal login response with full tokens.
 *
 * 2. Add a new endpoint POST /api/auth/verify-2fa:
 *    - Accept { temp_token, code } in body
 *    - Verify temp_token is valid
 *    - Call twoFactorService.verify2FA(userId, code)
 *    - If valid: generate and return full access + refresh tokens
 *    - If invalid: return 401 with remaining attempts
 *
 * 3. Add endpoints for 2FA management (behind authMiddleware):
 *    - POST /api/auth/2fa/setup -> twoFactorService.setup2FA()
 *    - POST /api/auth/2fa/verify -> twoFactorService.verify2FA() (for initial setup confirmation)
 *    - POST /api/auth/2fa/disable -> twoFactorService.disable2FA() (require password re-entry)
 *
 * 4. Backup codes:
 *    - POST /api/auth/verify-2fa-backup -> twoFactorService.verifyBackupCode()
 *    - Same flow as verify-2fa but uses a backup code instead of TOTP
 *
 * 5. Frontend changes needed:
 *    - Login form: detect requires_2fa response, show 2FA input
 *    - Settings page: 2FA setup flow with QR code display
 *    - Settings page: option to disable 2FA (with password confirmation)
 */
