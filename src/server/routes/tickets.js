const express = require('express');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');

const router = express.Router();

const allowedStatuses = ['open', 'in-progress', 'resolved', 'closed'];
const allowedPriorities = ['low', 'medium', 'high', 'urgent'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function buildTicketPayload(body, { partial = false } = {}) {
  const payload = {};
  const fields = ['title', 'description', 'requesterName', 'requesterEmail', 'status', 'priority', 'assignee'];

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

  return payload;
}

function validateObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw Object.assign(new Error('Invalid ticket id.'), { statusCode: 400 });
  }
}

router.get('/tickets', async (req, res, next) => {
  try {
    const { status, priority, search } = req.query;
    const filter = {};

    if (status && allowedStatuses.includes(status)) filter.status = status;
    if (priority && allowedPriorities.includes(priority)) filter.priority = priority;

    if (search && search.trim()) {
      filter.$or = [
        { title: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
        { requesterName: { $regex: search.trim(), $options: 'i' } },
        { requesterEmail: { $regex: search.trim(), $options: 'i' } },
        { assignee: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    const tickets = await Ticket.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/stats', async (_req, res, next) => {
  try {
    const [statusCounts, priorityCounts, total] = await Promise.all([
      Ticket.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Ticket.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Ticket.countDocuments()
    ]);

    const byStatus = Object.fromEntries(allowedStatuses.map((status) => [status, 0]));
    const byPriority = Object.fromEntries(allowedPriorities.map((priority) => [priority, 0]));

    for (const row of statusCounts) byStatus[row._id] = row.count;
    for (const row of priorityCounts) byPriority[row._id] = row.count;

    res.json({ total, byStatus, byPriority });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/:id', async (req, res, next) => {
  try {
    validateObjectId(req.params.id);
    const ticket = await Ticket.findById(req.params.id).lean();

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

    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true }
    );

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found.' });
    }

    res.json({ ticket });
  } catch (error) {
    next(error);
  }
});

router.delete('/tickets/:id', async (req, res, next) => {
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
