import { Request, Response } from 'express';
import { redemptionService } from '../../services/redemptionService';
import { RedemptionStatus } from '../../models/Redemption';
import { logger } from '../../lib/logger';
import { AppError } from '../../middleware/errorHandler';

export class RedemptionController {
  // Responder methods
  async createRedemptionRequest(req: Request, res: Response) {
    try {
      const { coinsToRedeem, upiId } = req.body;
      const userId = req.user!.id;

      if (!coinsToRedeem || !upiId) {
        throw new AppError(400, 'Coins to redeem and UPI ID are required');
      }

      if (coinsToRedeem <= 0) {
        throw new AppError(400, 'Coins to redeem must be greater than 0');
      }

      const redemption = await redemptionService.createRedemptionRequest(
        userId,
        coinsToRedeem,
        upiId
      );

      res.json({
        success: true,
        data: redemption,
      });
    } catch (error) {
      logger.error({ error, userId: req.user?.id, body: req.body }, 'Failed to create redemption request');
      throw error;
    }
  }

  async getMyRedemptions(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const result = await redemptionService.getRedemptionRequests(userId, page, limit);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error({ error, userId: req.user?.id }, 'Failed to get redemption requests');
      throw error;
    }
  }

  // Admin methods
  async getAllRedemptions(req: Request, res: Response) {
    try {
      const status = req.query.status as RedemptionStatus;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await redemptionService.getAllRedemptionRequests(status, page, limit);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error({ error, query: req.query }, 'Failed to get all redemption requests');
      throw error;
    }
  }

  async updateRedemptionStatus(req: Request, res: Response) {
    try {
      const { redemptionId } = req.params;
      const { status, notes, transactionId, rejectionReason } = req.body;
      const adminId = req.user!.id;

      if (!status) {
        throw new AppError(400, 'Status is required');
      }

      if (!Object.values(RedemptionStatus).includes(status)) {
        throw new AppError(400, 'Invalid status');
      }

      if (status === RedemptionStatus.REJECTED && !rejectionReason) {
        throw new AppError(400, 'Rejection reason is required when rejecting');
      }

      if (status === RedemptionStatus.COMPLETED && !transactionId) {
        throw new AppError(400, 'Transaction ID is required when marking as completed');
      }

      const redemption = await redemptionService.updateRedemptionStatus(
        redemptionId,
        status,
        adminId,
        notes,
        transactionId,
        rejectionReason
      );

      res.json({
        success: true,
        data: redemption,
      });
    } catch (error) {
      logger.error(
        { 
          error, 
          redemptionId: req.params.redemptionId, 
          adminId: req.user?.id, 
          body: req.body 
        }, 
        'Failed to update redemption status'
      );
      throw error;
    }
  }

  async getRedemptionStats(req: Request, res: Response) {
    try {
      const stats = await redemptionService.getRedemptionStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get redemption stats');
      throw error;
    }
  }
}

export const redemptionController = new RedemptionController();
