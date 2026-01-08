import { Schema, model, Document, Types } from 'mongoose';

export enum ReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum ReportReason {
  HARASSMENT = 'harassment',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  SPAM = 'spam',
  SCAM = 'scam',
  FAKE_PROFILE = 'fake_profile',
  ABUSIVE_BEHAVIOR = 'abusive_behavior',
  OTHER = 'other',
}

export interface IReport extends Document {
  reporterId: Types.ObjectId;        // User who made the report
  reportedUserId: Types.ObjectId;    // User being reported
  reason: ReportReason;
  description?: string;              // Additional details
  status: ReportStatus;
  adminNotes?: string;               // Admin's notes on the report
  reviewedBy?: Types.ObjectId;       // Admin who reviewed
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reportedUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      enum: Object.values(ReportReason),
      required: true,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: Object.values(ReportStatus),
      default: ReportStatus.PENDING,
    },
    adminNotes: {
      type: String,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reportedUserId: 1 });
reportSchema.index({ reporterId: 1 });

export const Report = model<IReport>('Report', reportSchema);
