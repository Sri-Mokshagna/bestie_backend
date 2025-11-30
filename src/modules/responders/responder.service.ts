import { Responder, KycStatus } from '../../models/Responder';
import { User } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';
import { notificationService } from '../../lib/notification';

export const responderService = {
  async getResponders(onlineOnly?: boolean, page = 1, limit = 20, userLanguage?: string) {
    const skip = (page - 1) * limit;

    const query: any = {
      kycStatus: KycStatus.VERIFIED,
    };

    if (onlineOnly) {
      query.isOnline = true;
      query.isAvailableForCalls = true; // Only show responders available for calls
    }

    const responders = await Responder.find(query)
      .sort({ isOnline: -1, rating: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Populate user data
    const respondersWithUsers = await Promise.all(
      responders.map(async (responder) => {
        const user = await User.findById(responder.userId).lean();
        return {
          responder,
          user,
        };
      })
    );

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
    const responder = await Responder.findById(responderId).lean();

    if (!responder) {
      throw new AppError(404, 'Responder not found');
    }

    const user = await User.findById(responder.userId).lean();

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    return {
      responder,
      user,
    };
  },

  async toggleOnlineStatus(userId: string, isOnline: boolean) {
    const responder = await Responder.findOne({ userId });

    if (!responder) {
      throw new AppError(404, 'Responder profile not found');
    }

    responder.isOnline = isOnline;
    responder.lastOnlineAt = new Date();
    await responder.save();

    return responder;
  },

  async updateAvailabilityStatus(
    userId: string,
    updates: { isOnline?: boolean; isAvailableForCalls?: boolean }
  ) {
    const responder = await Responder.findOne({ userId });

    if (!responder) {
      throw new AppError(404, 'Responder profile not found');
    }

    if (updates.isOnline !== undefined) {
      responder.isOnline = updates.isOnline;
      responder.lastOnlineAt = new Date();
    }

    if (updates.isAvailableForCalls !== undefined) {
      responder.isAvailableForCalls = updates.isAvailableForCalls;
    }

    await responder.save();

    return {
      isOnline: responder.isOnline,
      isAvailableForCalls: responder.isAvailableForCalls,
      lastOnlineAt: responder.lastOnlineAt,
    };
  },

  async getAvailabilityStatus(userId: string) {
    const responder = await Responder.findOne({ userId }).lean();

    if (!responder) {
      throw new AppError(404, 'Responder profile not found');
    }

    return {
      isOnline: responder.isOnline,
      isAvailableForCalls: responder.isAvailableForCalls,
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

    // Populate user data
    const applications = await Promise.all(
      responders.map(async (responder) => {
        const user = await User.findById(responder.userId).lean();
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
      })
    );

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

    // Update responder status
    responder.kycStatus = KycStatus.VERIFIED;
    await responder.save();

    // Update user role to responder
    await User.findByIdAndUpdate(responder.userId, {
      role: 'responder',
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
