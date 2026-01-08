import { Schema, model, Document, Types } from 'mongoose';

export enum PromotionType {
  DISCOUNT = 'discount',        // Percentage off coin purchase
  BONUS_COINS = 'bonus_coins',  // Extra coins with purchase
  FREE_COINS = 'free_coins',    // Free coins (login bonus, referral)
}

export enum PromotionStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  EXPIRED = 'expired',
}

export interface IPromotion extends Document {
  name: string;
  description?: string;
  type: PromotionType;
  value: number;                 // Discount % or bonus coins amount
  code?: string;                 // Optional promo code
  minPurchase?: number;          // Minimum purchase amount (INR)
  maxUsesTotal?: number;         // Total uses allowed
  maxUsesPerUser?: number;       // Uses per user
  usedCount: number;
  status: PromotionStatus;
  startDate: Date;
  endDate: Date;
  applicablePlans?: Types.ObjectId[];  // Specific coin plans this applies to
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const promotionSchema = new Schema<IPromotion>(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    type: {
      type: String,
      enum: Object.values(PromotionType),
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    code: {
      type: String,
      unique: true,
      sparse: true,  // Allow multiple null values
      uppercase: true,
    },
    minPurchase: {
      type: Number,
      min: 0,
    },
    maxUsesTotal: {
      type: Number,
      min: 1,
    },
    maxUsesPerUser: {
      type: Number,
      min: 1,
      default: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: Object.values(PromotionStatus),
      default: PromotionStatus.DRAFT,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    applicablePlans: [{
      type: Schema.Types.ObjectId,
      ref: 'CoinPlan',
    }],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
promotionSchema.index({ status: 1, startDate: 1, endDate: 1 });
promotionSchema.index({ code: 1 });

export const Promotion = model<IPromotion>('Promotion', promotionSchema);
