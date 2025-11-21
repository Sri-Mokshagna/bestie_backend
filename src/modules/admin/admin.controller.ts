import { Request, Response } from 'express';
import { User } from '../../models/User';
import { Call } from '../../models/Call';
import { Transaction } from '../../models/Transaction';
import { Payout } from '../../models/Payout';
import { logger } from '../../lib/logger';

// Get all users
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;

    const query: any = {};
    
    if (search) {
      query.$or = [
        { 'profile.name': { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (role) {
      query.role = role;
    }

    const users = await User.find(query)
      .select('-firebaseUid')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error(error, 'Get all users error');
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// Get user details
export const getUserDetails = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('-firebaseUid');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's call stats
    const callStats = await Call.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          totalDuration: { $sum: '$duration' },
          totalCoinsSpent: { $sum: '$coinsCharged' },
        },
      },
    ]);

    // Get user's transaction stats
    const transactionStats = await Transaction.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalPurchases: {
            $sum: { $cond: [{ $eq: ['$type', 'purchase'] }, '$coins', 0] },
          },
          totalSpent: {
            $sum: { $cond: [{ $eq: ['$type', 'call'] }, '$coins', 0] },
          },
        },
      },
    ]);

    res.json({
      user,
      stats: callStats[0] || {
        totalCalls: 0,
        completedCalls: 0,
        totalDuration: 0,
        totalCoinsSpent: 0,
      },
      transactions: transactionStats[0] || {
        totalPurchases: 0,
        totalSpent: 0,
      },
    });
  } catch (error) {
    logger.error(error, 'Get user details error');
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
};

// Update user status
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (status) {
      user.status = status;
    }

    await user.save();

    res.json({ message: 'User status updated', user });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
};

// Get all responders
export const getAllResponders = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;

    const query: any = { role: 'responder' };

    if (search) {
      query.$or = [
        { 'profile.name': { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const responders = await User.find(query)
      .select('-firebaseUid')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await User.countDocuments(query);

    res.json({
      responders,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error(error, 'Get all responders error');
    res.status(500).json({ error: 'Failed to fetch responders' });
  }
};

// Get responder details
export const getResponderDetails = async (req: Request, res: Response) => {
  try {
    const { responderId } = req.params;

    const responder = await User.findById(responderId).select('-firebaseUid');
    if (!responder || responder.role !== 'responder') {
      return res.status(404).json({ error: 'Responder not found' });
    }

    // Get responder's earnings
    const earnings = await Payout.aggregate([
      { $match: { responder: responder._id } },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: '$coins' },
          totalPaidOut: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amountINR', 0] },
          },
          pendingPayouts: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amountINR', 0] },
          },
        },
      },
    ]);

    // Get responder's call stats
    const callStats = await Call.aggregate([
      { $match: { responder: responder._id } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          totalDuration: { $sum: '$duration' },
          totalCoinsEarned: { $sum: '$coinsCharged' },
        },
      },
    ]);

    res.json({
      responder,
      earnings: earnings[0] || {
        totalEarned: 0,
        totalPaidOut: 0,
        pendingPayouts: 0,
      },
      stats: callStats[0] || {
        totalCalls: 0,
        completedCalls: 0,
        totalDuration: 0,
        totalCoinsEarned: 0,
      },
    });
  } catch (error) {
    logger.error(error, 'Get responder details error');
    res.status(500).json({ error: 'Failed to fetch responder details' });
  }
};

// Get dashboard analytics
export const getDashboardAnalytics = async (req: Request, res: Response) => {
  try {
    // Total users
    const totalUsers = await User.countDocuments({ role: 'user' });
    const activeUsers = await User.countDocuments({ role: 'user', status: 'active' });

    // Total responders
    const totalResponders = await User.countDocuments({ role: 'responder' });
    const onlineResponders = await User.countDocuments({
      role: 'responder',
      isOnline: true,
    });

    // Active calls
    const activeCalls = await Call.countDocuments({ status: 'active' });

    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCalls = await Call.countDocuments({
      createdAt: { $gte: today },
    });

    const todayRevenue = await Call.aggregate([
      { $match: { createdAt: { $gte: today }, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$coinsCharged' } } },
    ]);

    // This week's stats
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weekCalls = await Call.countDocuments({
      createdAt: { $gte: weekAgo },
    });

    const weekRevenue = await Call.aggregate([
      { $match: { createdAt: { $gte: weekAgo }, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$coinsCharged' } } },
    ]);

    // Pending payouts
    const pendingPayouts = await Payout.countDocuments({ status: 'pending' });

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      responders: {
        total: totalResponders,
        online: onlineResponders,
      },
      calls: {
        active: activeCalls,
        today: todayCalls,
        thisWeek: weekCalls,
      },
      revenue: {
        today: todayRevenue[0]?.total || 0,
        thisWeek: weekRevenue[0]?.total || 0,
      },
      payouts: {
        pending: pendingPayouts,
      },
    });
  } catch (error) {
    logger.error(error, 'Get dashboard analytics error');
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

// Get revenue analytics
export const getRevenueAnalytics = async (req: Request, res: Response) => {
  try {
    const { period = 'week' } = req.query;

    let startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const revenueData = await Call.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: 'completed' } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          totalCalls: { $sum: 1 },
          totalRevenue: { $sum: '$coinsCharged' },
          totalDuration: { $sum: '$duration' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ revenueData });
  } catch (error) {
    logger.error(error, 'Get revenue analytics error');
    res.status(500).json({ error: 'Failed to fetch revenue analytics' });
  }
};

// Get commission settings
export const getCommissionSettings = async (req: Request, res: Response) => {
  try {
    // For now, return default settings
    // TODO: Store this in database
    res.json({
      responderCommission: 70, // 70% to responder
      platformCommission: 30, // 30% to platform
      minPayoutCoins: 100,
      coinToINRRate: 1, // 1 coin = 1 INR
    });
  } catch (error) {
    logger.error(error, 'Get commission settings error');
    res.status(500).json({ error: 'Failed to fetch commission settings' });
  }
};

// Update commission settings
export const updateCommissionSettings = async (req: Request, res: Response) => {
  try {
    const { responderCommission, platformCommission, minPayoutCoins, coinToINRRate } = req.body;

    // Validate
    if (responderCommission + platformCommission !== 100) {
      return res.status(400).json({ error: 'Commission percentages must add up to 100' });
    }

    // TODO: Store in database
    // For now, just return success
    res.json({
      message: 'Commission settings updated',
      settings: {
        responderCommission,
        platformCommission,
        minPayoutCoins,
        coinToINRRate,
      },
    });
  } catch (error) {
    logger.error(error, 'Update commission settings error');
    res.status(500).json({ error: 'Failed to update commission settings' });
  }
};
