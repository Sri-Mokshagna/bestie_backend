import { User, UserRole, UserStatus } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';

export const responderService = {
  async getActiveResponders(onlineOnly?: boolean) {
    const query: any = {
      role: UserRole.RESPONDER,
      status: UserStatus.ACTIVE,
    };

    // If onlineOnly is requested, add online filter
    if (onlineOnly) {
      query.isOnline = true;
    }

    const responders = await User.find(query).select('-password').lean();

    // Transform to include responder-specific data
    const respondersWithData = responders.map(user => ({
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
        isOnline: user.isOnline || false,
        audioEnabled: user.audioEnabled !== undefined ? user.audioEnabled : true,
        videoEnabled: user.videoEnabled !== undefined ? user.videoEnabled : true,
        chatEnabled: user.chatEnabled !== undefined ? user.chatEnabled : true,
        inCall: user.inCall || false,
        kycStatus: 'verified', // All active responders are verified
        voiceGender: 'original',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    }));

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
        isOnline: user.isOnline || false,
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

    // Update availability settings
    user.audioEnabled = audioEnabled;
    user.videoEnabled = videoEnabled;
    user.chatEnabled = chatEnabled;
    await user.save();

    return {
      success: true,
      audioEnabled: user.audioEnabled,
      videoEnabled: user.videoEnabled,
      chatEnabled: user.chatEnabled,
      message: 'Availability settings updated successfully',
    };
  },
};
