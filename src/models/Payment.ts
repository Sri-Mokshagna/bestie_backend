import { Schema, model, Document, Types } from 'mongoose';

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentMethod {
  UPI = 'upi',
  CARD = 'card',
  NET_BANKING = 'net_banking',
  WALLET = 'wallet',
}

export interface IPayment extends Document {
  userId: Types.ObjectId;
  orderId: string;
  cashfreeOrderId: string;
  planId: Types.ObjectId;
  amount: number;
  coins: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  cashfreePaymentId?: string;
  gatewayResponse?: any;
  failureReason?: string;
  refundId?: string;
  refundAmount?: number;
  webhookData?: any;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    cashfreeOrderId: {
      type: String,
      required: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'CoinPlan',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    coins: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
    },
    cashfreePaymentId: String,
    gatewayResponse: Schema.Types.Mixed,
    failureReason: String,
    refundId: String,
    refundAmount: Number,
    webhookData: Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ userId: 1, createdAt: -1 });
// Note: orderId index is automatically created by unique: true constraint
paymentSchema.index({ cashfreeOrderId: 1 });
paymentSchema.index({ status: 1 });

export const Payment = model<IPayment>('Payment', paymentSchema);
