// Email verification template - sent after registration

import { baseLayout, ctaButton, escapeHtml } from './base'

interface VerificationEmailData {
  name: string
  verifyUrl: string
}

export function verificationEmailHtml(data: VerificationEmailData): string {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1f2937;">Verifica tu email</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
      Hola <strong>${escapeHtml(data.name)}</strong>,
    </p>
    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
      Gracias por registrarte en Gestor BeckerVisual. Para completar tu registro, verifica tu email haciendo clic en el boton:
    </p>
    ${ctaButton('Verificar Email', data.verifyUrl)}
    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;line-height:1.5;">
      Este enlace expira en <strong>24 horas</strong>.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
      Si no creaste una cuenta, podes ignorar este email.
    </p>
  `

  return baseLayout({
    preheader: 'Verifica tu email para completar el registro',
    body,
  })
}
