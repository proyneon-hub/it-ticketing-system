import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { registry } from '../metrics';
import { requireMetricsToken } from '../security/metricsAuth';

// Prometheus text exposition. Mounted before the database middleware in app.ts, so it still
// answers when the database is down (which is when it is most wanted).
const router = Router();

router.get(
  '/metrics',
  requireMetricsToken,
  asyncHandler(async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  })
);

export default router;
