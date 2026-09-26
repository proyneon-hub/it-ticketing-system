import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { requireCronSecret } from '../security/cronAuth';
import { processAgentEvents } from '../services/agentWorkerService';
import { deliverPending } from '../services/outboxService';
import { escalate } from '../services/slaService';

// Endpoints for a scheduler (GitHub Actions on a timer, in this project), protected by the
// CRON_SECRET bearer token. Each is safe to call at any time and as often as you like.
const router = Router();

router.use('/jobs', requireCronSecret);

// Records tickets that have reached an SLA milestone (see services/slaService.ts).
router.post(
  '/jobs/sla-escalation',
  asyncHandler(async (req, res) => {
    const result = await escalate();
    req.log.info(result, 'SLA escalation run');
    res.json(result);
  })
);

// Sends any outbox events that are due to the webhook (see services/outboxService.ts).
router.post(
  '/jobs/outbox-delivery',
  asyncHandler(async (req, res) => {
    const result = await deliverPending();
    req.log.info(result, 'Outbox delivery run');
    res.json(result);
  })
);

// Runs the service desk agent on new tickets (see services/agentWorkerService.ts). Does nothing
// unless AGENT_ENABLED=true and the model can be reached, and answers with which.
router.post(
  '/jobs/agent-runs',
  asyncHandler(async (req, res) => {
    const result = await processAgentEvents();
    req.log.info(result, 'Agent run job');
    res.json(result);
  })
);

export default router;
