import mongoose, { type Model, type Types } from 'mongoose';
import { roles, type Role } from '../../shared/ticket-constants';

export interface UserAttrs {
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// A user as read back with .lean(). The password hash is never selected unless asked for.
export type UserRecord = Omit<UserAttrs, 'passwordHash'> & {
  _id: Types.ObjectId;
  passwordHash?: string;
  createdAt: Date;
  updatedAt: Date;
};

const userSchema = new mongoose.Schema<UserAttrs>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, enum: roles, default: 'user' },
    // argon2id, encoded. `select: false` keeps it out of every query that does not
    // explicitly ask for it, so it cannot leak into a response by accident.
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

const User: Model<UserAttrs> =
  (mongoose.models.User as Model<UserAttrs> | undefined) ||
  mongoose.model<UserAttrs>('User', userSchema);

export default User;
