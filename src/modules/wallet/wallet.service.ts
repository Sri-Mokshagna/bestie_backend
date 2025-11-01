import { User } from '../../models/User';
import { Transaction, TransactionType, TransactionStatus } from '../../models/Transaction';
import { CoinPlan } from '../../models/CoinPlan';
import { AppError } from '../../middleware/errorHandler';
import { mongoose } from '../../lib/db';

export const walletService = {
  async getBalance(userId: string) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }
    return user.coinBalance;
  },

  async getTransactions(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('responderId', 'userId')
      .lean();

    const total = await Transaction.countDocuments({ userId });

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  },

  async getCoinPlans() {
    const plans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });
    return plans;
  },

  async creditCoins(
    userId: string,
    coins: number,
    type: TransactionType,
    meta?: Record<string, any>
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update user balance
      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: { coinBalance: coins } },
        { new: true, session }
      );

      if (!user) {
        throw new AppError(404, 'User not found');
      }

      // Create transaction record
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
      return user.coinBalance;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  },

  async deductCoins(
    userId: string,
    coins: number,
    type: TransactionType,
    responderId?: string,
    meta?: Record<string, any>
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Check balance
      const user = await User.findById(userId).session(session);
      if (!user) {
        throw new AppError(404, 'User not found');
      }

      if (user.coinBalance < coins) {
        throw new AppError(400, 'Insufficient coin balance');
      }

      // Deduct from user
      await User.findByIdAndUpdate(
        userId,
        { $inc: { coinBalance: -coins } },
        { session }
      );

      // Create transaction
      await Transaction.create(
        [
          {
            userId,
            responderId,
            type,
            coins: -coins,
            status: TransactionStatus.COMPLETED,
            meta,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return user.coinBalance - coins;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  },

  async verifyIAPPurchase(
    userId: string,
    productId: string,
    purchaseToken: string,
    platform: 'android' | 'ios'
  ) {
    // TODO: Implement actual receipt verification with Google/Apple APIs
    // For now, this is a placeholder

    // Find the coin plan by productId
    const plan = await CoinPlan.findOne({ _id: productId, isActive: true });
    if (!plan) {
      throw new AppError(404, 'Coin plan not found');
    }

    // Credit coins
    const newBalance = await this.creditCoins(
      userId,
      plan.coins,
      TransactionType.PURCHASE,
      {
        productId,
        purchaseToken,
        platform,
        priceINR: plan.priceINR,
      }
    );

    return { newBalance, coinsAdded: plan.coins };
  },

  async verifyAdReward(
    userId: string,
    rewardType: string,
    rewardAmount: number,
    adUnitId: string
  ) {
    // TODO: Implement AdMob SSV verification
    // For now, credit the reward

    const newBalance = await this.creditCoins(
      userId,
      rewardAmount,
      TransactionType.AD_REWARD,
      {
        rewardType,
        adUnitId,
      }
    );

    return { newBalance, coinsAdded: rewardAmount };
  },
};
