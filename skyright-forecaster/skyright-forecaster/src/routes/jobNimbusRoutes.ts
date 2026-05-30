import { Router } from 'express';
import {
  getJobNimbusStatus,
  syncJobs,
  getPipelineSummary,
  debugJobNimbus,
} from '../controllers/jobNimbusController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/status', getJobNimbusStatus);
router.get('/debug', debugJobNimbus);
router.get('/pipeline-summary', getPipelineSummary);
router.post('/sync', syncJobs);

export default router;
