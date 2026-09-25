import mongoose, { type HydratedDocument, type Model, type Types } from 'mongoose';
import { proposalStatuses, triageSources } from '../../shared/agent-constants';
import {
  actorRoles,
  priorities,
  roles,
  slaHoursByPriority,
  statuses,
  terminalStatuses,
} from '../../shared/ticket-constants';
import type { TicketAttrs } from '../../shared/ticket-types';

export type { ActivityEntry, TicketAttrs } from '../../shared/ticket-types';

// A ticket as read back with .lean(): plain data, with the id and the version
// (`__v`) Mongoose adds.
export type TicketRecord = TicketAttrs & {
  _id: Types.ObjectId;
  __v?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TicketDocument = HydratedDocument<TicketAttrs>;

// Mongoose schema for a support ticket. The schema is the source of truth for
// validation, defaults, and the shape of documents stored in MongoDB.
const ticketSchema = new mongoose.Schema<TicketAttrs>(
  {
    ticketNumber: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      maxlength: 16,
    },
    title: {
      type: String,
      // The API also checks for title, but this keeps the database model safe
      // even if another code path tries to create a ticket directly.
      required: [true, 'Ticket title is required'],
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    requesterName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    requesterEmail: {
      type: String,
      trim: true,
      // Normalize email addresses for display and search consistency.
      lowercase: true,
      maxlength: 120,
      default: '',
    },
    requesterUserId: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: statuses,
      default: 'open',
    },
    priority: {
      type: String,
      enum: priorities,
      default: 'medium',
    },
    assignee: {
      type: String,
      trim: true,
      maxlength: 80,
      default: 'Unassigned',
    },
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      default: 'General Support',
    },
    dueAt: {
      type: Date,
    },
    resolvedAt: {
      type: Date,
    },
    slaAtRiskAt: {
      type: Date,
    },
    slaBreachedAt: {
      type: Date,
    },
    activity: [
      {
        action: {
          type: String,
          trim: true,
          maxlength: 160,
        },
        actorName: {
          type: String,
          trim: true,
          maxlength: 80,
        },
        actorRole: {
          type: String,
          enum: [...actorRoles, 'system'],
          default: 'user',
        },
        actorEmail: {
          type: String,
          trim: true,
          lowercase: true,
          maxlength: 120,
        },
        from: {
          type: String,
          trim: true,
          maxlength: 160,
        },
        to: {
          type: String,
          trim: true,
          maxlength: 160,
        },
        detail: {
          type: String,
          trim: true,
          maxlength: 240,
        },
        internal: {
          type: Boolean,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdByRole: {
      type: String,
      enum: roles,
      default: 'user',
    },
    // What the service desk agent has done with this ticket; absent if it never ran.
    agent: {
      type: {
        lastRunId: { type: mongoose.Schema.Types.ObjectId },
        triageSource: { type: String, enum: triageSources },
        proposalStatus: { type: String, enum: proposalStatuses },
      },
      _id: false,
      default: undefined,
    },
  },
  { timestamps: true }
);

ticketSchema.pre('validate', function setSlaDueDate(next) {
  if (!this.dueAt) {
    let created = this.createdAt;
    if (!created) {
      // Pin createdAt to the same instant the SLA is measured from; otherwise
      // Mongoose stamps it a few milliseconds later and the two drift apart.
      created = new Date();
      if (this.isNew) this.createdAt = created;
    }
    this.dueAt = new Date(created.getTime() + slaHoursByPriority[this.priority] * 60 * 60 * 1000);
  }

  if ((terminalStatuses as readonly string[]).includes(this.status) && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }

  next();
});

// Optimizes the dashboard's most common filters and newest-first sorting.
ticketSchema.index({ status: 1, priority: 1, dueAt: 1, createdAt: -1 });
// Full-text search. MongoDB allows one text index per collection, so it covers every
// searchable field. Weights make a hit in the title or ticket number outrank one in
// the description. Changing this definition needs `npm run db:sync-indexes` on an
// existing database, because MongoDB will not alter a text index in place.
ticketSchema.index(
  {
    ticketNumber: 'text',
    title: 'text',
    description: 'text',
    requesterName: 'text',
    requesterEmail: 'text',
    assignee: 'text',
    category: 'text',
  },
  {
    name: 'ticket_text',
    weights: {
      ticketNumber: 10,
      title: 10,
      requesterName: 5,
      requesterEmail: 5,
      assignee: 3,
      category: 3,
      description: 1,
    },
  }
);

// Reuse an existing model when hot reloading or serverless functions reload the
// file. Mongoose throws if the same model name is compiled twice.
const Ticket: Model<TicketAttrs> =
  (mongoose.models.Ticket as Model<TicketAttrs> | undefined) ||
  mongoose.model<TicketAttrs>('Ticket', ticketSchema);

export default Ticket;
