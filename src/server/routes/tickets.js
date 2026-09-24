const express = require('express');
const asyncHandler = require('../asyncHandler');
const { requireAuth, requireRole } = require('../auth');
const tickets = require('../services/ticketService');
const {
  parseCreateTicket,
  parseExportQuery,
  parseIfMatch,
  parseListQuery,
  parsePatchTicket,
} = require('../validation/tickets');

// Routes only translate HTTP to service calls: validate input, call the
// service, shape the response. Business rules live in services/ticketService.js.
const router = express.Router();

router.use('/tickets', requireAuth);

router.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    const { tickets: rows, pagination } = await tickets.listTickets(
      req.user,
      parseListQuery(req.query)
    );
    // `data` and `tickets` carry the same rows; `data` is the documented field.
    res.json({ tickets: rows, data: rows, pagination });
  })
);

router.get(
  '/tickets/export',
  asyncHandler(async (req, res) => {
    const csv = await tickets.exportTicketsCsv(req.user, parseExportQuery(req.query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send(csv);
  })
);

router.get(
  '/tickets/stats',
  asyncHandler(async (req, res) => {
    res.json(await tickets.getStats(req.user));
  })
);

router.get(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    res.json({ ticket: await tickets.getTicket(req.user, req.params.id) });
  })
);

router.post(
  '/tickets',
  asyncHandler(async (req, res) => {
    const ticket = await tickets.createTicket(req.user, parseCreateTicket(req.body));
    res.status(201).json({ ticket });
  })
);

router.patch(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    const ticket = await tickets.updateTicket(req.user, req.params.id, parsePatchTicket(req.body), {
      expectedVersion: parseIfMatch(req.get('if-match')),
    });
    // The version to send back as If-Match on the next edit.
    res.set('ETag', `"${ticket.__v}"`);
    res.json({ ticket });
  })
);

router.delete(
  '/tickets/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await tickets.deleteTicket(req.params.id);
    res.status(204).send();
  })
);

module.exports = router;
