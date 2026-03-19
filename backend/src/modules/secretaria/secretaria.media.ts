// SecretarIA — Outbound media sending service
// Sends PDFs, Excel reports, and preview images via WhatsApp

import { pool } from '../../config/db';
import { pdfService, InvoicePdfInput } from '../pdf/pdf.service';
import { quotesService } from '../quotes/quotes.service';
import { remitosService } from '../remitos/remitos.service';
import { whatsappClient } from './secretaria.whatsapp';
import logger from '../../config/logger';
import * as XLSX from 'xlsx';

// ── Types ──

export interface MediaSendResult {
  readonly success: boolean;
  readonly mediaId?: string;
  readonly error?: string;
}

interface CacheEntry {
  readonly buffer: Buffer;
  readonly createdAt: number;
}

// ── Constants ──

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // WhatsApp 100MB limit
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_UPLOAD_RETRIES = 2;

// ── Media Cache (in-memory, 5-min TTL) ──

const mediaCache = new Map<string, CacheEntry>();

function getCachedBuffer(key: string): Buffer | null {
  const entry = mediaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    mediaCache.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCachedBuffer(key: string, buffer: Buffer): void {
  // Evict expired entries periodically
  if (mediaCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of mediaCache) {
      if (now - v.createdAt > CACHE_TTL_MS) {
        mediaCache.delete(k);
      }
    }
  }
  mediaCache.set(key, { buffer, createdAt: Date.now() });
}

// ── Service ──

export class SecretariaMediaService {
  // --------------------------------------------------------------------------
  // uploadMedia — Upload buffer to WhatsApp Media API, returns media ID
  // --------------------------------------------------------------------------

  async uploadMedia(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string | null> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!accessToken) {
      logger.warn('[SecretarIA Media] WHATSAPP_ACCESS_TOKEN not configured - cannot upload media');
      return null;
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.error({ size: buffer.length }, '[SecretarIA Media] File exceeds WhatsApp 100MB limit');
      return null;
    }

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/media`;

    for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
      try {
        // Build multipart/form-data using native FormData (Node 18+)
        const formData = new FormData();
        const blob = new Blob([buffer], { type: mimeType });
        formData.append('file', blob, filename);
        formData.append('type', mimeType);
        formData.append('messaging_product', 'whatsapp');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
          body: formData,
        });

        if (response.ok) {
          const data = await response.json() as { id?: string };
          if (data.id) {
            logger.info({ mediaId: data.id, filename }, '[SecretarIA Media] Upload successful');
            return data.id;
          }
        }

        const status = response.status;
        if (status >= 500 && attempt < MAX_UPLOAD_RETRIES) {
          logger.warn({ status, attempt }, '[SecretarIA Media] Upload server error, retrying');
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        const errorBody = await response.text().catch(() => 'unknown');
        logger.error({ status, errorBody, filename }, '[SecretarIA Media] Upload failed');
        return null;
      } catch (error) {
        if (attempt < MAX_UPLOAD_RETRIES) {
          logger.warn({ error, attempt }, '[SecretarIA Media] Upload network error, retrying');
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        logger.error({ error, filename }, '[SecretarIA Media] Upload failed after retries');
        return null;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // sendDocumentByMediaId — Send uploaded media as document via WhatsApp
  // --------------------------------------------------------------------------

  private async sendDocumentByMediaId(
    to: string,
    mediaId: string,
    filename: string,
    caption?: string,
  ): Promise<boolean> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!accessToken) return false;

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'document',
          document: {
            id: mediaId,
            filename,
            ...(caption ? { caption } : {}),
          },
        }),
      });

      if (response.ok) return true;

      const errorBody = await response.text().catch(() => 'unknown');
      logger.error({ status: response.status, errorBody }, '[SecretarIA Media] sendDocument failed');
      return false;
    } catch (error) {
      logger.error({ error }, '[SecretarIA Media] sendDocument error');
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // sendImageByMediaId — Send uploaded media as image via WhatsApp
  // --------------------------------------------------------------------------

  private async sendImageByMediaId(
    to: string,
    mediaId: string,
    caption?: string,
  ): Promise<boolean> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!accessToken) return false;

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'image',
          image: {
            id: mediaId,
            ...(caption ? { caption } : {}),
          },
        }),
      });

      if (response.ok) return true;

      const errorBody = await response.text().catch(() => 'unknown');
      logger.error({ status: response.status, errorBody }, '[SecretarIA Media] sendImage failed');
      return false;
    } catch (error) {
      logger.error({ error }, '[SecretarIA Media] sendImage error');
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // sendInvoicePdf
  // --------------------------------------------------------------------------

  async sendInvoicePdf(
    phoneNumber: string,
    invoiceId: string,
    companyId: string,
  ): Promise<MediaSendResult> {
    try {
      // Security: verify invoice belongs to company
      const invoiceCheck = await pool.query(
        'SELECT id, invoice_number, invoice_type, company_id FROM invoices WHERE id = $1 AND company_id = $2',
        [invoiceId, companyId],
      );

      if (invoiceCheck.rows.length === 0) {
        return { success: false, error: 'No encontre esa factura.' };
      }

      const invoice = invoiceCheck.rows[0] as any;
      const invoiceNumber = String(invoice.invoice_number).padStart(5, '0');
      const invoiceType = invoice.invoice_type || 'NF';

      // Check cache
      const cacheKey = `invoice_pdf_${invoiceId}`;
      let pdfBuffer = getCachedBuffer(cacheKey);

      if (!pdfBuffer) {
        // Get company info for PDF generation
        const companyResult = await pool.query(
          'SELECT name, cuit, address, city, province, phone, email FROM companies WHERE id = $1',
          [companyId],
        );
        const company = companyResult.rows[0] as any;

        if (!company) {
          return { success: false, error: 'No encontre los datos de la empresa.' };
        }

        const pdfInput: InvoicePdfInput = {
          invoiceId,
          companyName: company.name,
          companyCuit: company.cuit,
          companyAddress: company.address,
          companyCity: company.city,
          companyProvince: company.province,
          companyPhone: company.phone,
          companyEmail: company.email,
        };

        pdfBuffer = await pdfService.generateInvoicePdf(pdfInput);
        setCachedBuffer(cacheKey, pdfBuffer);
      }

      // Upload to WhatsApp
      const filename = `factura_${invoiceType}_${invoiceNumber}.pdf`;
      const mediaId = await this.uploadMedia(pdfBuffer, 'application/pdf', filename);

      if (!mediaId) {
        return { success: false, error: 'No pude subir el archivo. Intenta desde GESTIA.' };
      }

      // Send as document
      const caption = `Factura ${invoiceType} ${invoiceNumber}`;
      const sent = await this.sendDocumentByMediaId(phoneNumber, mediaId, filename, caption);

      if (!sent) {
        return { success: false, error: 'No pude enviar el documento. Intenta de nuevo.' };
      }

      logger.info({ invoiceId, phoneNumber }, '[SecretarIA Media] Invoice PDF sent');
      return { success: true, mediaId };
    } catch (error) {
      logger.error({ error, invoiceId }, '[SecretarIA Media] sendInvoicePdf failed');
      return { success: false, error: 'No pude generar el PDF de la factura. Intenta desde GESTIA.' };
    }
  }

  // --------------------------------------------------------------------------
  // sendQuotePdf
  // --------------------------------------------------------------------------

  async sendQuotePdf(
    phoneNumber: string,
    quoteId: string,
    companyId: string,
    template: string = 'clasico',
  ): Promise<MediaSendResult> {
    try {
      // Security: verify quote belongs to company
      const quoteCheck = await pool.query(
        'SELECT id, quote_number, company_id FROM quotes WHERE id = $1 AND company_id = $2',
        [quoteId, companyId],
      );

      if (quoteCheck.rows.length === 0) {
        return { success: false, error: 'No encontre esa cotizacion.' };
      }

      const quote = quoteCheck.rows[0] as any;
      const quoteNumber = String(quote.quote_number || '').padStart(6, '0');

      // Check cache
      const cacheKey = `quote_pdf_${quoteId}_${template}`;
      let pdfBuffer = getCachedBuffer(cacheKey);

      if (!pdfBuffer) {
        pdfBuffer = await quotesService.generateQuotePdf(companyId, quoteId, template);
        setCachedBuffer(cacheKey, pdfBuffer);
      }

      // Upload to WhatsApp
      const filename = `cotizacion_${quoteNumber}.pdf`;
      const mediaId = await this.uploadMedia(pdfBuffer, 'application/pdf', filename);

      if (!mediaId) {
        return { success: false, error: 'No pude subir el archivo. Intenta desde GESTIA.' };
      }

      // Send as document
      const caption = `Cotizacion #${quoteNumber}`;
      const sent = await this.sendDocumentByMediaId(phoneNumber, mediaId, filename, caption);

      if (!sent) {
        return { success: false, error: 'No pude enviar el documento. Intenta de nuevo.' };
      }

      logger.info({ quoteId, phoneNumber }, '[SecretarIA Media] Quote PDF sent');
      return { success: true, mediaId };
    } catch (error) {
      logger.error({ error, quoteId }, '[SecretarIA Media] sendQuotePdf failed');
      return { success: false, error: 'No pude generar el PDF de la cotizacion. Intenta desde GESTIA.' };
    }
  }

  // --------------------------------------------------------------------------
  // sendRemitoPdf
  // --------------------------------------------------------------------------

  async sendRemitoPdf(
    phoneNumber: string,
    remitoId: string,
    companyId: string,
  ): Promise<MediaSendResult> {
    try {
      // Security: verify remito belongs to company
      const remitoCheck = await pool.query(
        'SELECT id, remito_number, company_id FROM remitos WHERE id = $1 AND company_id = $2',
        [remitoId, companyId],
      );

      if (remitoCheck.rows.length === 0) {
        return { success: false, error: 'No encontre ese remito.' };
      }

      const remito = remitoCheck.rows[0] as any;
      const remitoNumber = String(remito.remito_number || '').padStart(6, '0');

      // Check cache
      const cacheKey = `remito_pdf_${remitoId}`;
      let pdfBuffer = getCachedBuffer(cacheKey);

      if (!pdfBuffer) {
        pdfBuffer = await remitosService.generateRemitoPdf(companyId, remitoId);
        setCachedBuffer(cacheKey, pdfBuffer);
      }

      // Upload to WhatsApp
      const filename = `remito_${remitoNumber}.pdf`;
      const mediaId = await this.uploadMedia(pdfBuffer, 'application/pdf', filename);

      if (!mediaId) {
        return { success: false, error: 'No pude subir el archivo. Intenta desde GESTIA.' };
      }

      // Send as document
      const caption = `Remito #${remitoNumber}`;
      const sent = await this.sendDocumentByMediaId(phoneNumber, mediaId, filename, caption);

      if (!sent) {
        return { success: false, error: 'No pude enviar el documento. Intenta de nuevo.' };
      }

      logger.info({ remitoId, phoneNumber }, '[SecretarIA Media] Remito PDF sent');
      return { success: true, mediaId };
    } catch (error) {
      logger.error({ error, remitoId }, '[SecretarIA Media] sendRemitoPdf failed');
      return { success: false, error: 'No pude generar el PDF del remito. Intenta desde GESTIA.' };
    }
  }

  // --------------------------------------------------------------------------
  // sendExcelReport
  // --------------------------------------------------------------------------

  async sendExcelReport(
    phoneNumber: string,
    reportType: string,
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<MediaSendResult> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const effectiveDateFrom = dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const effectiveDateTo = dateTo || today;

      let rows: any[] = [];
      let sheetName = 'Reporte';
      let headers: string[] = [];

      switch (reportType) {
        case 'ventas': {
          const result = await pool.query(`
            SELECT
              o.order_number as "Nro Pedido",
              COALESCE(e.name, c.name, 'Sin cliente') as "Cliente",
              o.status as "Estado",
              o.payment_status as "Estado Pago",
              CAST(o.total_amount AS decimal) as "Monto",
              o.created_at as "Fecha"
            FROM orders o
            LEFT JOIN enterprises e ON o.enterprise_id = e.id
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.company_id = $1
              AND o.created_at >= $2::date
              AND o.created_at <= ($3::date + INTERVAL '1 day')
              AND o.status NOT IN ('cancelado', 'cancelled')
            ORDER BY o.created_at DESC
          `, [companyId, effectiveDateFrom, effectiveDateTo]);
          rows = result.rows;
          sheetName = 'Ventas';
          headers = ['Nro Pedido', 'Cliente', 'Estado', 'Estado Pago', 'Monto', 'Fecha'];
          break;
        }

        case 'facturas': {
          const result = await pool.query(`
            SELECT
              i.invoice_type as "Tipo",
              LPAD(COALESCE(i.invoice_number::text, '0'), 5, '0') as "Numero",
              COALESCE(e.name, c.name, 'Sin cliente') as "Cliente",
              CAST(i.total_amount AS decimal) as "Monto",
              i.status as "Estado",
              i.invoice_date as "Fecha"
            FROM invoices i
            LEFT JOIN enterprises e ON i.enterprise_id = e.id
            LEFT JOIN customers c ON i.customer_id = c.id
            WHERE i.company_id = $1
              AND i.invoice_date >= $2::date
              AND i.invoice_date <= $3::date
            ORDER BY i.invoice_date DESC
          `, [companyId, effectiveDateFrom, effectiveDateTo]);
          rows = result.rows;
          sheetName = 'Facturas';
          headers = ['Tipo', 'Numero', 'Cliente', 'Monto', 'Estado', 'Fecha'];
          break;
        }

        case 'clientes': {
          const result = await pool.query(`
            SELECT
              COALESCE(e.name, c.name, 'Sin nombre') as "Cliente",
              e.cuit as "CUIT",
              COALESCE(SUM(CAST(o.total_amount AS decimal)), 0) as "Total Facturado",
              COALESCE(SUM(CASE WHEN o.payment_status = 'pendiente' THEN CAST(o.total_amount AS decimal) ELSE 0 END), 0) as "Saldo Pendiente",
              COUNT(o.id) as "Cant Pedidos",
              MAX(o.created_at) as "Ultimo Pedido"
            FROM orders o
            LEFT JOIN enterprises e ON o.enterprise_id = e.id
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.company_id = $1
            GROUP BY COALESCE(e.name, c.name, 'Sin nombre'), e.cuit
            ORDER BY "Total Facturado" DESC
            LIMIT 100
          `, [companyId]);
          rows = result.rows;
          sheetName = 'Clientes';
          headers = ['Cliente', 'CUIT', 'Total Facturado', 'Saldo Pendiente', 'Cant Pedidos', 'Ultimo Pedido'];
          break;
        }

        case 'productos': {
          const result = await pool.query(`
            SELECT
              p.name as "Producto",
              p.sku as "SKU",
              COALESCE(CAST(pp.price AS decimal), 0) as "Precio",
              COALESCE(CAST(pp.cost AS decimal), 0) as "Costo",
              COALESCE(s.quantity, 0) as "Stock"
            FROM products p
            LEFT JOIN product_pricing pp ON pp.product_id = p.id
            LEFT JOIN stock s ON s.product_id = p.id
            WHERE p.company_id = $1 AND p.active = true
            ORDER BY p.name ASC
          `, [companyId]);
          rows = result.rows;
          sheetName = 'Productos';
          headers = ['Producto', 'SKU', 'Precio', 'Costo', 'Stock'];
          break;
        }

        case 'deudores': {
          const result = await pool.query(`
            SELECT
              COALESCE(e.name, c.name, 'Sin nombre') as "Cliente",
              e.cuit as "CUIT",
              COALESCE(SUM(CASE WHEN o.payment_status = 'pendiente' THEN CAST(o.total_amount AS decimal) ELSE 0 END), 0) as "Deuda Total",
              COUNT(CASE WHEN o.payment_status = 'pendiente' THEN 1 END) as "Facturas Pendientes",
              MAX(o.created_at) as "Ultimo Pedido"
            FROM orders o
            LEFT JOIN enterprises e ON o.enterprise_id = e.id
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.company_id = $1
            GROUP BY COALESCE(e.name, c.name, 'Sin nombre'), e.cuit
            HAVING SUM(CASE WHEN o.payment_status = 'pendiente' THEN CAST(o.total_amount AS decimal) ELSE 0 END) > 0
            ORDER BY "Deuda Total" DESC
          `, [companyId]);
          rows = result.rows;
          sheetName = 'Deudores';
          headers = ['Cliente', 'CUIT', 'Deuda Total', 'Facturas Pendientes', 'Ultimo Pedido'];
          break;
        }

        default:
          return { success: false, error: `Tipo de reporte "${reportType}" no reconocido. Disponibles: ventas, facturas, clientes, productos, deudores.` };
      }

      if (rows.length === 0) {
        return { success: false, error: `No hay datos para el reporte de ${reportType} en el periodo seleccionado.` };
      }

      // Build Excel workbook
      const worksheetData = [
        headers,
        ...rows.map(row => headers.map(h => {
          const val = row[h];
          if (val instanceof Date) return val.toLocaleDateString('es-AR');
          if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
            return new Date(val).toLocaleDateString('es-AR');
          }
          return val;
        })),
      ];

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Auto-width columns
      const colWidths = headers.map((h, idx) => {
        const maxLen = Math.max(
          h.length,
          ...rows.map(r => String(r[h] || '').length),
        );
        return { wch: Math.min(maxLen + 2, 40) };
      });
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

      const excelBuffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

      // Upload to WhatsApp
      const dateStr = today.replace(/-/g, '');
      const filename = `reporte_${reportType}_${dateStr}.xlsx`;
      const mediaId = await this.uploadMedia(
        excelBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename,
      );

      if (!mediaId) {
        return { success: false, error: 'No pude subir el archivo Excel. Intenta desde GESTIA.' };
      }

      const caption = `Reporte de ${reportType} (${effectiveDateFrom} a ${effectiveDateTo}) - ${rows.length} registros`;
      const sent = await this.sendDocumentByMediaId(phoneNumber, mediaId, filename, caption);

      if (!sent) {
        return { success: false, error: 'No pude enviar el reporte. Intenta de nuevo.' };
      }

      logger.info({ reportType, phoneNumber, rowCount: rows.length }, '[SecretarIA Media] Excel report sent');
      return { success: true, mediaId };
    } catch (error) {
      logger.error({ error, reportType }, '[SecretarIA Media] sendExcelReport failed');
      return { success: false, error: 'No pude generar el reporte Excel. Intenta desde GESTIA.' };
    }
  }

  // --------------------------------------------------------------------------
  // sendPreviewImage — Screenshot of first page of a document
  // --------------------------------------------------------------------------

  async sendPreviewImage(
    phoneNumber: string,
    documentType: 'factura' | 'cotizacion' | 'remito',
    documentId: string,
    companyId: string,
  ): Promise<MediaSendResult> {
    try {
      // Generate the PDF first
      let pdfBuffer: Buffer;
      let documentNumber: string;

      switch (documentType) {
        case 'factura': {
          const invoiceCheck = await pool.query(
            'SELECT id, invoice_number, invoice_type, company_id FROM invoices WHERE id = $1 AND company_id = $2',
            [documentId, companyId],
          );
          if (invoiceCheck.rows.length === 0) {
            return { success: false, error: 'No encontre esa factura.' };
          }
          const inv = invoiceCheck.rows[0] as any;
          documentNumber = `${inv.invoice_type || 'NF'} ${String(inv.invoice_number).padStart(5, '0')}`;

          const cacheKey = `invoice_pdf_${documentId}`;
          pdfBuffer = getCachedBuffer(cacheKey) || await (async () => {
            const companyResult = await pool.query(
              'SELECT name, cuit, address, city, province, phone, email FROM companies WHERE id = $1',
              [companyId],
            );
            const company = companyResult.rows[0] as any;
            const buf = await pdfService.generateInvoicePdf({
              invoiceId: documentId,
              companyName: company.name,
              companyCuit: company.cuit,
              companyAddress: company.address,
              companyCity: company.city,
              companyProvince: company.province,
              companyPhone: company.phone,
              companyEmail: company.email,
            });
            setCachedBuffer(cacheKey, buf);
            return buf;
          })();
          break;
        }

        case 'cotizacion': {
          const quoteCheck = await pool.query(
            'SELECT id, quote_number, company_id FROM quotes WHERE id = $1 AND company_id = $2',
            [documentId, companyId],
          );
          if (quoteCheck.rows.length === 0) {
            return { success: false, error: 'No encontre esa cotizacion.' };
          }
          const q = quoteCheck.rows[0] as any;
          documentNumber = String(q.quote_number || '').padStart(6, '0');

          const cacheKey = `quote_pdf_${documentId}_clasico`;
          pdfBuffer = getCachedBuffer(cacheKey) || await (async () => {
            const buf = await quotesService.generateQuotePdf(companyId, documentId);
            setCachedBuffer(cacheKey, buf);
            return buf;
          })();
          break;
        }

        case 'remito': {
          const remitoCheck = await pool.query(
            'SELECT id, remito_number, company_id FROM remitos WHERE id = $1 AND company_id = $2',
            [documentId, companyId],
          );
          if (remitoCheck.rows.length === 0) {
            return { success: false, error: 'No encontre ese remito.' };
          }
          const r = remitoCheck.rows[0] as any;
          documentNumber = String(r.remito_number || '').padStart(6, '0');

          const cacheKey = `remito_pdf_${documentId}`;
          pdfBuffer = getCachedBuffer(cacheKey) || await (async () => {
            const buf = await remitosService.generateRemitoPdf(companyId, documentId);
            setCachedBuffer(cacheKey, buf);
            return buf;
          })();
          break;
        }

        default:
          return { success: false, error: `Tipo de documento "${documentType}" no soportado.` };
      }

      // Convert PDF first page to PNG using Puppeteer
      let screenshotBuffer: Buffer;
      try {
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123 }); // A4 at 96 DPI

        // Render the PDF as an HTML page with embedded base64 data
        // Since Puppeteer generated the PDF, we can re-render the HTML.
        // But simpler: load the PDF as a data URL and screenshot
        const base64Pdf = pdfBuffer.toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64Pdf}`;

        // Use a simple HTML wrapper that embeds the PDF
        const html = `<!DOCTYPE html>
          <html><body style="margin:0;padding:0;background:white;">
            <embed src="${dataUrl}" type="application/pdf" width="794" height="1123" />
          </body></html>`;

        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        // Wait a moment for PDF to render in embed
        await new Promise(r => setTimeout(r, 1000));

        screenshotBuffer = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: 794, height: 1123 },
        });

        await browser.close();
      } catch (screenshotError) {
        // If screenshot fails, fall back to sending the PDF directly
        logger.warn({ error: screenshotError }, '[SecretarIA Media] Screenshot failed, sending PDF instead');

        const docTypeLabel = documentType === 'factura' ? 'Factura' : documentType === 'cotizacion' ? 'Cotizacion' : 'Remito';
        const filename = `${documentType}_${documentNumber}.pdf`;
        const mediaId = await this.uploadMedia(pdfBuffer, 'application/pdf', filename);

        if (!mediaId) {
          return { success: false, error: 'No pude subir el archivo. Intenta desde GESTIA.' };
        }

        const sent = await this.sendDocumentByMediaId(phoneNumber, mediaId, filename, `${docTypeLabel} #${documentNumber}`);
        return sent
          ? { success: true, mediaId }
          : { success: false, error: 'No pude enviar el documento.' };
      }

      // Upload screenshot as image
      const mediaId = await this.uploadMedia(screenshotBuffer, 'image/png', `preview_${documentType}_${documentNumber}.png`);

      if (!mediaId) {
        return { success: false, error: 'No pude subir la preview. Intenta desde GESTIA.' };
      }

      const docTypeLabel = documentType === 'factura' ? 'Factura' : documentType === 'cotizacion' ? 'Cotizacion' : 'Remito';
      const caption = `Preview de ${docTypeLabel} #${documentNumber}`;
      const sent = await this.sendImageByMediaId(phoneNumber, mediaId, caption);

      if (!sent) {
        return { success: false, error: 'No pude enviar la preview.' };
      }

      logger.info({ documentType, documentId, phoneNumber }, '[SecretarIA Media] Preview image sent');
      return { success: true, mediaId };
    } catch (error) {
      logger.error({ error, documentType, documentId }, '[SecretarIA Media] sendPreviewImage failed');
      return { success: false, error: 'No pude generar la preview del documento. Intenta desde GESTIA.' };
    }
  }
}

export const secretariaMediaService = new SecretariaMediaService();
