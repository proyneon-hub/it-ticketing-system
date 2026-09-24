import { Router } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import asyncHandler from '../asyncHandler';
import { requireAuth, requireRole } from '../auth';
import { actorOf as actor, auditContext } from '../http';
import { recordAudit } from '../services/auditService';
import * as tickets from '../services/ticketService';
import {
  parseCreateTicket,
  parseExportQuery,
  parseExpectedVersion,
  parseListQuery,
  parsePatchTicket,
  parseTrendsQuery,
} from '../validation/tickets';

// Routes only translate HTTP to service calls: validate input, call the
// service, shape the response. Business rules live in services/ticketService.ts.
const router = Router();

router.use('/tickets', requireAuth);

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

// Puts back a chunk that was read ahead of the rest.
async function* replay<T>(first: IteratorResult<T>, rest: AsyncIterator<T>): AsyncGenerator<T> {
  if (first.done) return;
  yield first.value;
  for (let next = await rest.next(); !next.done; next = await rest.next()) yield next.value;
}

router.get(
  '/tickets/export',
  asyncHandler(async (req, res) => {
    const chunks = tickets.exportTicketsCsv(actor(req), parseExportQuery(req.query));
    // Read the first chunk before sending anything: if the database fails now it is
    // still an ordinary JSON error, not a response that dies half way.
    const first = await chunks.next();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');

    try {
      // pipeline waits for the client to drain each chunk (backpressure) and closes
      // the database cursor if the client goes away.
      await pipeline(Readable.from(replay(first, chunks)), res);
    } catch (error) {
      // The status line is already sent, so all that is left is to log and drop the connection.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ERR_STREAM_PREMATURE_CLOSE') req.log.error({ err: error }, 'CSV export failed');
    }
  })
);

router.get(
  '/tickets/stats',
  asyncHandler(async (req, res) => {
    res.json(await tickets.getStats(actor(req)));
  })
);

router.get(
  '/tickets/stats/trends',
  asyncHandler(async (req, res) => {
    res.json(await tickets.getTrends(actor(req), parseTrendsQuery(req.query)));
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
      { expectedVersion: parseExpectedVersion(req.get('if-match'), req.get('x-ticket-version')) }
    );
    // The version to send back on the next edit (X-Ticket-Version, or If-Match).
    res.set('ETag', `"${ticket.__v}"`);
    res.json({ ticket });
  })
);

router.delete(
  '/tickets/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const ticketNumber = await tickets.deleteTicket(id);
    await recordAudit(
      {
        type: 'ticket_deleted',
        outcome: 'success',
        actor: actor(req),
        target: { type: 'ticket', id, label: ticketNumber },
      },
      auditContext(req)
    );
    res.status(204).send();
  })
);

export default router;
