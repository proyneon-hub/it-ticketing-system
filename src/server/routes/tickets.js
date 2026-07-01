const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../auth');
const Counter = require('../models/Counter');
const Ticket = require('../models/Ticket');

const router = express.Router();

const allowedStatuses = ['open', 'assigned', 'in-progress', 'resolved', 'closed'];
const allowedPriorities = ['low', 'medium', 'high', 'urgent'];
const allowedSortFields = [
  'ticketNumber',
  'title',
  'status',
  'priority',
  'assignee',
  'dueAt',
  'createdAt',
  'updatedAt',
];
const allowedSlaFilters = ['breached', 'due-soon'];
const terminalStatuses = ['resolved', 'closed'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePositiveInteger(value, { name, defaultValue, min, max }) {
  if (value === undefined || value === '') return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

function parseTicketQuery(query, { paginate = true } = {}) {
  const status = normalizeString(query.status);
  const priority = normalizeString(query.priority);
  const sla = normalizeString(query.sla);
  const sortBy = normalizeString(query.sortBy) || 'createdAt';
  const sortOrder = normalizeString(query.sortOrder) || 'desc';

  if (status && !allowedStatuses.includes(status)) {
    throw badRequest('Invalid status filter.');
  }

  if (priority && !allowedPriorities.includes(priority)) {
    throw badRequest('Invalid priority filter.');
  }

  if (sla && !allowedSlaFilters.includes(sla)) {
    throw badRequest('Invalid SLA filter.');
  }

  if (!allowedSortFields.includes(sortBy)) {
    throw badRequest('Invalid sortBy field.');
  }

  if (!['asc', 'desc'].includes(sortOrder)) {
    throw badRequest('Invalid sortOrder value.');
  }

  return {
    page: paginate
      ? parsePositiveInteger(query.page, { name: 'page', defaultValue: 1, min: 1, max: 100000 })
      : 1,
    limit: paginate
      ? parsePositiveInteger(query.limit, { name: 'limit', defaultValue: 10, min: 1, max: 100 })
      : 10000,
    sortBy,
    sortOrder,
    status,
    priority,
    assignedTo: normalizeString(query.assignedTo),
    search: normalizeString(query.search),
    sla,
  };
}

function applyRoleScope(filter, user) {
  if (user.role === 'user') {
    return { ...filter, requesterEmail: user.email };
  }
  return filter;
}

function buildTicketFilter(query, user, options) {
  const parsed = parseTicketQuery(query, options);
  let filter = {};
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (parsed.status) filter.status = parsed.status;
  if (parsed.priority) filter.priority = parsed.priority;
  if (parsed.assignedTo) {
    filter.assignee = { $regex: escapeRegex(parsed.assignedTo), $options: 'i' };
  }

  if (parsed.sla === 'breached') {
    filter.status = { $nin: terminalStatuses };
    filter.dueAt = { $lt: now };
  }

  if (parsed.sla === 'due-soon') {
    filter.status = { $nin: terminalStatuses };
    filter.dueAt = { $gte: now, $lte: dueSoon };
  }

  if (parsed.search) {
    const searchPattern = { $regex: escapeRegex(parsed.search), $options: 'i' };
    filter.$or = [
      { ticketNumber: searchPattern },
      { title: searchPattern },
      { description: searchPattern },
      { requesterName: searchPattern },
      { requesterEmail: searchPattern },
      { assignee: searchPattern },
      { category: searchPattern },
    ];
  }

  return { filter: applyRoleScope(filter, user), parsed };
}

function buildTicketPayload(body, { partial = false } = {}) {
  const payload = {};
  const fields = [
    'title',
    'description',
    'requesterName',
    'requesterEmail',
    'status',
    'priority',
    'assignee',
    'category',
    'dueAt',
  ];

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeString(body[field]);
    }
  }

  if (!partial && !payload.title) {
    throw badRequest('Title is required.');
  }

  if (payload.status && !allowedStatuses.includes(payload.status)) {
    throw badRequest('Invalid status.');
  }

  if (payload.priority && !allowedPriorities.includes(payload.priority)) {
    throw badRequest('Invalid priority.');
  }

  if (payload.assignee === '') {
    payload.assignee = 'Unassigned';
  }

  if (payload.dueAt) {
    const dueAt = new Date(payload.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw badRequest('Invalid SLA due date.');
    }
    payload.dueAt = dueAt;
  }

  return payload;
}

function validateObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw badRequest('Invalid ticket id.');
  }
}

function assertCanMutateTicket(user, ticket, patch = {}) {
  if (user.role !== 'user') return;

  if (String(ticket.requesterEmail || '').toLowerCase() !== user.email.toLowerCase()) {
    throw Object.assign(new Error('Users can only manage tickets they created.'), {
      statusCode: 403,
    });
  }

  const allowedUserFields = [
    'title',
    'description',
    'requesterName',
    'requesterEmail',
    'priority',
    'category',
  ];
  const disallowed = Object.keys(patch).filter((field) => !allowedUserFields.includes(field));

  if (disallowed.length > 0) {
    throw Object.assign(new Error('Users cannot update workflow, assignment, or SLA fields.'), {
      statusCode: 403,
    });
  }
}

function activityEntry(user, { action, from, to, detail }) {
  return {
    action,
    actorName: user.name,
    actorRole: user.role,
    actorEmail: user.email,
    ...(from !== undefined ? { from: String(from || '') } : {}),
    ...(to !== undefined ? { to: String(to || '') } : {}),
    ...(detail ? { detail } : {}),
  };
}

function activityEntriesForPatch(user, existing, payload) {
  const trackedFields = [
    ['status', 'status_changed'],
    ['priority', 'priority_changed'],
    ['assignee', 'assignee_changed'],
  ];

  const entries = trackedFields
    .filter(([field]) => Object.prototype.hasOwnProperty.call(payload, field))
    .filter(([field]) => String(existing[field] || '') !== String(payload[field] || ''))
    .map(([field, action]) =>
      activityEntry(user, {
        action,
        from: existing[field],
        to: payload[field],
      })
    );

  if (payload.status === 'resolved') {
    entries.push(activityEntry(user, { action: 'ticket_resolved' }));
  }

  if (payload.status === 'closed') {
    entries.push(activityEntry(user, { action: 'ticket_closed' }));
  }

  if (entries.length === 0) {
    entries.push(
      activityEntry(user, {
        action: 'ticket_updated',
        detail: `Updated ${Object.keys(payload).join(', ')}`,
      })
    );
  }

  return entries;
}

async function generateTicketNumber() {
  const counter = await Counter.findByIdAndUpdate(
    'ticket',
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `TKT-${String(counter.seq).padStart(4, '0')}`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function ticketToCsvRow(ticket) {
  const dueAt = ticket.dueAt ? new Date(ticket.dueAt) : null;
  const isSlaBreached =
    dueAt && !terminalStatuses.includes(ticket.status) && dueAt.getTime() < Date.now();

  return [
    ticket.ticketNumber || ticket._id,
    ticket.title,
    ticket.status,
    ticket.priority,
    ticket.requesterEmail || ticket.requesterName,
    ticket.assignee,
    ticket.createdAt,
    ticket.updatedAt,
    ticket.dueAt,
    isSlaBreached ? 'Yes' : 'No',
  ].map(csvEscape);
}

router.use('/tickets', requireAuth);

router.get('/tickets', async (req, res, next) => {
  try {
    const { filter, parsed } = buildTicketFilter(req.query, req.user);
    const sort = { [parsed.sortBy]: parsed.sortOrder === 'asc' ? 1 : -1 };
    const skip = (parsed.page - 1) * parsed.limit;

    const [tickets, total] = await Promise.all([
      Ticket.find(filter).sort(sort).skip(skip).limit(parsed.limit).lean(),
      Ticket.countDocuments(filter),
    ]);

    const pagination = {
      page: parsed.page,
      limit: parsed.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.limit)),
    };

    res.json({ tickets, data: tickets, pagination });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/export', async (req, res, next) => {
  try {
    const { filter, parsed } = buildTicketFilter(req.query, req.user, { paginate: false });
    const sort = { [parsed.sortBy]: parsed.sortOrder === 'asc' ? 1 : -1 };
    const tickets = await Ticket.find(filter).sort(sort).lean();
    const header = [
      'Ticket ID',
      'Title',
      'Status',
      'Priority',
      'Requester',
      'Assigned To',
      'Created At',
      'Updated At',
      'SLA Due At',
      'SLA Breached',
    ];
    const rows = [header, ...tickets.map(ticketToCsvRow)];
    const csv = rows.map((row) => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/stats', async (req, res, next) => {
  try {
    const baseMatch = applyRoleScope({}, req.user);
    const openMatch = { ...baseMatch, status: { $nin: terminalStatuses } };
    const now = new Date();
    const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [statusCounts, priorityCounts, total, breachedSla, dueSoonSla] = await Promise.all([
      Ticket.aggregate([{ $match: baseMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Ticket.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      Ticket.countDocuments(baseMatch),
      Ticket.countDocuments({ ...openMatch, dueAt: { $lt: now } }),
      Ticket.countDocuments({ ...openMatch, dueAt: { $gte: now, $lte: dueSoon } }),
    ]);

    const byStatus = Object.fromEntries(allowedStatuses.map((item) => [item, 0]));
    const byPriority = Object.fromEntries(allowedPriorities.map((item) => [item, 0]));

    for (const row of statusCounts) byStatus[row._id] = row.count;
    for (const row of priorityCounts) byPriority[row._id] = row.count;

    res.json({ total, byStatus, byPriority, sla: { breached: breachedSla, dueSoon: dueSoonSla } });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/:id', async (req, res, next) => {
  try {
    validateObjectId(req.params.id);
    const ticket = await Ticket.findOne(applyRoleScope({ _id: req.params.id }, req.user)).lean();

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    res.json({ ticket });
  } catch (error) {
    next(error);
  }
});

router.post('/tickets', async (req, res, next) => {
  try {
    const payload = buildTicketPayload(req.body);

    if (req.user.role === 'user') {
      payload.requesterName = req.user.name;
      payload.requesterEmail = req.user.email;
      payload.requesterUserId = req.user.sub;
      payload.status = 'open';
      payload.assignee = 'Unassigned';
    }

    payload.ticketNumber = await generateTicketNumber();
    payload.createdByRole = req.user.role;
    payload.activity = [
      activityEntry(req.user, {
        action: 'ticket_created',
        detail: `Ticket created by ${req.user.role}`,
      }),
    ];

    const ticket = await Ticket.create(payload);
    res.status(201).json({ ticket });
  } catch (error) {
    next(error);
  }
});

router.patch('/tickets/:id', async (req, res, next) => {
  try {
    validateObjectId(req.params.id);
    const payload = buildTicketPayload(req.body, { partial: true });
    if (Object.keys(payload).length === 0) {
      throw badRequest('No supported ticket fields were provided.');
    }

    const existing = await Ticket.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    assertCanMutateTicket(req.user, existing, payload);

    if (payload.status && terminalStatuses.includes(payload.status)) {
      payload.resolvedAt = new Date();
    }

    if (payload.status === 'assigned' && (payload.assignee || existing.assignee) === 'Unassigned') {
      throw badRequest('Assigned tickets need an assignee.');
    }

    const update = {
      $set: payload,
      $push: {
        activity: { $each: activityEntriesForPatch(req.user, existing, payload) },
      },
    };

    const ticket = await Ticket.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    res.json({ ticket });
  } catch (error) {
    next(error);
  }
});

router.delete('/tickets/:id', requireRole('admin'), async (req, res, next) => {
  try {
    validateObjectId(req.params.id);
    const ticket = await Ticket.findByIdAndDelete(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
