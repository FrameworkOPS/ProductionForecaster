import express from 'express';
import {
  calculateWeeklyMetrics,
  getMetricsDashboardData,
  getLeadTimeAnalysis,
  getRevenueAnalysis,
  getCapacityAnalysis
} from '../controllers/metricsController';
import { authenticateToken, authorize } from '../middleware/auth';

const router = express.Router();

// All metrics routes require authentication
// GET routes available to all authenticated users
router.get('/dashboard', authenticateToken, getMetricsDashboardData);
router.get('/lead-time-analysis', authenticateToken, getLeadTimeAnalysis);
router.get('/revenue-analysis', authenticateToken, getRevenueAnalysis);
router.get('/capacity-analysis', authenticateToken, getCapacityAnalysis);

// POST routes (calculation/calculation) require admin/manager/scheduler
router.post('/calculate', authenticateToken, authorize('admin', 'manager', 'scheduler'), calculateWeeklyMetrics);

export default router;
