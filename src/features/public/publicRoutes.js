import { Router } from 'express';
import { recordSiteVisit, getSiteVisitCount } from './publicController.js';
import { siteVisitLimiter } from '../../middleware/rateLimit.js';

// No authGuard anywhere here — these exist for the public marketing site,
// reachable before anyone has signed in.
export const publicRouter = Router();

publicRouter.post('/public/site-visit', siteVisitLimiter, recordSiteVisit);
publicRouter.get('/public/site-visit-count', getSiteVisitCount);
