// SecretarIA — HTTP Controller

import { Request, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { secretariaService } from './secretaria.service';
import { whatsappClient } from './secretaria.whatsapp';
import { secretariaScheduler, isValidTimeFormat, isValidTimezone, isValidBriefSections } from './secretaria.scheduler';
import { ApiError } from '../../middlewares/errorHandler';
import { db } from '../../config/db';
import { sql } from 'drizzle-orm';
import logger from '../../config/logger';

class SecretariaController {
  // --------------------------------------------------------------------------
  // GET /webhook — Meta verification (NO auth)
  // --------------------------------------------------------------------------

  verifyWebhook(req: Request, res: Response): void {
    const challenge = whatsappClient.verifyWebhook(req.query as Record<string, string | undefined>);

    if (challenge) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Webhook verification failed' });
    }
  }

  // --------------------------------------------------------------------------
  // POST /webhook — Incoming messages (NO auth, signature validated)
  // MUST respond 200 immediately, process async
  // --------------------------------------------------------------------------

  handleWebhook(req: Request, res: Response): void {
    // Validate signature using raw body
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (rawBody && signature) {
      const valid = whatsappClient.validateWebhookSignature(rawBody, signature);
      if (!valid) {
        logger.warn('SecretarIA: invalid webhook signature');
        res.status(403).json({ error: 'Invalid signature' });
        return;
      }
    } else if (process.env.NODE_ENV === 'production') {
      // In production, require signature validation
      logger.warn('SecretarIA: missing signature or raw body in production');
      res.status(403).json({ error: 'Signature validation required' });
      return;
    }

    // Respond 200 immediately — Meta requires fast response
    res.status(200).json({ status: 'ok' });

    // Process async (fire-and-forget)
    const payload = req.body;
    if (payload?.object === 'whatsapp_business_account') {
      secretariaService.handleIncomingMessage(payload).catch(err => {
        logger.error({ err }, 'SecretarIA: unhandled error in webhook processing');
      });
    }
  }

  // --------------------------------------------------------------------------
  // POST /chat — In-app web chat (JWT auth, no WhatsApp)
  // --------------------------------------------------------------------------

  async chat(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const { message, type } = req.body;

    if (!message || typeof message !== 'string') {
      throw new ApiError(400, 'El campo "message" es requerido');
    }

    if (message.trim().length === 0) {
      throw new ApiError(400, 'El mensaje no puede estar vacio');
    }

    if (message.length > 2000) {
      throw new ApiError(400, 'El mensaje es demasiado largo (maximo 2000 caracteres)');
    }

    // Get user display name from DB (not in JWT payload)
    let userName = 'Usuario';
    try {
      const userResult = await db.execute(sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`);
      const userRows = (userResult as any).rows || userResult || [];
      if (userRows.length > 0 && userRows[0].name) {
        userName = userRows[0].name;
      }
    } catch { /* fallback to default */ }

    const result = await secretariaService.handleWebChat(
      companyId,
      userId,
      message.trim(),
      userName,
    );

    res.json(result);
  }

  // --------------------------------------------------------------------------
  // GET /chat/history — Load web chat history for current user
  // --------------------------------------------------------------------------

  async getChatHistory(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const messages = await secretariaService.getWebChatHistory(companyId, userId, limit);
    res.json({ messages });
  }

  // --------------------------------------------------------------------------
  // GET /config
  // --------------------------------------------------------------------------

  async getConfig(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const config = await secretariaService.getConfig(companyId);
    res.json(config);
  }

  // --------------------------------------------------------------------------
  // PUT /config
  // --------------------------------------------------------------------------

  async updateConfig(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const { enabled, morningBriefEnabled, morningBriefTime, timezone, briefSections } = req.body;

    const updates: Record<string, unknown> = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (typeof morningBriefEnabled === 'boolean') updates.morningBriefEnabled = morningBriefEnabled;

    if (typeof morningBriefTime === 'string') {
      if (!isValidTimeFormat(morningBriefTime)) {
        throw new ApiError(400, 'Formato de hora invalido. Usa HH:MM (ej: 08:00)');
      }
      updates.morningBriefTime = morningBriefTime;
    }

    if (typeof timezone === 'string') {
      if (!isValidTimezone(timezone)) {
        throw new ApiError(400, 'Zona horaria invalida. Usa formato IANA (ej: America/Argentina/Buenos_Aires)');
      }
      updates.timezone = timezone;
    }

    if (Array.isArray(briefSections)) {
      if (!isValidBriefSections(briefSections)) {
        throw new ApiError(400, 'Secciones de brief invalidas. Opciones: ventas, pedidos, cobros, stock, cheques, pipeline');
      }
      updates.briefSections = briefSections;
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, 'No se enviaron campos validos para actualizar');
    }

    const config = await secretariaService.updateConfig(companyId, updates);
    res.json(config);
  }

  // --------------------------------------------------------------------------
  // POST /link — Generate linking code
  // --------------------------------------------------------------------------

  async generateLinkingCode(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new ApiError(400, 'El campo "phoneNumber" es requerido');
    }

    // Basic phone validation (E.164 format or similar)
    const cleanPhone = phoneNumber.replace(/[\s\-()]/g, '');
    if (!/^\+?\d{10,15}$/.test(cleanPhone)) {
      throw new ApiError(400, 'Formato de telefono invalido. Usa formato internacional, ej: +5491112345678');
    }

    const result = await secretariaService.linkPhone(companyId, userId, cleanPhone);
    res.json({
      code: result.code,
      expiresAt: result.expiresAt,
      phoneNumber: cleanPhone,
      message: `Envia el codigo ${result.code} por WhatsApp al numero de SecretarIA para vincular tu telefono.`,
    });
  }

  // --------------------------------------------------------------------------
  // GET /usage
  // --------------------------------------------------------------------------

  async getUsage(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const usage = await secretariaService.getUsage(companyId);
    res.json(usage);
  }

  // --------------------------------------------------------------------------
  // GET /conversations
  // --------------------------------------------------------------------------

  async getConversations(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const conversations = await secretariaService.getConversations(companyId, limit);
    res.json({ conversations });
  }

  // --------------------------------------------------------------------------
  // GET /linked-phones
  // --------------------------------------------------------------------------

  async getLinkedPhones(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const phones = await secretariaService.getLinkedPhones(companyId);
    res.json({ phones });
  }

  // --------------------------------------------------------------------------
  // DELETE /linked-phones/:id
  // --------------------------------------------------------------------------

  async unlinkPhone(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;
    const phoneId = req.params.id;

    if (!phoneId) {
      throw new ApiError(400, 'ID de telefono requerido');
    }

    await secretariaService.unlinkPhone(companyId, phoneId);
    res.json({ message: 'Telefono desvinculado correctamente' });
  }

  // --------------------------------------------------------------------------
  // POST /brief/send — Trigger morning brief immediately
  // --------------------------------------------------------------------------

  async sendBriefNow(req: AuthRequest, res: Response): Promise<void> {
    const companyId = req.user!.company_id;

    const sent = await secretariaScheduler.sendBriefNow(companyId);

    if (sent) {
      res.json({ message: 'Brief enviado correctamente a los telefonos vinculados.' });
    } else {
      res.json({ message: 'No se pudo enviar el brief. Verifica que haya telefonos vinculados y verificados.' });
    }
  }
}

export const secretariaController = new SecretariaController();
