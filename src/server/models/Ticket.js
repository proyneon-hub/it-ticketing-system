const mongoose = require('mongoose');

const slaHoursByPriority = {
  low: 72,
  medium: 48,
  high: 24,
  urgent: 4
};

// Mongoose schema for a support ticket. The schema is the source of truth for
// validation, defaults, and the shape of documents stored in MongoDB.
const ticketSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      // The API also checks for title, but this keeps the database model safe
      // even if another code path tries to create a ticket directly.
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
      // Normalize email addresses for display and search consistency.
      lowercase: true,
      maxlength: 120,
      default: ''
    },
    requesterUserId: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: ['open', 'assigned', 'in-progress', 'resolved', 'closed'],
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
    },
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      default: 'General Support'
    },
    dueAt: {
      type: Date
    },
    resolvedAt: {
      type: Date
    },
    activity: [
      {
        action: {
          type: String,
          trim: true,
          maxlength: 160
        },
        actorName: {
          type: String,
          trim: true,
          maxlength: 80
        },
        actorRole: {
          type: String,
          enum: ['admin', 'technician', 'user'],
          default: 'user'
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    createdByRole: {
      type: String,
      enum: ['admin', 'technician', 'user'],
      default: 'user'
    }
  },
  { timestamps: true }
);

ticketSchema.pre('validate', function setSlaDueDate(next) {
  if (!this.dueAt) {
    const created = this.createdAt || new Date();
    this.dueAt = new Date(created.getTime() + slaHoursByPriority[this.priority] * 60 * 60 * 1000);
  }

  if (['resolved', 'closed'].includes(this.status) && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }

  next();
});

// Optimizes the dashboard's most common filters and newest-first sorting.
ticketSchema.index({ status: 1, priority: 1, dueAt: 1, createdAt: -1 });
// Provides a text index for future full-text search support. The current route
// uses regex search, but this index makes it easy to switch to $text later.
ticketSchema.index({ title: 'text', description: 'text', requesterName: 'text', requesterEmail: 'text', assignee: 'text' });

// Reuse an existing model when hot reloading or serverless functions reload the
// file. Mongoose throws if the same model name is compiled twice.
module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
