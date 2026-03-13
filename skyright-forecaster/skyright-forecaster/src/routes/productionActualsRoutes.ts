import express from 'express';
import {
  createProductionActual,
  getProductionActuals,
  getProductionRate,
  updateProductionActual
} from '../controllers/productionActualsController';
import { authenticateToken, authorize } from '../middleware/auth';

const router = express.Router();

// Public routes (require authentication)
router.get('/', authenticateToken, getProductionActuals);
router.get('/rate', authenticateToken, getProductionRate);

// Protected routes (require admin/manager/scheduler)
router.post('/', authenticateToken, authorize('admin', 'manager', 'scheduler'), createProductionActual);
router.put('/:id', authenticateToken, authorize('admin', 'manager', 'scheduler'), updateProductionActual);

export default router;
