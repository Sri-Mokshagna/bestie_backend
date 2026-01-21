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
  language?: string;
  voiceText?: string;
  voiceBlob?: string;
}

export interface INotificationPreferences {
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  callNotifications: boolean;
  chatNotifications: boolean;
  payoutNotifications: boolean;
  promotionNotifications: boolean;
  systemNotifications: boolean;
}

export interface IUser extends Document {
  phone: string;
  firebaseUid?: string; // Firebase UID for socket authentication
  fcmToken?: string; // Firebase Cloud Messaging token for push notifications
  role: UserRole;
  coinBalance: number;
  rewardPoints: number; // Points earned from watching ads, referrals, etc.
  profile: IUserProfile;
  password?: string; // For admin login
  status: UserStatus;
  isOnline: boolean;
  isAvailable: boolean;
  audioEnabled?: boolean; // For responders
  videoEnabled?: boolean; // For responders
  chatEnabled?: boolean; // For responders
  inCall?: boolean; // For responders - tracks if currently in a call
  notificationPreferences?: INotificationPreferences;
  referralCode?: string; // User's unique referral code
  referredBy?: string; // Referral code of the user who referred this user
  blockedUsers?: string[]; // Array of blocked user IDs
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
    fcmToken: {
      type: String,
      sparse: true, // FCM token for push notifications
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
    rewardPoints: {
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
      language: String,
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
    audioEnabled: {
      type: Boolean,
      default: true,
    },
    videoEnabled: {
      type: Boolean,
      default: true,
    },
    chatEnabled: {
      type: Boolean,
      default: true,
    },
    inCall: {
      type: Boolean,
      default: false,
    },
    notificationPreferences: {
      pushEnabled: { type: Boolean, default: true },
      emailEnabled: { type: Boolean, default: false },
      smsEnabled: { type: Boolean, default: false },
      callNotifications: { type: Boolean, default: true },
      chatNotifications: { type: Boolean, default: true },
      payoutNotifications: { type: Boolean, default: true },
      promotionNotifications: { type: Boolean, default: true },
      systemNotifications: { type: Boolean, default: true },
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true, // Allow null/undefined while keeping unique
      index: true,
    },
    referredBy: {
      type: String,
      index: true,
    },
    blockedUsers: {
      type: [String],
      default: [],
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
