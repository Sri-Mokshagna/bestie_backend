import { Schema, model, Document, Types } from 'mongoose';

export enum PayoutStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface IPayout extends Document {
  responderId: Types.ObjectId;
  coins: number;
  amountINR: number;
  status: PayoutStatus;
  gatewayResponse?: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

const payoutSchema = new Schema<IPayout>(
  {
    responderId: {
      type: Schema.Types.ObjectId,
      ref: 'Responder',
      required: true,
      index: true,
    },
    coins: {
      type: Number,
      required: true,
      min: 0,
    },
    amountINR: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(PayoutStatus),
      default: PayoutStatus.PENDING,
    },
    gatewayResponse: Schema.Types.Mixed,
    completedAt: Date,
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
payoutSchema.index({ responderId: 1, createdAt: -1 });
payoutSchema.index({ status: 1 });

export const Payout = model<IPayout>('Payout', payoutSchema);
