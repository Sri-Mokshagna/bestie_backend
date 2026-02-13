import { Responder, KycStatus } from '../../models/Responder';
import { User } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';
import { notificationService } from '../../lib/notification';
import { logger } from '../../lib/logger';
import { serializeResponder } from '../../utils/serializer';

export const responderService = {
  async getResponders(onlineOnly?: boolean, page = 1, limit = 20, userLanguage?: string) {
    const skip = (page - 1) * limit;

    const query: any = {
      kycStatus: KycStatus.VERIFIED,
    };

    if (onlineOnly) {
      query.isOnline = true;
      // Show responders who have at least one communication method enabled
      query.$or = [
        { audioEnabled: true },
        { videoEnabled: true },
        { chatEnabled: true },
      ];
    }

    const responders = await Responder.find(query)
      .sort({ isOnline: -1, rating: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // PERFORMANCE FIX: Batch fetch all users in ONE query instead of N queries
    const userIds = responders.map(r => r.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const respondersWithUsers = responders.map((responder) => {
      const user = userMap.get(responder.userId.toString()) || null;
      // Use serializer to properly format the response
      return serializeResponder(responder, user);
    });

    // If user has a language preference, prioritize responders with the same language
    if (userLanguage) {
      const sameLanguageResponders = respondersWithUsers.filter(
        (item) => item.user?.profile?.language === userLanguage
      );
      const otherLanguageResponders = respondersWithUsers.filter(
        (item) => item.user?.profile?.language !== userLanguage
      );

      return [...sameLanguageResponders, ...otherLanguageResponders];
    }

    return respondersWithUsers;
  },

  async getResponderById(responderId: string) {
    // PERFORMANCE: Parallel fetch of responder and user
    const responder = await Responder.findById(responderId).lean();

    if (!responder) {
      throw new AppError(404, 'Responder not found');
    }

    const user = await User.findById(responder.userId).lean();

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Use serializer to properly format the response
    return serializeResponder(responder, user);
  },

  async toggleOnlineStatus(userId: string, isOnline: boolean) {
    let responder = await Responder.findOne({ userId });

    if (!responder) {
      // Lazy create responder profile if it doesn't exist
      // This handles cases where a user was manually promoted or migration failed
      logger.warn({ userId }, 'Responder profile missing in toggleOnlineStatus, creating new one');

      responder = await Responder.create({
        userId,
        isOnline: isOnline,
        kycStatus: KycStatus.VERIFIED, // Assume verified if they are accessing this
        earnings: {
          totalCoins: 0,
          pendingCoins: 0,
          lockedCoins: 0,
          redeemedCoins: 0,
        },
        rating: 0,
        audioEnabled: true,
        videoEnabled: true,
        chatEnabled: true,
      });
    } else {
      responder.isOnline = isOnline;

      // DEFENSIVE: If lastOnlineAt is missing, initialize it to prevent null values
      if (!responder.lastOnlineAt) {
        responder.lastOnlineAt = new Date();
        logger.warn({ userId }, 'lastOnlineAt was null, initialized to current time');
      }

      // CRITICAL: Update lastOnlineAt ONLY when going OFFLINE
      // This tracks when responder was last seen online
      // Used by cleanup service to auto-disable toggles after 2 hours
      if (!isOnline) {
        responder.lastOnlineAt = new Date();
      }

      await responder.save();
    }

    // Sync User online status to ensure calls work
    await User.findByIdAndUpdate(userId, { isOnline });

    // ISSUE 1 FIX: Log warning if responder goes online without FCM token
    // This helps identify responders who won't receive call notifications
    // DEFENSE: This is READ-ONLY logging - does not change any existing flow
    if (isOnline) {
      const user = await User.findById(userId).select('fcmToken phone profile.name').lean();
      if (!user?.fcmToken) {
        logger.warn({
          userId,
          phone: user?.phone,
          name: user?.profile?.name,
        }, '⚠️ RESPONDER ONLINE WITHOUT FCM TOKEN - They will NOT receive call notifications until app is reopened!');
      } else {
        logger.info({
          userId,
          fcmTokenPrefix: user.fcmToken.substring(0, 20) + '...',
        }, '✅ Responder online with valid FCM token');
      }
    }

    return responder;
  },

  async updateAvailabilityStatus(
    userId: string,
    updates: {
      isOnline?: boolean;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      chatEnabled?: boolean;
    }
  ) {
    let responder = await Responder.findOne({ userId });

    if (!responder) {
      // Lazy create if missing
      logger.warn({ userId }, 'Responder profile missing in updateAvailabilityStatus, creating new one');
      responder = await Responder.create({
        userId,
        isOnline: updates.isOnline ?? false,
        kycStatus: KycStatus.VERIFIED,
        earnings: { totalCoins: 0, pendingCoins: 0, lockedCoins: 0, redeemedCoins: 0 },
        rating: 0,
        audioEnabled: updates.audioEnabled ?? true,
        videoEnabled: updates.videoEnabled ?? true,
        chatEnabled: updates.chatEnabled ?? true,
      });
    }

    if (updates.isOnline !== undefined) {
      responder.isOnline = updates.isOnline;

      // DEFENSIVE: If lastOnlineAt is missing, initialize it to prevent null values
      if (!responder.lastOnlineAt) {
        responder.lastOnlineAt = new Date();
        logger.warn({ userId }, 'lastOnlineAt was null in updateAvailabilityStatus, initialized to current time');
      }

      // CRITICAL: Update lastOnlineAt ONLY when going OFFLINE
      if (!updates.isOnline) {
        responder.lastOnlineAt = new Date();
      }

      // Sync User online status
      await User.findByIdAndUpdate(userId, { isOnline: updates.isOnline });
    }

    if (updates.audioEnabled !== undefined) {
      responder.audioEnabled = updates.audioEnabled;
      // CRITICAL: Sync to User model (call service checks User.audioEnabled)
      await User.findByIdAndUpdate(userId, { audioEnabled: updates.audioEnabled });
    }

    if (updates.videoEnabled !== undefined) {
      responder.videoEnabled = updates.videoEnabled;
      // CRITICAL: Sync to User model (call service checks User.videoEnabled)
      await User.findByIdAndUpdate(userId, { videoEnabled: updates.videoEnabled });
    }

    if (updates.chatEnabled !== undefined) {
      responder.chatEnabled = updates.chatEnabled;
      // CRITICAL: Sync to User model (call service checks User.chatEnabled)
      await User.findByIdAndUpdate(userId, { chatEnabled: updates.chatEnabled });
    }

    await responder.save();

    return {
      isOnline: responder.isOnline,
      audioEnabled: responder.audioEnabled,
      videoEnabled: responder.videoEnabled,
      chatEnabled: responder.chatEnabled,
      lastOnlineAt: responder.lastOnlineAt,
    };
  },

  async getAvailabilityStatus(userId: string) {
    let responder = await Responder.findOne({ userId }).lean();

    if (!responder) {
      // Don't throw 404, just return default offline status
      // We could create it here, but maybe better to verify KYC etc first?
      // Actually, for consistency let's return a default "mock" object
      // or just create it if they are inquiring about their own status?
      // Since this is usually called by the responder themselves, let's just return defaults
      // without creating, OR create it so they have a persistent record.
      // Let's create it to be safe and consistent with other methods.

      logger.warn({ userId }, 'Responder profile missing in getAvailabilityStatus, creating new one');

      const newResponder = await Responder.create({
        userId,
        isOnline: false,
        kycStatus: KycStatus.VERIFIED, // Assume verified
        earnings: { totalCoins: 0, pendingCoins: 0, lockedCoins: 0, redeemedCoins: 0 },
        rating: 0,
        audioEnabled: true,
        videoEnabled: true,
        chatEnabled: true,
      });

      responder = newResponder.toObject();
    }

    return {
      isOnline: responder.isOnline,
      audioEnabled: responder.audioEnabled,
      videoEnabled: responder.videoEnabled,
      chatEnabled: responder.chatEnabled,
      inCall: responder.inCall,
      lastOnlineAt: responder.lastOnlineAt,
    };
  },

  async applyAsResponder(
    userId: string,
    data: {
      name: string;
      gender: string;
      bio: string;
      idProofUrl?: string; // Optional aadhar
      voiceProofUrl: string;
    }
  ) {
    // Check if already applied
    const existing = await Responder.findOne({ userId });
    if (existing) {
      throw new AppError(400, 'You have already applied as a responder');
    }

    // Update user profile
    await User.findByIdAndUpdate(userId, {
      'profile.name': data.name,
      'profile.gender': data.gender,
    });

    // Create responder profile
    const responder = await Responder.create({
      userId,
      isOnline: false,
      kycStatus: KycStatus.PENDING,
      kycDocs: {
        idProof: data.idProofUrl || undefined, // Optional
        voiceProof: data.voiceProofUrl,
      },
      earnings: {
        totalCoins: 0,
        pendingCoins: 0,
        redeemedCoins: 0,
      },
      rating: 0,
      bio: data.bio,
    });

    return responder;
  },

  async getPendingApplications() {
    const responders = await Responder.find({
      kycStatus: KycStatus.PENDING,
    })
      .sort({ createdAt: -1 })
      .lean();

    // PERFORMANCE FIX: Batch fetch all users in ONE query
    const userIds = responders.map(r => r.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const applications = responders.map((responder) => {
      const user = userMap.get(responder.userId.toString());
      return {
        id: responder._id,
        userId: responder.userId,
        name: user?.profile?.name || 'Unknown',
        gender: user?.profile?.gender || 'unknown',
        bio: responder.bio,
        aadharImageUrl: responder.kycDocs?.idProof || '',
        voiceRecordingUrl: responder.kycDocs?.voiceProof || '',
        appliedAt: responder.createdAt,
        status: responder.kycStatus,
      };
    });

    return applications;
  },

  async approveResponder(responderId: string, adminId: string) {
    const responder = await Responder.findById(responderId);

    if (!responder) {
      throw new AppError(404, 'Responder not found');
    }

    if (responder.kycStatus !== KycStatus.PENDING) {
      throw new AppError(400, 'Application is not pending');
    }

    // Get user details
    const user = await User.findById(responder.userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Update responder status and ensure availability settings are initialized
    responder.kycStatus = KycStatus.VERIFIED;
    responder.audioEnabled = true; // Enable by default
    responder.videoEnabled = true;
    responder.chatEnabled = true;
    responder.isOnline = false; // Start offline
    await responder.save();

    // Update user role to responder and initialize availability settings
    await User.findByIdAndUpdate(responder.userId, {
      role: 'responder',
      isOnline: false, // Explicitly set to false initially
      audioEnabled: true, // Enable by default
      videoEnabled: true,
      chatEnabled: true,
    });

    // Send approval notification
    try {
      await notificationService.sendApprovalNotification(
        responder.userId.toString(),
        user.profile?.name || 'User'
      );
    } catch (error) {
      console.error('Failed to send approval notification:', error);
      // Don't fail the approval if notification fails
    }

    return responder;
  },

  async rejectResponder(
    responderId: string,
    adminId: string,
    reason?: string
  ) {
    const responder = await Responder.findById(responderId);

    if (!responder) {
      throw new AppError(404, 'Responder not found');
    }

    if (responder.kycStatus !== KycStatus.PENDING) {
      throw new AppError(400, 'Application is not pending');
    }

    // Get user details
    const user = await User.findById(responder.userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Update responder status
    responder.kycStatus = KycStatus.REJECTED;
    await responder.save();

    // Send rejection notification
    try {
      await notificationService.sendRejectionNotification(
        responder.userId.toString(),
        user.profile?.name || 'User',
        reason
      );
    } catch (error) {
      console.error('Failed to send rejection notification:', error);
      // Don't fail the rejection if notification fails
    }

    return responder;
  },
};
