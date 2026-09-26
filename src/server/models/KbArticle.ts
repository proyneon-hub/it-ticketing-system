import mongoose, { type Model, type Types } from 'mongoose';
import { agentCategories, kbIdPattern, type AgentCategory } from '../../shared/ticket-constants';

export interface KbArticleAttrs {
  // The article's own id (KB-006): what a reply cites, and the key the seed script upserts on.
  articleId: string;
  title: string;
  category: AgentCategory;
  // Markdown.
  body: string;
  lastReviewed: Date;
  appliesTo: string[];
}

export type KbArticleRecord = KbArticleAttrs & { _id: Types.ObjectId };

// The files in kb/ are the source of truth and the seed script the only writer, so there are
// no timestamps: re-importing an unchanged article must be a no-op, and timestamps would make
// every run look like a change.
const kbArticleSchema = new mongoose.Schema<KbArticleAttrs>({
  articleId: { type: String, required: true, unique: true, match: kbIdPattern },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, enum: agentCategories, required: true },
  body: { type: String, required: true, maxlength: 8000 },
  lastReviewed: { type: Date, required: true },
  appliesTo: { type: [String], default: [] },
});

// Full-text retrieval for the agent and for technicians, in the same way as tickets (ADR 007):
// a weighted text index, so a match in the title outranks one in the body. Changing this
// definition on an existing database needs `npm run db:sync-indexes`.
kbArticleSchema.index(
  { title: 'text', category: 'text', appliesTo: 'text', body: 'text' },
  { name: 'kb_text', weights: { title: 10, category: 3, appliesTo: 2, body: 1 } }
);

const KbArticle: Model<KbArticleAttrs> =
  (mongoose.models.KbArticle as Model<KbArticleAttrs> | undefined) ||
  mongoose.model<KbArticleAttrs>('KbArticle', kbArticleSchema);

export default KbArticle;
