import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { listAudit } from '../services/auditService';
import { parseAuditQuery } from '../validation/users';

// The security audit log, read-only. Admins only.
const router = Router();

router.use('/audit', requireAuth, requireRole('admin'));

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { events, pagination } = await listAudit(parseAuditQuery(req.query));
    res.json({ events, data: events, pagination });
  })
);

export default router;
