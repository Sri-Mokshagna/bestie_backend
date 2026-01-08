import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { CoinConfig } from '../../models/CoinConfig';
import { CoinPlan, PlanTag } from '../../models/CoinPlan';
import { coinService } from '../../services/coinService';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';
import { logger } from '../../lib/logger';

/**
 * Admin Controller for Coin Configuration
 */

export const getCoinConfig = asyncHandler(async (req: AuthRequest, res: Response) => {
  const config = await coinService.getConfig();
  
  res.json({
    config: {
      id: config._id,
      chatCoinsPerMessage: config.chatCoinsPerMessage,
      audioCallCoinsPerMinute: config.audioCallCoinsPerMinute,
      videoCallCoinsPerMinute: config.videoCallCoinsPerMinute,
      initialUserCoins: config.initialUserCoins,
      responderMinRedeemCoins: config.responderMinRedeemCoins,
      responderCommissionPercentage: config.responderCommissionPercentage,
      coinsToINRRate: config.coinsToINRRate,
      chatEnabled: config.chatEnabled,
      audioCallEnabled: config.audioCallEnabled,
      videoCallEnabled: config.videoCallEnabled,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    },
  });
});

export const updateCoinConfig = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    chatCoinsPerMessage,
    audioCallCoinsPerMinute,
    videoCallCoinsPerMinute,
    initialUserCoins,
    responderMinRedeemCoins,
    responderCommissionPercentage,
    coinsToINRRate,
    chatEnabled,
    audioCallEnabled,
    videoCallEnabled,
  } = req.body;

  // Validate inputs
  if (chatCoinsPerMessage !== undefined && chatCoinsPerMessage < 0) {
    throw new AppError(400, 'Chat coins per message must be non-negative');
  }
  if (audioCallCoinsPerMinute !== undefined && audioCallCoinsPerMinute < 0) {
    throw new AppError(400, 'Audio call coins per minute must be non-negative');
  }
  if (videoCallCoinsPerMinute !== undefined && videoCallCoinsPerMinute < 0) {
    throw new AppError(400, 'Video call coins per minute must be non-negative');
  }
  if (initialUserCoins !== undefined && initialUserCoins < 0) {
    throw new AppError(400, 'Initial user coins must be non-negative');
  }
  if (responderMinRedeemCoins !== undefined && responderMinRedeemCoins < 0) {
    throw new AppError(400, 'Minimum redeem coins must be non-negative');
  }
  if (
    responderCommissionPercentage !== undefined &&
    (responderCommissionPercentage < 0 || responderCommissionPercentage > 100)
  ) {
    throw new AppError(400, 'Commission percentage must be between 0 and 100');
  }
  if (coinsToINRRate !== undefined && coinsToINRRate < 0) {
    throw new AppError(400, 'Coins to INR rate must be non-negative');
  }

  // Get current active config
  let config = await CoinConfig.findOne({ isActive: true });

  if (!config) {
    // Create new config if none exists
    config = new CoinConfig({
      chatCoinsPerMessage: chatCoinsPerMessage ?? 3,
      audioCallCoinsPerMinute: audioCallCoinsPerMinute ?? 10,
      videoCallCoinsPerMinute: videoCallCoinsPerMinute ?? 60,
      initialUserCoins: initialUserCoins ?? 10,
      responderMinRedeemCoins: responderMinRedeemCoins ?? 100,
      responderCommissionPercentage: responderCommissionPercentage ?? 70,
      coinsToINRRate: coinsToINRRate ?? 1,
      chatEnabled: chatEnabled ?? true,
      audioCallEnabled: audioCallEnabled ?? true,
      videoCallEnabled: videoCallEnabled ?? true,
      isActive: true,
      createdBy: req.user?.id,
    });
  } else {
    // Update existing config
    if (chatCoinsPerMessage !== undefined) config.chatCoinsPerMessage = chatCoinsPerMessage;
    if (audioCallCoinsPerMinute !== undefined) config.audioCallCoinsPerMinute = audioCallCoinsPerMinute;
    if (videoCallCoinsPerMinute !== undefined) config.videoCallCoinsPerMinute = videoCallCoinsPerMinute;
    if (initialUserCoins !== undefined) config.initialUserCoins = initialUserCoins;
    if (responderMinRedeemCoins !== undefined) config.responderMinRedeemCoins = responderMinRedeemCoins;
    if (responderCommissionPercentage !== undefined) config.responderCommissionPercentage = responderCommissionPercentage;
    if (coinsToINRRate !== undefined) config.coinsToINRRate = coinsToINRRate;
    if (chatEnabled !== undefined) config.chatEnabled = chatEnabled;
    if (audioCallEnabled !== undefined) config.audioCallEnabled = audioCallEnabled;
    if (videoCallEnabled !== undefined) config.videoCallEnabled = videoCallEnabled;
  }

  await config.save();

  // Clear cache
  coinService.clearConfigCache();

  res.json({
    message: 'Coin configuration updated successfully',
    config: {
      id: config._id,
      chatCoinsPerMessage: config.chatCoinsPerMessage,
      audioCallCoinsPerMinute: config.audioCallCoinsPerMinute,
      videoCallCoinsPerMinute: config.videoCallCoinsPerMinute,
      initialUserCoins: config.initialUserCoins,
      responderMinRedeemCoins: config.responderMinRedeemCoins,
      responderCommissionPercentage: config.responderCommissionPercentage,
      coinsToINRRate: config.coinsToINRRate,
      chatEnabled: config.chatEnabled,
      audioCallEnabled: config.audioCallEnabled,
      videoCallEnabled: config.videoCallEnabled,
      updatedAt: config.updatedAt,
    },
  });
});

// ===== CoinPlan CRUD =====

// Get all coin plans (for admin)
export const getCoinPlans = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { includeInactive } = req.query;
  
  const query = includeInactive === 'true' ? {} : { isActive: true };
  const plans = await CoinPlan.find(query).sort({ priceINR: 1 }).lean();
  
  res.json({ plans });
});

// Create new coin plan
export const createCoinPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, priceINR, coins, tags, maxUses, discount, isActive } = req.body;
  
  if (!name || priceINR === undefined || coins === undefined) {
    throw new AppError(400, 'Name, priceINR, and coins are required');
  }
  
  // Validate tags
  if (tags) {
    const validTags = Object.values(PlanTag);
    for (const tag of tags) {
      if (!validTags.includes(tag)) {
        throw new AppError(400, `Invalid tag: ${tag}`);
      }
    }
  }
  
  const plan = await CoinPlan.create({
    name,
    priceINR,
    coins,
    tags: tags || [PlanTag.UNLIMITED],
    maxUses,
    discount,
    isActive: isActive !== false,
  });
  
  logger.info({ adminId: req.user?.id, planId: plan._id }, 'Coin plan created');
  
  res.status(201).json({ message: 'Coin plan created', plan });
});

// Update coin plan
export const updateCoinPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { planId } = req.params;
  const { name, priceINR, coins, tags, maxUses, discount, isActive } = req.body;
  
  const plan = await CoinPlan.findById(planId);
  if (!plan) {
    throw new AppError(404, 'Coin plan not found');
  }
  
  // Update fields if provided
  if (name !== undefined) plan.name = name;
  if (priceINR !== undefined) plan.priceINR = priceINR;
  if (coins !== undefined) plan.coins = coins;
  if (tags !== undefined) plan.tags = tags;
  if (maxUses !== undefined) plan.maxUses = maxUses;
  if (discount !== undefined) plan.discount = discount;
  if (isActive !== undefined) plan.isActive = isActive;
  
  await plan.save();
  
  logger.info({ adminId: req.user?.id, planId: plan._id }, 'Coin plan updated');
  
  res.json({ message: 'Coin plan updated', plan });
});

// Delete coin plan (soft delete - just deactivate)
export const deleteCoinPlan = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { planId } = req.params;
  
  const plan = await CoinPlan.findByIdAndUpdate(
    planId,
    { isActive: false },
    { new: true }
  );
  
  if (!plan) {
    throw new AppError(404, 'Coin plan not found');
  }
  
  logger.info({ adminId: req.user?.id, planId: plan._id }, 'Coin plan deactivated');
  
  res.json({ message: 'Coin plan deactivated', plan });
});
