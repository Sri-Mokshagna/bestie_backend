import { User } from '../models/User';
import { Responder } from '../models/Responder';
import { CoinConfig } from '../models/CoinConfig';
import { Transaction, TransactionType, TransactionStatus } from '../models/Transaction';
import { AppError } from '../middleware/errorHandler';
import { mongoose } from '../lib/db';
import { logger } from '../lib/logger';
import { commissionService } from './commissionService';

/**
 * Centralized Coin Service
 * Handles all coin-related operations with proper transaction management
 */

export class CoinService {
  private static instance: CoinService;
  private cachedConfig: any = null;
  private configCacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute cache

  private constructor() { }

  static getInstance(): CoinService {
    if (!CoinService.instance) {
      CoinService.instance = new CoinService();
    }
    return CoinService.instance;
  }

  /**
   * Get active coin configuration with caching
   */
  async getConfig() {
    const now = Date.now();
    if (this.cachedConfig && now - this.configCacheTime < this.CACHE_TTL) {
      return this.cachedConfig;
    }

    let config = await CoinConfig.findOne({ isActive: true });

    // Create default config if none exists
    if (!config) {
      logger.warn('No active coin config found, creating default');
      config = await CoinConfig.create({
        chatCoinsPerMessage: 2, // Changed from 3
        audioCallCoinsPerMinute: 10,
        videoCallCoinsPerMinute: 50, // Changed from 60
        initialUserCoins: 10,
        responderMinRedeemCoins: 5,
        responderCommissionPercentage: 70,
        coinsToINRRate: 1,
        chatEnabled: true,
        audioCallEnabled: true,
        videoCallEnabled: true,
        isActive: true,
      });
    }

    this.cachedConfig = config;
    this.configCacheTime = now;
    return config;
  }

  /**
   * Clear config cache (call after admin updates)
   */
  clearConfigCache() {
    this.cachedConfig = null;
    this.configCacheTime = 0;
  }

  /**
   * Check if user has sufficient coins
   */
  async checkBalance(userId: string, requiredCoins: number): Promise<boolean> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }
    // Total spendable = ad coins (priority) + regular coins
    return (user.coinBalance + (user.adCoinBalance || 0)) >= requiredCoins;
  }

  /**
   * Get user's current coin balance
   */
  async getBalance(userId: string): Promise<number> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }
    // Return combined balance (ad coins + regular coins)
    return (user.coinBalance || 0) + (user.adCoinBalance || 0);
  }

  /**
   * Deduct coins from user for chat message
   * Returns updated balance
   * NOTE: Only users are charged for chat messages, not responders
   */
  async deductForChat(
    senderId: string,
    recipientId: string,
    chatId: string
  ): Promise<{ balance: number; coinsDeducted: number }> {
    // CRITICAL: Get config BEFORE starting transaction
    const config = await this.getConfig();

    if (!config.chatEnabled) {
      throw new AppError(403, 'Chat feature is currently disabled');
    }

    const coinsToDeduct = config.chatCoinsPerMessage;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Determine who is sending
      const sender = await User.findById(senderId).select('role coinBalance').session(session);

      if (!sender) {
        throw new AppError(404, 'Sender not found');
      }

      // IMPORTANT: Only charge when USER sends message
      // If RESPONDER sends message, it's FREE (no charge to user)
      if (sender.role === 'responder') {
        await session.commitTransaction();
        logger.info({
          msg: 'Responder message - no charge',
          senderId,
          recipientId,
          chatId,
        });
        return {
          balance: 0, // Not applicable for responder
          coinsDeducted: 0, // No coins deducted
        };
      }

      // Sender is a USER - proceed with charging
      const recipient = await User.findById(recipientId).select('role').session(session);

      if (!recipient) {
        throw new AppError(404, 'Recipient not found');
      }

      // Verify recipient is a responder
      if (recipient.role !== 'responder') {
        throw new AppError(400, 'Can only send paid messages to responders');
      }

      const actualUserId = senderId;
      const actualResponderId = recipientId;
      const user = sender;

      // Total spendable = ad coins (priority bucket) + regular coins
      const adCoins = user.adCoinBalance || 0;
      const totalBalance = user.coinBalance + adCoins;

      if (totalBalance < coinsToDeduct) {
        throw new AppError(400, 'Insufficient coins', 'INSUFFICIENT_COINS');
      }

      // Compute split: drain adCoinBalance first, then coinBalance
      const fromAdCoins = Math.min(adCoins, coinsToDeduct);
      const fromRegularCoins = coinsToDeduct - fromAdCoins;

      // Build atomic update — only include fields that actually change
      const incUpdate: Record<string, number> = {};
      if (fromAdCoins > 0) incUpdate['adCoinBalance'] = -fromAdCoins;
      if (fromRegularCoins > 0) incUpdate['coinBalance'] = -fromRegularCoins;

      // CRITICAL: atomic update with balance guard to prevent race conditions
      const updateResult = await User.updateOne(
        {
          _id: actualUserId,
          coinBalance: { $gte: fromRegularCoins },
          ...(fromAdCoins > 0 ? { adCoinBalance: { $gte: fromAdCoins } } : {}),
        },
        { $inc: incUpdate },
        { session }
      );

      if (updateResult.modifiedCount === 0) {
        logger.error({
          msg: 'Race condition detected: Balance insufficient during transaction',
          userId: actualUserId,
          adCoins,
          coinBalance: user.coinBalance,
          coinsToDeduct,
        });
        throw new AppError(400, 'Insufficient coins', 'INSUFFICIENT_COINS');
      }

      logger.info({
        chatId,
        userId: actualUserId,
        responderId: actualResponderId,
        coinsDeducted: coinsToDeduct,
        fromAdCoins,
        fromRegularCoins,
      }, '💬 Chat coins deducted (ad coins first)');

      // Create transaction record
      await Transaction.create(
        [
          {
            userId: actualUserId,
            responderId: actualResponderId,
            type: TransactionType.CHAT,
            coins: coinsToDeduct,
            responderEarnings: 0,
            status: TransactionStatus.COMPLETED,
            meta: {
              chatId,
              senderId,
              fromAdCoins,
              fromRegularCoins,
              note: 'Ad coins used first, then regular coins',
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();

      const newAdCoins = adCoins - fromAdCoins;
      const newCoinBalance = user.coinBalance - fromRegularCoins;
      const newTotalBalance = newCoinBalance + newAdCoins;

      logger.info({
        msg: 'Chat coins deducted',
        senderId,
        recipientId,
        coins: coinsToDeduct,
        fromAdCoins,
        fromRegularCoins,
        newAdCoins,
        newCoinBalance,
        newTotalBalance,
      });

      return {
        balance: newTotalBalance,
        coinsDeducted: coinsToDeduct,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Deduct coins for call (per tick/minute)
   * Returns updated balance and whether call should continue
   */
  async deductForCall(
    callId: string,
    userId: string,
    responderId: string,
    callType: 'audio' | 'video',
    durationSeconds: number
  ): Promise<{ balance: number; coinsDeducted: number; shouldContinue: boolean }> {
    // CRITICAL: Get config and commission BEFORE starting transaction
    const [config, responderPercentage] = await Promise.all([
      this.getConfig(),
      commissionService.getResponderPercentage(),
    ]);

    // Check if call type is enabled
    if (callType === 'audio' && !config.audioCallEnabled) {
      throw new AppError(403, 'Audio calls are currently disabled');
    }
    if (callType === 'video' && !config.videoCallEnabled) {
      throw new AppError(403, 'Video calls are currently disabled');
    }

    const rate =
      callType === 'audio'
        ? config.audioCallCoinsPerMinute
        : config.videoCallCoinsPerMinute;

    const coinsPerSecond = rate / 60;
    const coinsToDeduct = Math.ceil(coinsPerSecond * durationSeconds);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new AppError(404, 'User not found');
      }

      // Check if user has enough coins
      if (user.coinBalance < coinsToDeduct) {
        await session.abortTransaction();
        return {
          balance: user.coinBalance,
          coinsDeducted: 0,
          shouldContinue: false,
        };
      }

      // Deduct from user
      await User.findByIdAndUpdate(
        userId,
        { $inc: { coinBalance: -coinsToDeduct } },
        { session }
      );

      // Credit responder
      // Commission percentage already fetched BEFORE transaction
      // Use Math.round() for fair distribution with small amounts
      const responderCoins = Math.round(
        (coinsToDeduct * responderPercentage) / 100
      );

      await Responder.findOneAndUpdate(
        { userId: responderId },
        {
          $inc: {
            'earnings.totalCoins': responderCoins,
            'earnings.pendingCoins': responderCoins
          }
        },
        { session }
      );

      // Create transaction
      await Transaction.create(
        [
          {
            userId,
            responderId,
            type: TransactionType.CALL,
            coins: -coinsToDeduct,
            status: TransactionStatus.COMPLETED,
            meta: {
              callId,
              callType,
              durationSeconds,
              responderEarned: responderCoins
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();

      const newBalance = user.coinBalance - coinsToDeduct;

      logger.info({
        msg: 'Call coins deducted',
        userId,
        responderId,
        callType,
        coins: coinsToDeduct,
        newBalance,
      });

      return {
        balance: newBalance,
        coinsDeducted: coinsToDeduct,
        shouldContinue: true,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Credit coins to user (for purchases, gifts, etc.)
   */
  async creditCoins(
    userId: string,
    coins: number,
    type: TransactionType,
    meta?: Record<string, any>
  ): Promise<number> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { coinBalance: coins } },
        { new: true, session }
      );

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      await Transaction.create(
        [
          {
            userId,
            type,
            coins,
            status: TransactionStatus.COMPLETED,
            meta,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      logger.info({
        msg: 'Coins credited',
        userId,
        coins,
        type,
        newBalance: user.coinBalance,
      });

      return user.coinBalance;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Initialize new user with default coins
   */
  async initializeUserCoins(userId: string): Promise<number> {
    const config = await this.getConfig();

    if (config.initialUserCoins > 0) {
      return await this.creditCoins(
        userId,
        config.initialUserCoins,
        TransactionType.GIFT,
        { reason: 'initial_signup_bonus' }
      );
    }

    return 0;
  }

  /**
   * Check if responder can redeem coins
   */
  async canRedeem(responderId: string): Promise<{ canRedeem: boolean; pendingCoins: number; minRequired: number }> {
    // Get minimum redemption from CommissionConfig (admin-controlled)
    const { commissionService } = await import('./commissionService');
    const minRequired = await commissionService.getMinimumRedemptionCoins();

    const responder = await Responder.findOne({ userId: responderId });

    if (!responder) {
      throw new AppError(404, 'Responder not found');
    }

    return {
      canRedeem: responder.earnings.pendingRupees >= minRequired,
      pendingCoins: responder.earnings.pendingRupees, // Return rupees (keeping field name for compatibility)
      minRequired: minRequired,
    };
  }

  /**
   * Calculate INR amount for coin redemption
   */
  async calculateRedemptionAmount(coins: number): Promise<number> {
    // Use CommissionConfig for redemption rate (admin-controlled)
    const { commissionService } = await import('./commissionService');
    const rate = await commissionService.getCoinToINRRate();
    return coins * rate;
  }

  /**
   * Get call rate for display
   */
  async getCallRate(callType: 'audio' | 'video'): Promise<number> {
    const config = await this.getConfig();
    return callType === 'audio'
      ? config.audioCallCoinsPerMinute
      : config.videoCallCoinsPerMinute;
  }

  /**
   * Check if feature is enabled
   */
  async isFeatureEnabled(feature: 'chat' | 'audioCall' | 'videoCall'): Promise<boolean> {
    const config = await this.getConfig();
    switch (feature) {
      case 'chat':
        return config.chatEnabled;
      case 'audioCall':
        return config.audioCallEnabled;
      case 'videoCall':
        return config.videoCallEnabled;
      default:
        return false;
    }
  }
}

export const coinService = CoinService.getInstance();
