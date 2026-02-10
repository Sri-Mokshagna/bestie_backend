import { Schema, model, Document } from 'mongoose';

export interface ICommissionConfig extends Document {
  responderCommissionPercentage: number;
  adminCommissionPercentage: number;
  coinToINRRate: number; // How much 1 coin is worth in INR for redemption (deprecated - use call-specific rates)
  audioCallCoinToInrRate: number; // Coin to INR rate for audio calls (responder earnings)
  videoCallCoinToInrRate: number; // Coin to INR rate for video calls (responder earnings)
  minimumRedemptionCoins: number;
  firstTimeBonusPercentage: number; // Bonus percentage for first-time purchases on tagged plans
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
      default: 0.1, // Default: 1 coin = ₹0.10 (deprecated - use call-specific rates)
      min: 0,
    },
    audioCallCoinToInrRate: {
      type: Number,
      required: false, // Optional - will be auto-added if missing
      default: 0.10, // Default: 1 coin = ₹0.10 for audio calls
      min: 0,
    },
    videoCallCoinToInrRate: {
      type: Number,
      required: false, // Optional - will be auto-added if missing
      default: 0.15, // Default: 1 coin = ₹0.15 for video calls
      min: 0,
    },
    minimumRedemptionCoins: {
      type: Number,
      required: true,
      min: 1,
      default: 100,
    },
    firstTimeBonusPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 10, // 10% bonus on first-time purchases
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
