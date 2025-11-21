import { Schema, model, Document, Types } from 'mongoose';

export enum TransactionType {
  PURCHASE = 'purchase',
  CALL = 'call',
  CHAT = 'chat',
  GIFT = 'gift',
  PAYOUT = 'payout',
  AD_REWARD = 'ad_reward',
  REFUND = 'refund',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface ITransaction extends Document {
  userId: Types.ObjectId;
  responderId?: Types.ObjectId;
  type: TransactionType;
  coins: number;
  status: TransactionStatus;
  meta?: Record<string, any>;
  createdAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    responderId: {
      type: Schema.Types.ObjectId,
      ref: 'Responder',
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
      index: true,
    },
    coins: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(TransactionStatus),
      default: TransactionStatus.PENDING,
      index: true,
    },
    meta: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ responderId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });

export const Transaction = model<ITransaction>('Transaction', transactionSchema);
