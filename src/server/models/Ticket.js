const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Ticket title is required'],
      trim: true,
      maxlength: 120
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ''
    },
    requesterName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    requesterEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: ''
    },
    status: {
      type: String,
      enum: ['open', 'in-progress', 'resolved', 'closed'],
      default: 'open'
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium'
    },
    assignee: {
      type: String,
      trim: true,
      maxlength: 80,
      default: 'Unassigned'
    }
  },
  { timestamps: true }
);

ticketSchema.index({ status: 1, priority: 1, createdAt: -1 });
ticketSchema.index({ title: 'text', description: 'text', requesterName: 'text', requesterEmail: 'text', assignee: 'text' });

module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
