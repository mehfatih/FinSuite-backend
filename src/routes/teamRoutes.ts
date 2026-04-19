// teamRoutes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getTeamMembers,
  inviteTeamMember,
  acceptInvite,
  updateTeamMember,
  removeTeamMember,
} from '../controllers/teamController';

const router = Router();

router.get('/', authenticate as any, getTeamMembers);
router.post('/', authenticate as any, inviteTeamMember);
router.post('/accept/:token', acceptInvite);          // public — token yeterli
router.patch('/:id', authenticate as any, updateTeamMember);
router.delete('/:id', authenticate as any, removeTeamMember);

export default router;