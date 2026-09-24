import { Router, type Request } from 'express';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole, type TokenPayload } from '../auth';
import * as tickets from '../services/ticketService';
import {
  parseCreateTicket,
  parseExportQuery,
  parseIfMatch,
  parseListQuery,
  parsePatchTicket,
} from '../validation/tickets';

// Routes only translate HTTP to service calls: validate input, call the
// service, shape the response. Business rules live in services/ticketService.ts.
const router = Router();

router.use('/tickets', requireAuth);

// requireAuth has run for every route below, so a user is always present.
const actor = (req: Request): TokenPayload => req.user as TokenPayload;

router.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    const { tickets: rows, pagination } = await tickets.listTickets(
      actor(req),
      parseListQuery(req.query)
    );
    // `data` and `tickets` carry the same rows; `data` is the documented field.
    res.json({ tickets: rows, data: rows, pagination });
  })
);

router.get(
  '/tickets/export',
  asyncHandler(async (req, res) => {
    const csv = await tickets.exportTicketsCsv(actor(req), parseExportQuery(req.query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send(csv);
  })
);

router.get(
  '/tickets/stats',
  asyncHandler(async (req, res) => {
    res.json(await tickets.getStats(actor(req)));
  })
);

router.get(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    res.json({ ticket: await tickets.getTicket(actor(req), String(req.params.id)) });
  })
);

router.post(
  '/tickets',
  asyncHandler(async (req, res) => {
    const ticket = await tickets.createTicket(actor(req), parseCreateTicket(req.body));
    res.status(201).json({ ticket });
  })
);

router.patch(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    const ticket = await tickets.updateTicket(
      actor(req),
      String(req.params.id),
      parsePatchTicket(req.body),
      { expectedVersion: parseIfMatch(req.get('if-match')) }
    );
    // The version to send back as If-Match on the next edit.
    res.set('ETag', `"${ticket.__v}"`);
    res.json({ ticket });
  })
);

router.delete(
  '/tickets/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await tickets.deleteTicket(String(req.params.id));
    res.status(204).send();
  })
);

export default router;
