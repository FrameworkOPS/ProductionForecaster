import { Router } from 'express';
import {
  register,
  login,
  getCurrentUser,
  getInvite,
  acceptInvite,
} from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getCurrentUser);

// Public invitation acceptance endpoints.
router.get('/invite/:token', getInvite);
router.post('/accept-invite', acceptInvite);

export default router;
