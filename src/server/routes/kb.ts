import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { kbIpRateLimitOptions, kbRateLimitOptions } from '../middleware/security';
import { getArticle, searchArticles } from '../services/kbService';
import { parseKbSearch } from '../validation/kb';

// The knowledge base: search it and read an article. For staff and the agent; a requester has no
// use for the internal steps. Read-only: the articles are files in kb/ (npm run kb:seed).
const router = Router();
// Two limits: a coarse one by address before anyone is authenticated, then one for each caller.
const kbIpLimiter = rateLimit(kbIpRateLimitOptions());
const kbLimiter = rateLimit(kbRateLimitOptions());

router.use('/kb', kbIpLimiter, requireAuth, requireRole('admin', 'technician', 'agent'), kbLimiter);

router.get(
  '/kb',
  asyncHandler(async (req, res) => {
    res.json({ articles: await searchArticles(parseKbSearch(req.query)) });
  })
);

router.get(
  '/kb/:id',
  asyncHandler(async (req, res) => {
    res.json({ article: await getArticle(String(req.params.id)) });
  })
);

export default router;
