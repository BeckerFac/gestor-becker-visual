import { Router } from 'express';
import { accountController } from './account.controller';

const router = Router();

// GET /api/account/my-data - Export all user/company data (Ley 25.326)
router.get('/my-data', (req, res) => accountController.exportMyData(req, res));

// GET /api/account/deletion-status - Check pending deletion status
router.get('/deletion-status', (req, res) => accountController.getDeletionStatus(req, res));

// DELETE /api/account - Request account deletion with 30-day grace period (Ley 25.326)
router.delete('/', (req, res) => accountController.requestDeletion(req, res));

export const accountRouter = router;
