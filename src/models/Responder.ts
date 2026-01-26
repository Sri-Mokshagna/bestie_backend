import { Schema, model, Document, Types } from 'mongoose';

export enum KycStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

export enum VoiceGender {
  MALE = 'male',
  FEMALE = 'female',
  ORIGINAL = 'original',
}

export interface IKycDocs {
  idProof?: string;
  voiceProof?: string;
}

export interface IEarnings {
  totalRupees: number; // Changed from totalCoins - now stores rupees directly
  pendingRupees: number; // Changed from pendingCoins
  lockedRupees: number; // Changed from lockedCoins
  redeemedRupees: number; // Changed from redeemedCoins
}

export interface IResponder extends Document {
  userId: Types.ObjectId;
  isOnline: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  chatEnabled: boolean;
  inCall: boolean;
  kycStatus: KycStatus;
  kycDocs: IKycDocs;
  bankDetails?: string; // Encrypted JSON string
  upiId?: string; // UPI ID for payouts
  earnings: IEarnings;
  rating: number;
  voiceGender: VoiceGender;
  bio?: string;
  lastOnlineAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const responderSchema = new Schema<IResponder>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },
    audioEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    videoEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    chatEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    inCall: {
      type: Boolean,
      default: false,
      index: true,
    },
    kycStatus: {
      type: String,
      enum: Object.values(KycStatus),
      default: KycStatus.PENDING,
      index: true,
    },
    kycDocs: {
      idProof: String,
      voiceProof: String,
    },
    bankDetails: String, // Encrypted
    upiId: {
      type: String,
      trim: true,
    },
    earnings: {
      totalRupees: { type: Number, default: 0 }, // Changed from totalCoins
      pendingRupees: { type: Number, default: 0 }, // Changed from pendingCoins
      lockedRupees: { type: Number, default: 0 }, // Changed from lockedCoins
      redeemedRupees: { type: Number, default: 0 }, // Changed from redeemedCoins
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    voiceGender: {
      type: String,
      enum: Object.values(VoiceGender),
      default: VoiceGender.ORIGINAL,
    },
    bio: String,
    lastOnlineAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
responderSchema.index({ isOnline: 1, kycStatus: 1 });
responderSchema.index({ isOnline: 1, audioEnabled: 1, videoEnabled: 1, chatEnabled: 1 });
responderSchema.index({ rating: -1 });

export const Responder = model<IResponder>('Responder', responderSchema);
