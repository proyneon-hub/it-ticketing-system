import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { kbRateLimitOptions } from '../middleware/security';
import { getArticle, searchArticles } from '../services/kbService';
import { parseKbSearch } from '../validation/kb';

// The knowledge base: search it and read an article. For staff and the agent; a requester has no
// use for the internal steps. Read-only: the articles are files in kb/ (npm run kb:seed).
const router = Router();
const kbLimiter = rateLimit(kbRateLimitOptions());

router.use('/kb', requireAuth, requireRole('admin', 'technician', 'agent'), kbLimiter);

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
