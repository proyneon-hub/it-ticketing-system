import { Router } from 'express';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { actorOf as actor, auditContext } from '../http';
import * as admin from '../services/agentAdminService';
import { escalateTicket } from '../services/agentEscalationService';
import { recordAudit } from '../services/auditService';
import {
  parseAgentEscalation,
  parseApproveProposal,
  parseListAgentRunsQuery,
  parseRejectProposal,
  parseUpdateAgentSettings,
} from '../validation/tickets';
import * as proposals from '../services/proposalService';

// Everything about the service desk agent that has an HTTP face: its settings and runs (for the
// team), the decisions on its proposals (for staff), and the one write only the agent makes. Routes
// only translate HTTP; the rules are in the services (docs/adr/011).
const router = Router();

router.use('/agent', requireAuth);

router.get(
  '/agent/settings',
  requireRole('admin', 'technician'),
  asyncHandler(async (req, res) => {
    res.json({ settings: await admin.getSettingsView(actor(req)) });
  })
);

router.put(
  '/agent/settings',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const changes = parseUpdateAgentSettings(req.body);
    const settings = await admin.changeSettings(actor(req), changes);
    await recordAudit(
      {
        type: 'agent_settings_changed',
        outcome: 'success',
        actor: actor(req),
        target: { type: 'agent_settings', id: 'agent', label: 'Agent settings' },
        // Which settings changed and to what: none of these is a secret or a person's text.
        detail: Object.entries(changes)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(', '),
      },
      auditContext(req)
    );
    res.json({ settings });
  })
);

router.get(
  '/agent/runs',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    res.json(await admin.listRuns(actor(req), parseListAgentRunsQuery(req.query)));
  })
);

router.get(
  '/agent/runs/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    res.json(await admin.getRun(actor(req), String(req.params.id)));
  })
);

// The agent handing its ticket to a person. Only the agent's own token gets in.
router.post(
  '/agent/escalations',
  requireRole('agent'),
  asyncHandler(async (req, res) => {
    const ticket = await escalateTicket(actor(req), parseAgentEscalation(req.body));
    res.status(201).json({ ticket });
  })
);

// --- A ticket's proposal ----------------------------------------------------------------------

router.get(
  '/tickets/:id/proposal',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ proposal: await proposals.getProposal(actor(req), String(req.params.id)) });
  })
);

router.post(
  '/tickets/:id/proposal/approve',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(
      await proposals.approveProposal(
        actor(req),
        String(req.params.id),
        parseApproveProposal(req.body)
      )
    );
  })
);

router.post(
  '/tickets/:id/proposal/reject',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(
      await proposals.rejectProposal(
        actor(req),
        String(req.params.id),
        parseRejectProposal(req.body)
      )
    );
  })
);

export default router;
