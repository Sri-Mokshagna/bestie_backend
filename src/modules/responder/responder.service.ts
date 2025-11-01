import { User, UserRole, UserStatus } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';

export const responderService = {
  async getActiveResponders(onlineOnly?: boolean) {
    const query: any = {
      role: UserRole.RESPONDER,
      status: UserStatus.ACTIVE,
    };

    // For now, we'll simulate online status since we don't have real-time tracking
    // In a real app, you'd track online status with socket connections or heartbeat
    
    const responders = await User.find(query).select('-password');
    
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
        bio: user.profile.bio || null,
        rating: 4.5, // Mock rating - in real app, calculate from reviews
        totalCalls: 0, // Mock data - in real app, count from calls collection
        isOnline: user.isOnline || false,
        isAvailable: user.isAvailable !== undefined ? user.isAvailable : true,
        specializations: [], // Mock data - in real app, store in responder profile
        languages: ['English'], // Mock data
        experience: '1 year', // Mock data
        responseTime: '< 5 min', // Mock data
        availability: {
          monday: { start: '09:00', end: '17:00' },
          tuesday: { start: '09:00', end: '17:00' },
          wednesday: { start: '09:00', end: '17:00' },
          thursday: { start: '09:00', end: '17:00' },
          friday: { start: '09:00', end: '17:00' },
          saturday: { start: '10:00', end: '16:00' },
          sunday: { start: '10:00', end: '16:00' },
        },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    }));

    // Filter by online status if requested
    if (onlineOnly) {
      return respondersWithData.filter(r => r.responder.isOnline);
    }

    return respondersWithData;
  },

  async getResponderById(responderId: string) {
    const user = await User.findById(responderId).select('-password');
    
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
        bio: user.profile.bio || null,
        rating: 4.5, // Mock rating
        totalCalls: 0, // Mock data
        isOnline: user.isOnline || false,
        isAvailable: user.isAvailable !== undefined ? user.isAvailable : true,
        specializations: [], // Mock data
        languages: ['English'], // Mock data
        experience: '1 year', // Mock data
        responseTime: '< 5 min', // Mock data
        availability: {
          monday: { start: '09:00', end: '17:00' },
          tuesday: { start: '09:00', end: '17:00' },
          wednesday: { start: '09:00', end: '17:00' },
          thursday: { start: '09:00', end: '17:00' },
          friday: { start: '09:00', end: '17:00' },
          saturday: { start: '10:00', end: '16:00' },
          sunday: { start: '10:00', end: '16:00' },
        },
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

    // Update online status and availability
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
};
