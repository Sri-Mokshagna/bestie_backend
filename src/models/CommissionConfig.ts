import { Schema, model, Document } from 'mongoose';

export interface ICommissionConfig extends Document {
  responderCommissionPercentage: number;
  adminCommissionPercentage: number;
  coinToINRRate: number; // How much 1 coin is worth in INR for redemption
  minimumRedemptionCoins: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const commissionConfigSchema = new Schema<ICommissionConfig>(
  {
    responderCommissionPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 60,
    },
    adminCommissionPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 40,
    },
    coinToINRRate: {
      type: Number,
      required: true,
      min: 0,
      default: 0.1, // 1 coin = 0.1 INR for redemption
    },
    minimumRedemptionCoins: {
      type: Number,
      required: true,
      min: 1,
      default: 100,
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

// Ensure only one active config at a time
commissionConfigSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export const CommissionConfig = model<ICommissionConfig>('CommissionConfig', commissionConfigSchema);
