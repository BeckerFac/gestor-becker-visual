// Base HTML email layout shared by all transactional templates.
// Brand colors and responsive structure.

const BRAND_COLOR = '#0066cc'
const BRAND_NAME = 'Gestor BeckerVisual'
const FOOTER_TEXT = 'Gestion Comercial Profesional'

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface BaseLayoutOptions {
  preheader?: string
  body: string
}

function baseLayout(options: BaseLayoutOptions): string {
  const preheaderStyle = options.preheader
    ? `<span style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;">${escapeHtml(options.preheader)}</span>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${BRAND_NAME}</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,sans-serif!important;}</style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  ${preheaderStyle}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">${BRAND_NAME}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 24px;">
              ${options.body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e8e8eb;margin:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                ${BRAND_NAME} &mdash; ${FOOTER_TEXT}<br>
                Este es un correo automatico. No respondas a este mensaje.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(text: string, url: string, color: string = BRAND_COLOR): string {
  const safeUrl = escapeHtml(url)
  return `<div style="text-align:center;margin:28px 0;">
  <!--[if mso]>
  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="13%" strokecolor="${color}" fillcolor="${color}">
    <w:anchorlock/>
    <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">${escapeHtml(text)}</center>
  </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-->
  <a href="${safeUrl}" target="_blank" style="display:inline-block;background-color:${color};color:#ffffff;padding:14px 32px;font-size:16px;font-weight:600;text-decoration:none;border-radius:6px;line-height:1;">
    ${escapeHtml(text)}
  </a>
  <!--<![endif]-->
</div>`
}

export { baseLayout, ctaButton, escapeHtml, BRAND_COLOR, BRAND_NAME }
