import { SiteVisit } from '../../models/index.js';

/**
 * POST /public/site-visit — called once per page load from the public
 * marketing site. Idempotent per (ip, day): a refresh, a second tab, or a
 * retry after a network blip can never inflate the count.
 */
export const recordSiteVisit = async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    const visitDate = new Date().toISOString().slice(0, 10);
    await SiteVisit.findOrCreate({ where: { ip, visitDate }, defaults: { ip, visitDate } });
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
};

/** GET /public/site-visit-count — the running total, for the landing page footer. */
export const getSiteVisitCount = async (req, res, next) => {
  try {
    const totalVisitors = await SiteVisit.count();
    return res.status(200).json({ totalVisitors });
  } catch (error) {
    next(error);
  }
};
