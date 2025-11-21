import { Types } from 'mongoose';
import { Redemption, RedemptionStatus, IRedemption } from '../models/Redemption';
import { CommissionConfig } from '../models/CommissionConfig';
import { Responder } from '../models/Responder';
import { User } from '../models/User';
import { coinService } from './coinService';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errorHandler';

export class RedemptionService {
  async createRedemptionRequest(userId: string, coinsToRedeem: number, upiId: string) {
    try {
      // Validate user is a responder
      const responder = await Responder.findOne({ userId });
      if (!responder) {
        throw new AppError(403, 'Only responders can redeem coins');
      }

      // Get commission config
      const config = await CommissionConfig.findOne({ isActive: true });
      if (!config) {
        throw new AppError(500, 'Commission configuration not found');
      }

      // Validate minimum redemption amount
      if (coinsToRedeem < config.minimumRedemptionCoins) {
        throw new AppError(400, `Minimum redemption amount is ${config.minimumRedemptionCoins} coins`);
      }

      // Check if responder has enough pending coins
      if (responder.earnings.pendingCoins < coinsToRedeem) {
        throw new AppError(400, 'Insufficient pending coins for redemption');
      }

      // Validate UPI ID format (basic validation)
      if (!this.isValidUpiId(upiId)) {
        throw new AppError(400, 'Invalid UPI ID format');
      }

      // Check for existing pending redemption
      const existingPendingRedemption = await Redemption.findOne({
        userId: new Types.ObjectId(userId),
        status: { $in: [RedemptionStatus.PENDING, RedemptionStatus.IN_PROGRESS] }
      });

      if (existingPendingRedemption) {
        throw new AppError(400, 'You already have a pending redemption request');
      }

      // Calculate INR amount
      const amountINR = coinsToRedeem * config.coinToINRRate;

      // Create redemption request
      const redemption = new Redemption({
        userId: new Types.ObjectId(userId),
        coinsToRedeem,
        amountINR,
        upiId: upiId.trim(),
        status: RedemptionStatus.PENDING,
      });

      await redemption.save();

      // Update responder's pending coins (move to locked state)
      await Responder.findOneAndUpdate(
        { userId },
        { 
          $inc: { 
            'earnings.pendingCoins': -coinsToRedeem,
            'earnings.lockedCoins': coinsToRedeem 
          } 
        }
      );

      logger.info(
        { 
          userId, 
          redemptionId: redemption._id, 
          coinsToRedeem, 
          amountINR 
        },
        'Redemption request created'
      );

      return redemption;
    } catch (error) {
      logger.error({ error, userId, coinsToRedeem }, 'Failed to create redemption request');
      throw error;
    }
  }

  async getRedemptionRequests(userId: string, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;
      
      const redemptions = await Redemption.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('processedBy', 'profile.name');

      const total = await Redemption.countDocuments({ userId });

      return {
        redemptions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get redemption requests');
      throw error;
    }
  }

  // Admin methods
  async getAllRedemptionRequests(
    status?: RedemptionStatus,
    page = 1,
    limit = 20
  ) {
    try {
      const skip = (page - 1) * limit;
      const filter: any = {};
      
      if (status) {
        filter.status = status;
      }

      const redemptions = await Redemption.find(filter)
        .populate('userId', 'profile.name phone')
        .populate('processedBy', 'profile.name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Redemption.countDocuments(filter);

      return {
        redemptions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error({ error, status }, 'Failed to get all redemption requests');
      throw error;
    }
  }

  async updateRedemptionStatus(
    redemptionId: string,
    status: RedemptionStatus,
    adminId: string,
    notes?: string,
    transactionId?: string,
    rejectionReason?: string
  ) {
    try {
      const redemption = await Redemption.findById(redemptionId);
      if (!redemption) {
        throw new AppError(404, 'Redemption request not found');
      }

      // Validate status transition
      if (redemption.status === RedemptionStatus.COMPLETED || 
          redemption.status === RedemptionStatus.REJECTED) {
        throw new AppError(400, 'Cannot update completed or rejected redemption');
      }

      const oldStatus = redemption.status;
      
      // Update redemption
      redemption.status = status;
      redemption.processedBy = new Types.ObjectId(adminId);
      redemption.processedAt = new Date();
      
      if (notes) redemption.adminNotes = notes;
      if (transactionId) redemption.transactionId = transactionId;
      if (rejectionReason) redemption.rejectionReason = rejectionReason;

      await redemption.save();

      // Handle status-specific actions
      await this.handleStatusChange(redemption, oldStatus);

      logger.info(
        { 
          redemptionId, 
          oldStatus, 
          newStatus: status, 
          adminId 
        },
        'Redemption status updated'
      );

      return redemption;
    } catch (error) {
      logger.error({ error, redemptionId, status, adminId }, 'Failed to update redemption status');
      throw error;
    }
  }

  private async handleStatusChange(redemption: IRedemption, oldStatus: RedemptionStatus) {
    const responder = await Responder.findOne({ userId: redemption.userId });
    if (!responder) {
      throw new AppError(404, 'Responder not found');
    }

    switch (redemption.status) {
      case RedemptionStatus.APPROVED:
        // Move coins from locked to redeemed
        await Responder.findOneAndUpdate(
          { userId: redemption.userId },
          { 
            $inc: { 
              'earnings.lockedCoins': -redemption.coinsToRedeem,
              'earnings.redeemedCoins': redemption.coinsToRedeem 
            } 
          }
        );
        break;

      case RedemptionStatus.REJECTED:
        // Move coins back to pending
        await Responder.findOneAndUpdate(
          { userId: redemption.userId },
          { 
            $inc: { 
              'earnings.lockedCoins': -redemption.coinsToRedeem,
              'earnings.pendingCoins': redemption.coinsToRedeem 
            } 
          }
        );
        break;

      case RedemptionStatus.COMPLETED:
        // No coin movement needed, already moved in APPROVED status
        break;
    }
  }

  async getRedemptionStats() {
    try {
      const stats = await Redemption.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amountINR' },
            totalCoins: { $sum: '$coinsToRedeem' }
          }
        }
      ]);

      const totalRequests = await Redemption.countDocuments();
      const totalAmount = await Redemption.aggregate([
        { $group: { _id: null, total: { $sum: '$amountINR' } } }
      ]);

      return {
        totalRequests,
        totalAmount: totalAmount[0]?.total || 0,
        byStatus: stats.reduce((acc: any, stat) => {
          acc[stat._id] = {
            count: stat.count,
            totalAmount: stat.totalAmount,
            totalCoins: stat.totalCoins
          };
          return acc;
        }, {})
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get redemption stats');
      throw error;
    }
  }

  private isValidUpiId(upiId: string): boolean {
    // Basic UPI ID validation: should contain @ and have proper format
    const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/;
    return upiRegex.test(upiId);
  }
}

export const redemptionService = new RedemptionService();
