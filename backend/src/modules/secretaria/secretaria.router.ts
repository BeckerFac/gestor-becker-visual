// SecretarIA — Routes

import { Router } from 'express';
import { secretariaController } from './secretaria.controller';
import { authMiddleware } from '../../middlewares/auth';
import { authorize } from '../../middlewares/authorize';

export const secretariaRouter = Router();

// ── Public endpoints (WhatsApp webhooks) ──

// Meta webhook verification (GET)
secretariaRouter.get('/webhook', (req, res) => secretariaController.verifyWebhook(req, res));

// Incoming messages (POST) — signature validated inside controller
secretariaRouter.post('/webhook', (req, res) => secretariaController.handleWebhook(req, res));

// ── Authenticated + authorized endpoints ──

const auth = [authMiddleware];

secretariaRouter.get(
  '/config',
  ...auth,
  authorize('secretaria', 'view'),
  (req, res) => secretariaController.getConfig(req as any, res),
);

secretariaRouter.put(
  '/config',
  ...auth,
  authorize('secretaria', 'edit'),
  (req, res) => secretariaController.updateConfig(req as any, res),
);

secretariaRouter.post(
  '/link',
  ...auth,
  authorize('secretaria', 'edit'),
  (req, res) => secretariaController.generateLinkingCode(req as any, res),
);

secretariaRouter.get(
  '/usage',
  ...auth,
  authorize('secretaria', 'view'),
  (req, res) => secretariaController.getUsage(req as any, res),
);

secretariaRouter.get(
  '/conversations',
  ...auth,
  authorize('secretaria', 'view'),
  (req, res) => secretariaController.getConversations(req as any, res),
);

secretariaRouter.get(
  '/linked-phones',
  ...auth,
  authorize('secretaria', 'view'),
  (req, res) => secretariaController.getLinkedPhones(req as any, res),
);

secretariaRouter.delete(
  '/linked-phones/:id',
  ...auth,
  authorize('secretaria', 'edit'),
  (req, res) => secretariaController.unlinkPhone(req as any, res),
);
