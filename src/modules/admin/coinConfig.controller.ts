import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { CoinConfig } from '../../models/CoinConfig';
import { coinService } from '../../services/coinService';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';

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
