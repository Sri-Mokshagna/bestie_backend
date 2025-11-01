import { Schema, model, Document, Types } from 'mongoose';

export enum CallType {
  AUDIO = 'audio',
  VIDEO = 'video',
}

export enum CallStatus {
  RINGING = 'ringing',
  ACTIVE = 'active',
  ENDED = 'ended',
  REJECTED = 'rejected',
  MISSED = 'missed',
}

export interface ILiveMeter {
  lastTick: Date;
  remainingBalance: number;
}

export interface ICall extends Document {
  userId: Types.ObjectId;
  responderId: Types.ObjectId;
  type: CallType;
  zegoRoomId: string;
  status: CallStatus;
  startTime?: Date;
  endTime?: Date;
  durationSeconds?: number;
  coinsCharged?: number;
  liveMeter?: ILiveMeter;
  createdAt: Date;
  updatedAt: Date;
}

const callSchema = new Schema<ICall>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    responderId: {
      type: Schema.Types.ObjectId,
      ref: 'Responder',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(CallType),
      required: true,
    },
    zegoRoomId: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: Object.values(CallStatus),
      default: CallStatus.RINGING,
    },
    startTime: Date,
    endTime: Date,
    durationSeconds: Number,
    coinsCharged: {
      type: Number,
      default: 0,
    },
    liveMeter: {
      lastTick: Date,
      remainingBalance: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
callSchema.index({ userId: 1, createdAt: -1 });
callSchema.index({ responderId: 1, createdAt: -1 });
// Note: unique on zegoRoomId already creates an index

export const Call = model<ICall>('Call', callSchema);
