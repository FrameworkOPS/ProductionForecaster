import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { listPrices, createPrice, updatePrice, deletePrice, repriceProject } from '../controllers/pricesController';

const router = Router();
router.use(authenticateToken);

router.get('/', listPrices);
router.post('/', createPrice);
router.put('/:id', updatePrice);
router.delete('/:id', deletePrice);

// Re-run price lookup against all line items in a project
router.post('/reprice/:projectId', repriceProject);

export default router;
