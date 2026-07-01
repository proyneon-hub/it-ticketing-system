const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../auth');
const Ticket = require('../models/Ticket');

const router = express.Router();

const allowedStatuses = ['open', 'assigned', 'in-progress', 'resolved', 'closed'];
const allowedPriorities = ['low', 'medium', 'high', 'urgent'];
const terminalStatuses = ['resolved', 'closed'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : value;
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
    throw Object.assign(new Error('Title is required.'), { statusCode: 400 });
  }

  if (payload.status && !allowedStatuses.includes(payload.status)) {
    throw Object.assign(new Error('Invalid status.'), { statusCode: 400 });
  }

  if (payload.priority && !allowedPriorities.includes(payload.priority)) {
    throw Object.assign(new Error('Invalid priority.'), { statusCode: 400 });
  }

  if (payload.assignee === '') {
    payload.assignee = 'Unassigned';
  }

  if (payload.dueAt) {
    const dueAt = new Date(payload.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw Object.assign(new Error('Invalid SLA due date.'), { statusCode: 400 });
    }
    payload.dueAt = dueAt;
  }

  return payload;
}

function validateObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw Object.assign(new Error('Invalid ticket id.'), { statusCode: 400 });
  }
}

function applyRoleScope(filter, user) {
  if (user.role === 'user') {
    return { ...filter, requesterEmail: user.email };
  }
  return filter;
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

function activityEntry(user, action) {
  return {
    action,
    actorName: user.name,
    actorRole: user.role,
  };
}

router.use('/tickets', requireAuth);

router.get('/tickets', async (req, res, next) => {
  try {
    const { status, priority, search, sla } = req.query;
    let filter = {};

    if (status && allowedStatuses.includes(status)) filter.status = status;
    if (priority && allowedPriorities.includes(priority)) filter.priority = priority;
    if (sla === 'breached') {
      filter.status = { $nin: terminalStatuses };
      filter.dueAt = { $lt: new Date() };
    }

    if (search && search.trim()) {
      filter.$or = [
        { title: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
        { requesterName: { $regex: search.trim(), $options: 'i' } },
        { requesterEmail: { $regex: search.trim(), $options: 'i' } },
        { assignee: { $regex: search.trim(), $options: 'i' } },
        { category: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    filter = applyRoleScope(filter, req.user);
    const tickets = await Ticket.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ tickets });
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

    payload.createdByRole = req.user.role;
    payload.activity = [activityEntry(req.user, `Ticket created by ${req.user.role}`)];

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
      throw Object.assign(new Error('No supported ticket fields were provided.'), {
        statusCode: 400,
      });
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
      throw Object.assign(new Error('Assigned tickets need an assignee.'), { statusCode: 400 });
    }

    const update = {
      $set: payload,
      $push: {
        activity: activityEntry(req.user, `Updated ${Object.keys(payload).join(', ')}`),
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
