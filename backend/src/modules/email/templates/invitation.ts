// Team invitation email template

import { baseLayout, ctaButton, escapeHtml } from './base'

interface InvitationEmailData {
  inviterName: string
  companyName: string
  role: string
  inviteUrl: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  editor: 'Editor',
  vendedor: 'Vendedor',
  contable: 'Contable',
  viewer: 'Visualizador',
}

export function invitationEmailHtml(data: InvitationEmailData): string {
  const roleLabel = ROLE_LABELS[data.role] || data.role

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1f2937;">Fuiste invitado a un equipo</h2>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
      <strong>${escapeHtml(data.inviterName)}</strong> te invito a unirte a
      <strong>${escapeHtml(data.companyName)}</strong> como <strong>${escapeHtml(roleLabel)}</strong>.
    </p>
    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">
      Acepta la invitacion para empezar a trabajar en equipo:
    </p>
    ${ctaButton('Aceptar Invitacion', data.inviteUrl, '#28a745')}
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
      Esta invitacion expira en <strong>7 dias</strong>.
    </p>
  `

  return baseLayout({
    preheader: `${escapeHtml(data.inviterName)} te invito a ${escapeHtml(data.companyName)}`,
    body,
  })
}
