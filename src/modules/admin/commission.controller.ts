import { Request, Response } from 'express';
import { CommissionConfig } from '../../models/CommissionConfig';
import { logger } from '../../lib/logger';
import { AppError } from '../../middleware/errorHandler';
import { commissionService } from '../../services/commissionService';

export class CommissionController {
  async getCommissionConfig(req: Request, res: Response) {
    try {
      let config = await CommissionConfig.findOne({ isActive: true });

      // Create default config if none exists
      if (!config) {
        config = await CommissionConfig.create({
          responderCommissionPercentage: 50,
          adminCommissionPercentage: 50,
          coinToINRRate: 0.1,
          minimumRedemptionCoins: 100,
          isActive: true,
        });
      }

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get commission config');
      throw error;
    }
  }

  async updateCommissionConfig(req: Request, res: Response) {
    try {
      const {
        responderCommissionPercentage,
        adminCommissionPercentage,
        coinToINRRate,
        audioCallCoinToInrRate,
        videoCallCoinToInrRate,
        minimumRedemptionCoins,
      } = req.body;

      // Validate percentages add up to 100
      // Validate ranges
      if (responderCommissionPercentage < 0 || responderCommissionPercentage > 100) {
        throw new AppError(400, 'Responder commission percentage must be between 0 and 100');
      }

      if (coinToINRRate <= 0) {
        throw new AppError(400, 'Coin to INR rate must be greater than 0');
      }

      if (minimumRedemptionCoins <= 0) {
        throw new AppError(400, 'Minimum redemption coins must be greater than 0');
      }

      // Deactivate current config
      await CommissionConfig.updateMany({ isActive: true }, { isActive: false });

      // Create new config
      const newConfig = await CommissionConfig.create({
        responderCommissionPercentage,
        adminCommissionPercentage,
        coinToINRRate,
        minimumRedemptionCoins,
        isActive: true,
      });

      logger.info(
        {
          adminId: req.user!.id,
          newConfig: {
            responderCommissionPercentage,
            adminCommissionPercentage,
            coinToINRRate,
            minimumRedemptionCoins,
          }
        },
        'Commission config updated'
      );

      // CRITICAL: Clear commission cache so new settings apply immediately
      commissionService.clearConfigCache();
      logger.info({ adminId: req.user!.id }, 'Commission cache cleared - new settings will apply to next transaction');

      res.json({
        success: true,
        data: newConfig,
      });
    } catch (error) {
      logger.error({ error, body: req.body, adminId: req.user?.id }, 'Failed to update commission config');
      throw error;
    }
  }

  async getCommissionHistory(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const configs = await CommissionConfig.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await CommissionConfig.countDocuments();

      res.json({
        success: true,
        data: {
          configs,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get commission history');
      throw error;
    }
  }
}

export const commissionController = new CommissionController();
