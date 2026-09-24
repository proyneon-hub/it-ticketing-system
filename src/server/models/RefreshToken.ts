import mongoose, { type Model } from 'mongoose';

export interface RefreshTokenAttrs {
  userId: string;
  // sha256 of the token. The token itself is never stored, so a database leak does
  // not hand out sessions.
  tokenHash: string;
  // Every token descended from one sign-in shares a family, so reuse can end them all.
  familyId: string;
  expiresAt: Date;
  // Set when the token is exchanged for the next one. Presenting a token that has
  // been used is the sign that a copy of it exists somewhere else.
  usedAt?: Date;
  // Set when the session is ended (sign-out, a role change, or detected reuse).
  revokedAt?: Date;
  ip?: string;
  userAgent?: string;
}

const refreshTokenSchema = new mongoose.Schema<RefreshTokenAttrs>(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    // MongoDB deletes the document once this time passes.
    expiresAt: { type: Date, required: true, expires: 0 },
    usedAt: { type: Date },
    revokedAt: { type: Date },
    ip: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: true }
);

const RefreshToken: Model<RefreshTokenAttrs> =
  (mongoose.models.RefreshToken as Model<RefreshTokenAttrs> | undefined) ||
  mongoose.model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema);

export default RefreshToken;
