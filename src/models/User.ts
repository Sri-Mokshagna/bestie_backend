import { Schema, model, Document } from 'mongoose';

export enum UserRole {
  USER = 'user',
  RESPONDER = 'responder',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export interface IUserProfile {
  name?: string;
  email?: string;
  bio?: string;
  avatar?: string;
  gender?: string;
  voiceText?: string;
  voiceBlob?: string;
}

export interface IUser extends Document {
  phone: string;
  firebaseUid?: string; // Firebase UID for socket authentication
  role: UserRole;
  coinBalance: number;
  profile: IUserProfile;
  password?: string; // For admin login
  status: UserStatus;
  isOnline: boolean;
  isAvailable: boolean;
  lastOnlineAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    firebaseUid: {
      type: String,
      sparse: true, // Allow null/undefined while keeping unique
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    },
    coinBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    profile: {
      name: String,
      email: String,
      bio: String,
      avatar: String,
      gender: String,
      voiceText: String,
      voiceBlob: String,
    },
    password: {
      type: String,
      select: false, // Don't include password in queries by default
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
    },
    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    lastOnlineAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ role: 1, status: 1 });

export const User = model<IUser>('User', userSchema);
