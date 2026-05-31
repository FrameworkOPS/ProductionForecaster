import { Router } from 'express';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  resendInvite,
} from '../controllers/userController';
import { authenticateToken, authorize } from '../middleware/auth';

const router = Router();

// All user-management endpoints require an authenticated admin.
router.use(authenticateToken, authorize('admin'));

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.post('/:id/resend-invite', resendInvite);

export default router;
