import { User, UserRole, UserStatus } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';
import { Responder } from '../../models/Responder';

export const responderService = {
  async getActiveResponders(onlineOnly?: boolean) {
    const query: any = {
      role: UserRole.RESPONDER,
      status: UserStatus.ACTIVE,
    };

    // If onlineOnly is requested, show responders who are online OR have any availability enabled
    // This handles legacy data where isOnline might not be set correctly
    if (onlineOnly) {
      query.$or = [
        { isOnline: true },
        { audioEnabled: true },
        { videoEnabled: true },
        { chatEnabled: true },
      ];
    }

    const responders = await User.find(query).select('-password').lean();

    // Transform to include responder-specific data
    const respondersWithData = responders.map(user => {
      // Consider responder online if isOnline is true OR any availability is enabled
      const hasAnyEnabled = user.audioEnabled || user.videoEnabled || user.chatEnabled;
      const effectivelyOnline = user.isOnline || hasAnyEnabled;
      
      return {
        id: (user._id as any).toString(),
        userId: (user._id as any).toString(),
        user: {
          id: (user._id as any).toString(),
          phone: user.phone,
          role: user.role,
          coinBalance: user.coinBalance,
          profile: user.profile,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        responder: {
          id: (user._id as any).toString(),
          userId: (user._id as any).toString(),
          bio: user.profile.bio || null,
          rating: 4.5, // Mock rating - in real app, calculate from reviews
          totalCalls: 0, // Mock data - in real app, count from calls collection
          isOnline: effectivelyOnline,
          audioEnabled: user.audioEnabled !== undefined ? user.audioEnabled : true,
          videoEnabled: user.videoEnabled !== undefined ? user.videoEnabled : true,
          chatEnabled: user.chatEnabled !== undefined ? user.chatEnabled : true,
          inCall: user.inCall || false,
          kycStatus: 'verified', // All active responders are verified
          voiceGender: 'original',
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      };
    });

    return respondersWithData;
  },

  async getResponderById(responderId: string) {
    const user = await User.findById(responderId).select('-password').lean();

    if (!user) {
      throw new AppError(404, 'Responder not found');
    }

    if (user.role !== UserRole.RESPONDER) {
      throw new AppError(400, 'User is not a responder');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError(400, 'Responder is not active');
    }

    // Calculate effectively online - matches getActiveResponders logic
    const hasAnyEnabled = user.audioEnabled || user.videoEnabled || user.chatEnabled;
    const effectivelyOnline = user.isOnline || hasAnyEnabled;

    return {
      id: (user._id as any).toString(),
      userId: (user._id as any).toString(),
      user: {
        id: (user._id as any).toString(),
        phone: user.phone,
        role: user.role,
        coinBalance: user.coinBalance,
        profile: user.profile,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      responder: {
        id: (user._id as any).toString(),
        userId: (user._id as any).toString(),
        bio: user.profile.bio || null,
        rating: 4.5, // Mock rating
        totalCalls: 0, // Mock data
        isOnline: effectivelyOnline,
        audioEnabled: user.audioEnabled !== undefined ? user.audioEnabled : true,
        videoEnabled: user.videoEnabled !== undefined ? user.videoEnabled : true,
        chatEnabled: user.chatEnabled !== undefined ? user.chatEnabled : true,
        inCall: user.inCall || false,
        kycStatus: 'verified',
        voiceGender: 'original',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  },

  async updateResponderStatus(responderId: string, isOnline: boolean, isAvailable?: boolean) {
    const user = await User.findById(responderId);

    if (!user) {
      throw new AppError(404, 'Responder not found');
    }

    if (user.role !== UserRole.RESPONDER) {
      throw new AppError(400, 'User is not a responder');
    }

    // Update online status
    user.isOnline = isOnline;
    if (isAvailable !== undefined) {
      user.isAvailable = isAvailable;
    }
    if (!isOnline) {
      user.lastOnlineAt = new Date();
    }
    await user.save();

    return {
      success: true,
      isOnline: user.isOnline,
      isAvailable: user.isAvailable,
      message: `Status updated to ${isOnline ? 'online' : 'offline'}${isAvailable !== undefined ? ` and ${isAvailable ? 'available' : 'busy'}` : ''}`,
    };
  },

  async updateAvailability(
    responderId: string,
    audioEnabled: boolean,
    videoEnabled: boolean,
    chatEnabled: boolean
  ) {
    const user = await User.findById(responderId);

    if (!user) {
      throw new AppError(404, 'Responder not found');
    }

    if (user.role !== UserRole.RESPONDER) {
      throw new AppError(400, 'User is not a responder');
    }

    // Update availability settings in User model
    user.audioEnabled = audioEnabled;
    user.videoEnabled = videoEnabled;
    user.chatEnabled = chatEnabled;
    
    // Auto-set isOnline based on availability
    // If any option is enabled, responder should be online
    // If all options are disabled, responder goes offline
    const hasAnyEnabled = audioEnabled || videoEnabled || chatEnabled;
    user.isOnline = hasAnyEnabled;
    if (!hasAnyEnabled) {
      user.lastOnlineAt = new Date();
    }
    
    await user.save();

    // Also sync to Responder model to keep both in sync
    await Responder.findOneAndUpdate(
      { userId: responderId },
      {
        audioEnabled,
        videoEnabled,
        chatEnabled,
        isOnline: hasAnyEnabled,
      },
      { upsert: false } // Don't create if missing, lazy creation handles that
    );

    return {
      success: true,
      audioEnabled: user.audioEnabled,
      videoEnabled: user.videoEnabled,
      chatEnabled: user.chatEnabled,
      message: 'Availability settings updated successfully',
    };
  },

  async getMyProfile(responderId: string) {
    const user = await User.findById(responderId).select('-password').lean();

    if (!user) {
      throw new AppError(404, 'Responder not found');
    }

    if (user.role !== UserRole.RESPONDER) {
      throw new AppError(400, 'User is not a responder');
    }

    // Calculate effectively online - consistent with getActiveResponders
    const hasAnyEnabled = user.audioEnabled || user.videoEnabled || user.chatEnabled;
    const effectivelyOnline = user.isOnline || hasAnyEnabled;

    return {
      id: (user._id as any).toString(),
      audioEnabled: user.audioEnabled !== undefined ? user.audioEnabled : false,
      videoEnabled: user.videoEnabled !== undefined ? user.videoEnabled : false,
      chatEnabled: user.chatEnabled !== undefined ? user.chatEnabled : false,
      isOnline: effectivelyOnline,
      inCall: user.inCall || false,
      coinBalance: user.coinBalance,
      profile: user.profile,
    };
  },

  async disableAllAvailability(responderId: string) {
    const user = await User.findById(responderId);

    if (!user) {
      throw new AppError(404, 'Responder not found');
    }

    if (user.role !== UserRole.RESPONDER) {
      throw new AppError(400, 'User is not a responder');
    }

    // Disable all availability options and set offline
    user.audioEnabled = false;
    user.videoEnabled = false;
    user.chatEnabled = false;
    user.isOnline = false;
    user.lastOnlineAt = new Date();
    await user.save();

    // Also sync to Responder model
    await Responder.findOneAndUpdate(
      { userId: responderId },
      {
        audioEnabled: false,
        videoEnabled: false,
        chatEnabled: false,
        isOnline: false,
      },
      { upsert: false }
    );

    return {
      success: true,
      audioEnabled: false,
      videoEnabled: false,
      chatEnabled: false,
      message: 'All availability options disabled',
    };
  },
};
