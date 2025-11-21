import { Schema, model, Document, Types } from 'mongoose';

export enum RedemptionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

export interface IRedemption extends Document {
  userId: Types.ObjectId;
  coinsToRedeem: number;
  amountINR: number;
  upiId: string;
  status: RedemptionStatus;
  adminNotes?: string;
  processedBy?: Types.ObjectId;
  processedAt?: Date;
  transactionId?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const redemptionSchema = new Schema<IRedemption>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    coinsToRedeem: {
      type: Number,
      required: true,
      min: 1,
    },
    amountINR: {
      type: Number,
      required: true,
      min: 0,
    },
    upiId: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(RedemptionStatus),
      default: RedemptionStatus.PENDING,
    },
    adminNotes: {
      type: String,
      trim: true,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    processedAt: Date,
    transactionId: {
      type: String,
      trim: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
redemptionSchema.index({ userId: 1, createdAt: -1 });
redemptionSchema.index({ status: 1, createdAt: -1 });
redemptionSchema.index({ processedBy: 1 });

export const Redemption = model<IRedemption>('Redemption', redemptionSchema);
