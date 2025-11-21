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
  totalCoins: number;
  pendingCoins: number;
  lockedCoins: number;
  redeemedCoins: number;
}

export interface IResponder extends Document {
  userId: Types.ObjectId;
  isOnline: boolean;
  kycStatus: KycStatus;
  kycDocs: IKycDocs;
  bankDetails?: string; // Encrypted JSON string
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
    earnings: {
      totalCoins: { type: Number, default: 0 },
      pendingCoins: { type: Number, default: 0 },
      lockedCoins: { type: Number, default: 0 },
      redeemedCoins: { type: Number, default: 0 },
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
responderSchema.index({ rating: -1 });

export const Responder = model<IResponder>('Responder', responderSchema);
