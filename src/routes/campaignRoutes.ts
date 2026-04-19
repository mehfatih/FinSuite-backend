import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getCampaigns,
  createCampaign,
  sendCampaign,
  updateCampaign,
  deleteCampaign,
} from '../controllers/campaignController';

const router = Router();

router.get('/', authenticate as any, getCampaigns);
router.post('/', authenticate as any, createCampaign);
router.post('/:id/send', authenticate as any, sendCampaign);
router.patch('/:id', authenticate as any, updateCampaign);
router.delete('/:id', authenticate as any, deleteCampaign);

export default router;