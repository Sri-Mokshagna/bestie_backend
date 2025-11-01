import { Schema, model, Document, Types } from 'mongoose';

export interface IPromotionConditions {
  minBalance?: number;
  userType?: 'all' | 'new' | 'existing';
}

export interface IPromotionSchedule {
  startDate: Date;
  endDate: Date;
}

export interface IPromotion extends Document {
  title: string;
  description: string;
  conditions: IPromotionConditions;
  discount: number;
  planId?: Types.ObjectId;
  schedule: IPromotionSchedule;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const promotionSchema = new Schema<IPromotion>(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    conditions: {
      minBalance: Number,
      userType: {
        type: String,
        enum: ['all', 'new', 'existing'],
        default: 'all',
      },
    },
    discount: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'CoinPlan',
    },
    schedule: {
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: true,
      },
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
promotionSchema.index({ isActive: 1, 'schedule.startDate': 1, 'schedule.endDate': 1 });

export const Promotion = model<IPromotion>('Promotion', promotionSchema);
