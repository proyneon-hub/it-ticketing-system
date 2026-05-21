const express = require('express');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');

const router = express.Router();

// Keep allowed API values close to the route logic so validation and filtering
// use the same lists the frontend presents in dropdowns.
const allowedStatuses = ['open', 'in-progress', 'resolved', 'closed'];
const allowedPriorities = ['low', 'medium', 'high', 'urgent'];

function normalizeString(value) {
  // Trim user-entered text while leaving non-string values untouched so Mongoose
  // can still validate unexpected types normally.
  return typeof value === 'string' ? value.trim() : value;
}

function buildTicketPayload(body, { partial = false } = {}) {
  const payload = {};
  const fields = ['title', 'description', 'requesterName', 'requesterEmail', 'status', 'priority', 'assignee'];

  // Copy only fields the API supports. This prevents clients from setting
  // database-managed fields like _id, createdAt, or updatedAt.
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeString(body[field]);
    }
  }

  // Full creates require a title. Partial updates can send only the field that
  // changed, such as { status: "resolved" }.
  if (!partial && !payload.title) {
    throw Object.assign(new Error('Title is required.'), { statusCode: 400 });
  }

  // Validate enum fields before hitting MongoDB so the client receives a clean,
  // predictable 400 response.
  if (payload.status && !allowedStatuses.includes(payload.status)) {
    throw Object.assign(new Error('Invalid status.'), { statusCode: 400 });
  }

  if (payload.priority && !allowedPriorities.includes(payload.priority)) {
    throw Object.assign(new Error('Invalid priority.'), { statusCode: 400 });
  }

  // Treat a blank assignee as intentionally unassigned.
  if (payload.assignee === '') {
    payload.assignee = 'Unassigned';
  }

  return payload;
}

function validateObjectId(id) {
  // Mongoose will throw for malformed ObjectIds. Checking first lets the API
  // return a controlled 400 instead of a generic server error.
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw Object.assign(new Error('Invalid ticket id.'), { statusCode: 400 });
  }
}

router.get('/tickets', async (req, res, next) => {
  try {
    const { status, priority, search } = req.query;
    const filter = {};

    // Invalid filter values are ignored instead of causing an error, which keeps
    // the dashboard resilient if a query string is edited manually.
    if (status && allowedStatuses.includes(status)) filter.status = status;
    if (priority && allowedPriorities.includes(priority)) filter.priority = priority;

    // Case-insensitive search across the main ticket fields. This is simple and
    // flexible for a small ticketing app.
    if (search && search.trim()) {
      filter.$or = [
        { title: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
        { requesterName: { $regex: search.trim(), $options: 'i' } },
        { requesterEmail: { $regex: search.trim(), $options: 'i' } },
        { assignee: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // lean() returns plain objects instead of full Mongoose documents, which is
    // faster when the route only needs to serialize data as JSON.
    const tickets = await Ticket.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/stats', async (_req, res, next) => {
  try {
    // Compute dashboard totals in parallel so the stats endpoint stays quick.
    const [statusCounts, priorityCounts, total] = await Promise.all([
      Ticket.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Ticket.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }]),
      Ticket.countDocuments()
    ]);

    // Start every status/priority at zero so the frontend can render stable
    // values even when the database has no tickets in a category.
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
    // findById returns null when the id is valid but no ticket exists.
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
    // Sanitize and validate the request body before creating the MongoDB record.
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
    // Partial payloads let the dashboard update one field at a time.
    const payload = buildTicketPayload(req.body, { partial: true });

    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      // new returns the updated document; runValidators keeps schema validation
      // active for updates, not just creates.
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

    // 204 means the delete succeeded and there is no response body.
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
