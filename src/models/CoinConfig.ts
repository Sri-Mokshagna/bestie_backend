import { Schema, model, Document } from 'mongoose';

/**
 * Coin Configuration Model
 * Stores admin-configurable coin rates for different features
 * Only one active configuration should exist at a time
 */

export interface ICoinConfig extends Document {
  // Chat pricing
  chatCoinsPerMessage: number;

  // Call pricing (per minute)
  audioCallCoinsPerMinute: number;
  videoCallCoinsPerMinute: number;

  // Initial coins for new users
  initialUserCoins: number;

  // Responder settings
  responderMinRedeemCoins: number;
  responderCommissionPercentage: number; // Percentage of coins responder earns

  // Coin to INR conversion for redemption
  coinsToINRRate: number; // How many INR per coin

  // Feature flags
  chatEnabled: boolean;
  audioCallEnabled: boolean;
  videoCallEnabled: boolean;

  // Metadata
  isActive: boolean;
  createdBy?: string; // Admin user ID
  createdAt: Date;
  updatedAt: Date;
}

const coinConfigSchema = new Schema<ICoinConfig>(
  {
    chatCoinsPerMessage: {
      type: Number,
      required: true,
      min: 0,
      default: 3,
    },
    audioCallCoinsPerMinute: {
      type: Number,
      required: true,
      min: 0,
      default: 10,
    },
    videoCallCoinsPerMinute: {
      type: Number,
      required: true,
      min: 0,
      default: 60,
    },
    initialUserCoins: {
      type: Number,
      required: true,
      min: 0,
      default: 10,
    },
    responderMinRedeemCoins: {
      type: Number,
      required: true,
      min: 0,
      default: 100,
    },
    responderCommissionPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 70,
    },
    coinsToINRRate: {
      type: Number,
      required: true,
      min: 0,
      default: 1, // 1 coin = 1 INR by default
    },
    chatEnabled: {
      type: Boolean,
      default: true,
    },
    audioCallEnabled: {
      type: Boolean,
      default: true,
    },
    videoCallEnabled: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one active config exists
coinConfigSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

export const CoinConfig = model<ICoinConfig>('CoinConfig', coinConfigSchema);
