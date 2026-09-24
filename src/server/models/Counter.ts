import mongoose, { type Model } from 'mongoose';

interface CounterAttrs {
  _id: string;
  seq: number;
}

const counterSchema = new mongoose.Schema<CounterAttrs>({
  _id: {
    type: String,
    required: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

const Counter: Model<CounterAttrs> =
  (mongoose.models.Counter as Model<CounterAttrs> | undefined) ||
  mongoose.model<CounterAttrs>('Counter', counterSchema);

export default Counter;
