import { Request, Response } from 'express';
import { User } from '../../models/User';

// Get notification preferences
export const getNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    const user = await User.findById(userId).select('notificationPreferences');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return default preferences if not set
    const preferences = user.notificationPreferences || {
      pushEnabled: true,
      emailEnabled: false,
      smsEnabled: false,
      callNotifications: true,
      chatNotifications: true,
      payoutNotifications: true,
      promotionNotifications: true,
      systemNotifications: true,
    };

    res.json({ preferences });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
};

// Update notification preferences
export const updateNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const preferences = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update preferences
    user.notificationPreferences = {
      ...user.notificationPreferences,
      ...preferences,
    };

    await user.save();

    res.json({ 
      message: 'Notification preferences updated',
      preferences: user.notificationPreferences 
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
};
