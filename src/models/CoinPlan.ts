import { Schema, model, Document } from 'mongoose';

export enum PlanTag {
  FIRST_TIME = 'first-time',
  LIMITED = 'limited',
  UNLIMITED = 'unlimited',
}

export interface ICoinPlan extends Document {
  name: string;
  priceINR: number;
  coins: number;
  tags: PlanTag[];
  maxUses?: number;
  discount?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const coinPlanSchema = new Schema<ICoinPlan>(
  {
    name: {
      type: String,
      required: true,
    },
    priceINR: {
      type: Number,
      required: true,
      min: 0,
    },
    coins: {
      type: Number,
      required: true,
      min: 0,
    },
    tags: {
      type: [String],
      enum: Object.values(PlanTag),
      default: [PlanTag.UNLIMITED],
    },
    maxUses: {
      type: Number,
      min: 1,
    },
    discount: {
      type: Number,
      min: 0,
      max: 100,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
coinPlanSchema.index({ isActive: 1 });

export const CoinPlan = model<ICoinPlan>('CoinPlan', coinPlanSchema);
