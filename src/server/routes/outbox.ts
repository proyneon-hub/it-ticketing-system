import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { actorOf, auditContext } from '../http';
import { recordAudit } from '../services/auditService';
import { listEvents, retryEvent } from '../services/outboxService';
import { parseOutboxQuery } from '../validation/users';

// The outbox of events waiting to be sent, so an admin can see what failed and try again.
// Admins only.
const router = Router();

router.use('/outbox', requireAuth, requireRole('admin'));

router.get(
  '/outbox',
  asyncHandler(async (req, res) => {
    const { status, page, limit } = parseOutboxQuery(req.query);
    const { events, pagination } = await listEvents(status, page, limit);
    res.json({ events, data: events, pagination });
  })
);

router.post(
  '/outbox/:id/retry',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const event = await retryEvent(id);
    await recordAudit(
      {
        type: 'outbox_retried',
        outcome: 'success',
        actor: actorOf(req),
        target: { type: 'outbox_event', id, label: event.type },
      },
      auditContext(req)
    );
    res.json({ event });
  })
);

export default router;
