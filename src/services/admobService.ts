import axios from 'axios';
import { logger } from '../lib/logger';
import { User } from '../models/User';
import { Transaction, TransactionType, TransactionStatus } from '../models/Transaction';
import { coinService } from './coinService';
import mongoose from 'mongoose';

/**
 * AdMob Server-Side Verification (SSV) Service
 * Verifies rewarded ad views and credits coins to users
 */

interface AdMobSSVPayload {
  ad_network: string;
  ad_unit: string;
  reward_amount: number;
  reward_item: string;
  timestamp: string;
  transaction_id: string;
  user_id: string;
  signature: string;
  key_id: string;
}

interface AdRewardConfig {
  rewardedVideoCoins: number;
  interstitialCoins: number;
  bannerClickCoins: number;
  enabled: boolean;
}

export class AdMobService {
  private static instance: AdMobService;
  
  // Default reward configuration
  private rewardConfig: AdRewardConfig = {
    rewardedVideoCoins: 5, // 5 coins per rewarded video
    interstitialCoins: 1, // 1 coin per interstitial
    bannerClickCoins: 0, // No coins for banner clicks
    enabled: true,
  };

  private constructor() {
    // Load config from environment
    this.rewardConfig.rewardedVideoCoins = parseInt(
      process.env.ADMOB_REWARDED_VIDEO_COINS || '5'
    );
    this.rewardConfig.interstitialCoins = parseInt(
      process.env.ADMOB_INTERSTITIAL_COINS || '1'
    );
    this.rewardConfig.enabled = process.env.ADMOB_REWARDS_ENABLED !== 'false';
  }

  static getInstance(): AdMobService {
    if (!AdMobService.instance) {
      AdMobService.instance = new AdMobService();
    }
    return AdMobService.instance;
  }

  /**
   * Get current reward configuration
   */
  getRewardConfig(): AdRewardConfig {
    return { ...this.rewardConfig };
  }

  /**
   * Update reward configuration (admin only)
   */
  updateRewardConfig(config: Partial<AdRewardConfig>): void {
    this.rewardConfig = {
      ...this.rewardConfig,
      ...config,
    };
    logger.info({ msg: 'AdMob reward config updated', config: this.rewardConfig });
  }

  /**
   * Verify AdMob SSV callback
   * Google sends this when user completes a rewarded ad
   */
  async verifySSVCallback(payload: AdMobSSVPayload): Promise<boolean> {
    try {
      // Verify signature using Google's public key
      // In production, implement proper signature verification
      // For now, we'll do basic validation
      
      if (!payload.user_id || !payload.transaction_id || !payload.reward_amount) {
        logger.warn({ msg: 'Invalid SSV payload', payload });
        return false;
      }

      // Check if transaction already processed (prevent duplicates)
      const existingTransaction = await Transaction.findOne({
        'meta.adTransactionId': payload.transaction_id,
      });

      if (existingTransaction) {
        logger.warn({
          msg: 'Duplicate ad transaction',
          transactionId: payload.transaction_id,
        });
        return false;
      }

      logger.info({
        msg: 'AdMob SSV verified',
        userId: payload.user_id,
        rewardAmount: payload.reward_amount,
        transactionId: payload.transaction_id,
      });

      return true;
    } catch (error) {
      logger.error({ msg: 'AdMob SSV verification failed', error });
      return false;
    }
  }

  /**
   * Credit coins for rewarded video ad
   */
  async creditRewardedVideo(
    userId: string,
    adUnitId: string,
    transactionId?: string
  ): Promise<{ success: boolean; coins: number; balance: number }> {
    if (!this.rewardConfig.enabled) {
      throw new Error('Ad rewards are currently disabled');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Verify user exists
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new Error('User not found');
      }

      const coins = this.rewardConfig.rewardedVideoCoins;

      // Credit coins
      user.coinBalance += coins;
      await user.save({ session });

      // Create transaction record
      await Transaction.create(
        [
          {
            userId,
            type: TransactionType.AD_REWARD,
            coins,
            status: TransactionStatus.COMPLETED,
            meta: {
              adType: 'rewarded_video',
              adUnitId,
              adTransactionId: transactionId || `ad_${Date.now()}`,
              timestamp: new Date(),
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();

      logger.info({
        msg: 'Rewarded video coins credited',
        userId,
        coins,
        newBalance: user.coinBalance,
      });

      return {
        success: true,
        coins,
        balance: user.coinBalance,
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error({ msg: 'Failed to credit rewarded video', error, userId });
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Credit coins for interstitial ad
   */
  async creditInterstitial(
    userId: string,
    adUnitId: string
  ): Promise<{ success: boolean; coins: number; balance: number }> {
    if (!this.rewardConfig.enabled || this.rewardConfig.interstitialCoins === 0) {
      return { success: false, coins: 0, balance: 0 };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new Error('User not found');
      }

      const coins = this.rewardConfig.interstitialCoins;

      user.coinBalance += coins;
      await user.save({ session });

      await Transaction.create(
        [
          {
            userId,
            type: TransactionType.AD_REWARD,
            coins,
            status: TransactionStatus.COMPLETED,
            meta: {
              adType: 'interstitial',
              adUnitId,
              timestamp: new Date(),
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();

      logger.info({
        msg: 'Interstitial coins credited',
        userId,
        coins,
        newBalance: user.coinBalance,
      });

      return {
        success: true,
        coins,
        balance: user.coinBalance,
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error({ msg: 'Failed to credit interstitial', error, userId });
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get user's ad reward history
   */
  async getAdRewardHistory(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({
      userId,
      type: TransactionType.AD_REWARD,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Transaction.countDocuments({
      userId,
      type: TransactionType.AD_REWARD,
    });

    return {
      transactions: transactions.map((t) => ({
        id: t._id.toString(),
        coins: t.coins,
        adType: t.meta?.adType || 'unknown',
        timestamp: t.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get ad reward statistics for user
   */
  async getAdRewardStats(userId: string): Promise<any> {
    const stats = await Transaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          type: TransactionType.AD_REWARD,
        },
      },
      {
        $group: {
          _id: '$meta.adType',
          totalCoins: { $sum: '$coins' },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalCoins = stats.reduce((sum, stat) => sum + stat.totalCoins, 0);
    const totalAds = stats.reduce((sum, stat) => sum + stat.count, 0);

    return {
      totalCoinsEarned: totalCoins,
      totalAdsWatched: totalAds,
      byType: stats.map((stat) => ({
        type: stat._id || 'unknown',
        coins: stat.totalCoins,
        count: stat.count,
      })),
      config: this.getRewardConfig(),
    };
  }

  /**
   * Check if user can watch ad (rate limiting)
   */
  async canWatchAd(userId: string, adType: 'rewarded_video' | 'interstitial'): Promise<{
    canWatch: boolean;
    reason?: string;
    nextAvailableAt?: Date;
  }> {
    // Implement rate limiting
    // For example: max 10 rewarded videos per day
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCount = await Transaction.countDocuments({
      userId,
      type: TransactionType.AD_REWARD,
      'meta.adType': adType,
      createdAt: { $gte: today },
    });

    const maxPerDay = adType === 'rewarded_video' ? 10 : 50;

    if (todayCount >= maxPerDay) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      return {
        canWatch: false,
        reason: `Daily limit reached (${maxPerDay} ${adType}s per day)`,
        nextAvailableAt: tomorrow,
      };
    }

    return {
      canWatch: true,
    };
  }
}

export const admobService = AdMobService.getInstance();
