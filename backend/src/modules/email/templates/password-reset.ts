// Password reset email template

import { baseLayout, ctaButton, escapeHtml } from './base'

interface PasswordResetEmailData {
  name: string
  resetUrl: string
}

export function passwordResetEmailHtml(data: PasswordResetEmailData): string {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1f2937;">Restablecer contrasena</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
      Hola <strong>${escapeHtml(data.name)}</strong>,
    </p>
    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
      Recibimos una solicitud para restablecer tu contrasena. Hace clic en el boton para continuar:
    </p>
    ${ctaButton('Restablecer Contrasena', data.resetUrl, '#dc3545')}
    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;line-height:1.5;">
      Este enlace expira en <strong>1 hora</strong>.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
      Si no solicitaste esto, podes ignorar este email. Tu contrasena no sera modificada.
    </p>
  `

  return baseLayout({
    preheader: 'Restablecer tu contrasena de Gestor BeckerVisual',
    body,
  })
}
