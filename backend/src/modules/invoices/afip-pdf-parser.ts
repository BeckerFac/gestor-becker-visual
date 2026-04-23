// Best-effort parser for AFIP-authorized invoice PDFs (standard "Factura A/B/C"
// template emitted by ARCA/AFIP). Extracts the fields needed to prefill the
// "Importar Factura Manual" form. Designed to be defensive: every field is
// optional and returned as null when not confidently parsed. The frontend lets
// the user review/correct before saving.
//
// Not attempted: OCR on scanned PDFs (pdf-parse only reads native text).

export interface ParsedAfipInvoice {
  invoice_type: 'A' | 'B' | 'C' | null;
  punto_venta: string | null;          // zero-padded, e.g., "00002"
  invoice_number: string | null;       // zero-padded, e.g., "00001852"
  invoice_number_full: string | null;  // "00002-00001852"
  invoice_date: string | null;         // ISO "YYYY-MM-DD"
  cae: string | null;                  // 14 digits
  cae_expiry_date: string | null;      // ISO "YYYY-MM-DD"
  seller_cuit: string | null;          // 11 digits (issuer — usually the company itself)
  customer_cuit: string | null;        // 11 digits (receiver)
  customer_name: string | null;
  items: Array<{
    code: string | null;
    product_name: string;
    quantity: number;
    unit_price: number;
    vat_rate: number;
    subtotal: number;      // neto (unit_price * quantity, before IVA)
    subtotal_with_vat: number | null;
  }>;
  totals: {
    neto: number | null;
    iva: number | null;
    total: number | null;
  };
  warnings: string[];
}

function parseDateArgToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  const yy = m[3];
  const n = (x: string) => parseInt(x, 10);
  if (n(mm) < 1 || n(mm) > 12 || n(dd) < 1 || n(dd) > 31) return null;
  return `${yy}-${mm}-${dd}`;
}

function parseEsNumber(s: string | null | undefined): number | null {
  if (s == null) return null;
  // AFIP format: "23.553,72" or "23553,72". Remove thousands dots, convert comma to dot.
  const cleaned = String(s).trim().replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const v = parseFloat(cleaned);
  return isFinite(v) ? v : null;
}

export function parseAfipInvoicePdfText(rawText: string): ParsedAfipInvoice {
  const warnings: string[] = [];
  const text = (rawText || '').replace(/\r/g, '');

  // --- Tipo de comprobante (A / B / C) ---
  let invoice_type: 'A' | 'B' | 'C' | null = null;
  // Pattern "A FACTURA" or "B FACTURA" or "C FACTURA" near the doc header.
  const typeMatch = /(?:^|\n)\s*([ABC])\s+FACTURA\b/m.exec(text);
  if (typeMatch) invoice_type = typeMatch[1] as 'A' | 'B' | 'C';
  if (!invoice_type) {
    // Fallback: "COD. 01" → A, "COD. 06" → B, "COD. 11" → C.
    const codMatch = /COD\.?\s*(\d{2})/.exec(text);
    if (codMatch) {
      const c = codMatch[1];
      if (c === '01') invoice_type = 'A';
      else if (c === '06') invoice_type = 'B';
      else if (c === '11') invoice_type = 'C';
    }
  }
  if (!invoice_type) warnings.push('No se pudo detectar el tipo (A/B/C) del comprobante');

  // --- Punto de venta + Comp. Nro ---
  let punto_venta: string | null = null;
  let invoice_number: string | null = null;
  const pvMatch = /Punto\s+de\s+Venta[:\s]*(\d{1,5})\s+Comp\.?\s*Nro[.:\s]*(\d{1,8})/i.exec(text);
  if (pvMatch) {
    punto_venta = pvMatch[1].padStart(5, '0');
    invoice_number = pvMatch[2].padStart(8, '0');
  } else {
    // Fallback: separate lookups.
    const pv = /Punto\s+de\s+Venta[:\s]*(\d{1,5})/i.exec(text);
    const cn = /Comp\.?\s*Nro[.:\s]*(\d{1,8})/i.exec(text);
    if (pv) punto_venta = pv[1].padStart(5, '0');
    if (cn) invoice_number = cn[1].padStart(8, '0');
  }
  const invoice_number_full = punto_venta && invoice_number ? `${punto_venta}-${invoice_number}` : null;
  if (!invoice_number_full) warnings.push('No se pudo leer el número de comprobante');

  // --- CAE + Fecha Vto. CAE ---
  let cae: string | null = null;
  const caeMatch = /CAE\s*N[°ºo][.:\s]*(\d{14})/i.exec(text);
  if (caeMatch) cae = caeMatch[1];
  if (!cae) {
    // Loose fallback: any 14-digit run close to the text "CAE".
    const loose = /(\d{14})/g;
    let m: RegExpExecArray | null;
    while ((m = loose.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (/CAE/i.test(before)) { cae = m[1]; break; }
    }
  }
  if (!cae) warnings.push('No se pudo leer el CAE');

  let cae_expiry_date: string | null = null;
  const caeExpMatch = /Fecha\s+de\s+Vto\.?\s+de\s+CAE[:\s]*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  if (caeExpMatch) cae_expiry_date = parseDateArgToIso(caeExpMatch[1]);

  // --- Fecha de Emisión ---
  let invoice_date: string | null = null;
  const emMatch = /Fecha\s+de\s+Emisi[oó]n[:\s]*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  if (emMatch) invoice_date = parseDateArgToIso(emMatch[1]);

  // --- CUITs: the first 11-digit run is the issuer, the second is the customer ---
  const cuits: string[] = [];
  const cuitGlobal = /\b(\d{11})\b/g;
  let cm: RegExpExecArray | null;
  while ((cm = cuitGlobal.exec(text)) && cuits.length < 5) cuits.push(cm[1]);
  // The same CUIT sometimes repeats (Ingresos Brutos = CUIT). Dedupe while
  // preserving order.
  const dedupCuits = cuits.filter((v, i, arr) => arr.indexOf(v) === i);
  const seller_cuit = dedupCuits[0] || null;
  const customer_cuit = dedupCuits[1] || null;
  if (!customer_cuit) warnings.push('No se pudo leer el CUIT del cliente');

  // --- Customer name ---
  let customer_name: string | null = null;
  if (customer_cuit) {
    // "20369013603 KINZTLER ALAN JOEL" — name usually follows the customer CUIT
    // in the text stream.
    const re = new RegExp(`${customer_cuit}\\s+([A-ZÁÉÍÓÚÑ0-9][^\\n]{2,80})`, 'i');
    const m2 = re.exec(text);
    if (m2) {
      // Trim trailing address / extra labels by stopping at "Domicilio",
      // "Condición", CUIT keyword, or line break.
      customer_name = m2[1]
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*(Domicilio|Condici[oó]n|CUIT|Apellido|Raz[oó]n Social|IVA).*$/i, '')
        .trim();
      if (!customer_name) customer_name = null;
    }
  }

  // --- Line items ---
  // The AFIP row layout is:
  //   <código> <descripción ...> <cantidad> <u.medida> <precio unit> <% bonif>
  //   <subtotal> <alícuota IVA>% <subtotal c/IVA>
  // Many PDFs concatenate rows into a single line; others break at spaces.
  // We match greedily on a line-level regex.
  const items: ParsedAfipInvoice['items'] = [];
  const lineRe = /(\d{2,6})\s+([^\n]+?)\s+(\d{1,3}(?:[.,]\d{1,4})?)\s+(unidades?|unidad|u|m2|kg|m|ml|lt|litros?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d{1,2}(?:[.,]\d+)?)%?\s+([\d.,]+)/gi;
  let lm: RegExpExecArray | null;
  while ((lm = lineRe.exec(text))) {
    const code = lm[1];
    const name = lm[2].trim();
    const qty = parseEsNumber(lm[3]);
    // lm[4] = unit of measure (ignored — we don't have this field in the form)
    const unitPrice = parseEsNumber(lm[5]);
    // lm[6] = % bonif
    const subtotal = parseEsNumber(lm[7]);
    const vatRate = parseEsNumber(lm[8]);
    const subWithVat = parseEsNumber(lm[9]);
    if (qty == null || unitPrice == null || vatRate == null || subtotal == null) continue;
    items.push({
      code: code || null,
      product_name: name,
      quantity: qty,
      unit_price: unitPrice,
      vat_rate: vatRate,
      subtotal,
      subtotal_with_vat: subWithVat,
    });
  }
  if (items.length === 0) warnings.push('No se pudieron leer los items de la factura. Cargalos manualmente.');

  // --- Totals ---
  const netoMatch = /Importe\s+Neto\s+Gravado[:\s$]*([\d.,]+)/i.exec(text);
  const totalMatch = /Importe\s+Total[:\s$]*([\d.,]+)/i.exec(text);
  // IVA can be split across rows (27%, 21%, 10.5%, ...). Sum anything labeled "IVA NN%".
  const ivaLineRe = /IVA\s+\d+(?:[.,]\d+)?\s*%[:\s$]*([\d.,]+)/gi;
  let ivaSum = 0;
  let ivaFound = false;
  let ivaMatch: RegExpExecArray | null;
  while ((ivaMatch = ivaLineRe.exec(text))) {
    const v = parseEsNumber(ivaMatch[1]);
    if (v != null) { ivaSum += v; ivaFound = true; }
  }
  const totals = {
    neto: netoMatch ? parseEsNumber(netoMatch[1]) : null,
    iva: ivaFound ? ivaSum : null,
    total: totalMatch ? parseEsNumber(totalMatch[1]) : null,
  };

  return {
    invoice_type,
    punto_venta,
    invoice_number,
    invoice_number_full,
    invoice_date,
    cae,
    cae_expiry_date,
    seller_cuit,
    customer_cuit,
    customer_name,
    items,
    totals,
    warnings,
  };
}
