// AI Router - Routes for AI features

import { Router } from 'express';
import { aiController } from './ai.controller';
import { authorize } from '../../middlewares/authorize';

export const aiRouter = Router();

// Status check (any authenticated user)
aiRouter.get('/status', (req, res) => aiController.getStatus(req as any, res));

// Chat endpoint (requires dashboard view permission at minimum)
aiRouter.post('/chat', authorize('dashboard', 'view'), (req, res) => aiController.chat(req as any, res));

// Smart insights (requires dashboard view)
aiRouter.get('/insights', authorize('dashboard', 'view'), (req, res) => aiController.getInsights(req as any, res));

// Report narrative generation (requires dashboard view)
aiRouter.post('/narrative', authorize('dashboard', 'view'), (req, res) => aiController.generateNarrative(req as any, res));
