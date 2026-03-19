// AI Controller - Handles HTTP requests for AI features

import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { aiService } from './ai.service';
import { insightsService } from './insights.service';
import { narrativesService, ReportType } from './narratives.service';
import { isAiConfigured } from './ai.config';
import { checkRateLimit } from './ai.cache';
import { billingService } from '../billing/billing.service';
import { ApiError } from '../../middlewares/errorHandler';

// Check if the company has AI access (premium plan)
async function requireAiAccess(companyId: string): Promise<void> {
  try {
    const subscription = await billingService.getSubscription(companyId);
    const { aiEnabled } = subscription.plan_details.limits;

    if (!aiEnabled) {
      throw new ApiError(403, 'Las funciones de IA estan disponibles en los planes PyME, Profesional y Enterprise. Actualizá tu plan para acceder.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // If billing check fails, allow access (graceful degradation)
  }
}

class AiController {
  // GET /api/ai/status - Check if AI is available
  async getStatus(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    const configured = isAiConfigured();
    const rateLimit = checkRateLimit(companyId);

    let hasPlanAccess = false;
    try {
      const subscription = await billingService.getSubscription(companyId);
      hasPlanAccess = subscription.plan_details.limits.aiEnabled;
    } catch {
      hasPlanAccess = false;
    }

    res.json({
      configured,
      has_plan_access: hasPlanAccess,
      rate_limit: {
        remaining: rateLimit.remaining,
        max_per_day: 50,
      },
    });
  }

  // POST /api/ai/chat - Chat with GESTIA
  async chat(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    await requireAiAccess(companyId);

    const { question, mode } = req.body;

    if (!question || typeof question !== 'string') {
      throw new ApiError(400, 'El campo "question" es requerido.');
    }

    let result;
    if (mode === 'sql') {
      result = await aiService.chatWithSQL(companyId, question.trim());
    } else {
      result = await aiService.chat(companyId, question.trim());
    }

    res.json(result);
  }

  // GET /api/ai/insights - Get smart insights
  async getInsights(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    await requireAiAccess(companyId);

    const insights = await insightsService.generateInsights(companyId);
    res.json({ insights });
  }

  // POST /api/ai/narrative - Generate report narrative
  async generateNarrative(req: AuthRequest, res: Response) {
    const companyId = req.user!.company_id;
    await requireAiAccess(companyId);

    const { report_type, report_data } = req.body;

    const validTypes: ReportType[] = ['ventas', 'rentabilidad', 'clientes', 'cobranzas', 'inventario', 'conversion'];
    if (!report_type || !validTypes.includes(report_type)) {
      throw new ApiError(400, `report_type debe ser uno de: ${validTypes.join(', ')}`);
    }

    if (!report_data || typeof report_data !== 'object') {
      throw new ApiError(400, 'report_data es requerido y debe ser un objeto.');
    }

    const result = await narrativesService.generateNarrative(companyId, report_type, report_data);
    res.json(result);
  }
}

export const aiController = new AiController();
