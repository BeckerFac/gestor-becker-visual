import { Router } from 'express';
import { exportController } from './export.controller';

const router = Router();

router.get('/company', (req, res) => exportController.exportCompanyData(req, res));

export const exportRouter = router;
