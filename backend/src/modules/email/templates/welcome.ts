// Welcome email template - sent after email verification completes

import { baseLayout, ctaButton, escapeHtml, BRAND_COLOR } from './base'

interface WelcomeEmailData {
  name: string
  companyName: string
  loginUrl: string
}

export function welcomeEmailHtml(data: WelcomeEmailData): string {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1f2937;">Bienvenido a Gestor BeckerVisual</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      Hola <strong>${escapeHtml(data.name)}</strong>,
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
      Tu cuenta fue creada exitosamente para <strong>${escapeHtml(data.companyName)}</strong>. Ya podes empezar a usar todas las herramientas:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">
      <tr>
        <td style="padding:8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;vertical-align:top;padding-right:10px;font-size:16px;color:${BRAND_COLOR};">&#10003;</td>
              <td style="font-size:14px;color:#374151;line-height:1.5;">Gestionar productos y listas de precios</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;vertical-align:top;padding-right:10px;font-size:16px;color:${BRAND_COLOR};">&#10003;</td>
              <td style="font-size:14px;color:#374151;line-height:1.5;">Administrar clientes y contactos</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;vertical-align:top;padding-right:10px;font-size:16px;color:${BRAND_COLOR};">&#10003;</td>
              <td style="font-size:14px;color:#374151;line-height:1.5;">Crear facturas electronicas autorizadas por AFIP</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:28px;vertical-align:top;padding-right:10px;font-size:16px;color:${BRAND_COLOR};">&#10003;</td>
              <td style="font-size:14px;color:#374151;line-height:1.5;">Generar catalogos PDF y enviar facturas por email</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${ctaButton('Iniciar Sesion', data.loginUrl)}
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
      Si tenes dudas, contacta con nuestro equipo de soporte.
    </p>
  `

  return baseLayout({
    preheader: `Bienvenido a Gestor BeckerVisual, ${escapeHtml(data.name)}`,
    body,
  })
}
