import { Router } from 'express';
import {
  getJobNimbusStatus,
  syncJobs,
  getPipelineSummary,
} from '../controllers/jobNimbusController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/status', getJobNimbusStatus);
router.get('/pipeline-summary', getPipelineSummary);
router.post('/sync', syncJobs);

export default router;
