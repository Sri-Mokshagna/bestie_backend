import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { admobService } from '../../services/admobService';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';

/**
 * Get AdMob reward configuration
 */
export const getRewardConfig = asyncHandler(async (req: AuthRequest, res: Response) => {
  const config = admobService.getRewardConfig();
  res.json({ config });
});

/**
 * Update AdMob reward configuration (Admin only)
 */
export const updateRewardConfig = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { rewardedVideoCoins, interstitialCoins, bannerClickCoins, enabled } = req.body;

  admobService.updateRewardConfig({
    rewardedVideoCoins,
    interstitialCoins,
    bannerClickCoins,
    enabled,
  });

  res.json({
    message: 'AdMob reward configuration updated successfully',
    config: admobService.getRewardConfig(),
  });
});

/**
 * Credit coins for rewarded video ad
 */
export const creditRewardedVideo = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { adUnitId, transactionId } = req.body;

  if (!adUnitId) {
    throw new AppError(400, 'Ad unit ID is required');
  }

  // Check if user can watch ad
  const canWatch = await admobService.canWatchAd(req.user.id, 'rewarded_video');
  if (!canWatch.canWatch) {
    throw new AppError(429, canWatch.reason || 'Cannot watch ad at this time', 'AD_LIMIT_REACHED');
  }

  const result = await admobService.creditRewardedVideo(
    req.user.id,
    adUnitId,
    transactionId
  );

  res.json({
    message: 'Coins credited successfully',
    ...result,
  });
});

/**
 * Credit coins for interstitial ad
 */
export const creditInterstitial = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { adUnitId } = req.body;

  if (!adUnitId) {
    throw new AppError(400, 'Ad unit ID is required');
  }

  // Check if user can watch ad
  const canWatch = await admobService.canWatchAd(req.user.id, 'interstitial');
  if (!canWatch.canWatch) {
    throw new AppError(429, canWatch.reason || 'Cannot watch ad at this time', 'AD_LIMIT_REACHED');
  }

  const result = await admobService.creditInterstitial(req.user.id, adUnitId);

  if (!result.success) {
    throw new AppError(400, 'Interstitial rewards are not enabled');
  }

  res.json({
    message: 'Coins credited successfully',
    ...result,
  });
});

/**
 * Get ad reward history
 */
export const getAdRewardHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const history = await admobService.getAdRewardHistory(req.user.id, page, limit);

  res.json(history);
});

/**
 * Get ad reward statistics
 */
export const getAdRewardStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const stats = await admobService.getAdRewardStats(req.user.id);

  res.json(stats);
});

/**
 * Check if user can watch ad
 */
export const checkCanWatchAd = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const { adType } = req.query;

  if (!adType || !['rewarded_video', 'interstitial'].includes(adType as string)) {
    throw new AppError(400, 'Valid ad type is required (rewarded_video or interstitial)');
  }

  const result = await admobService.canWatchAd(
    req.user.id,
    adType as 'rewarded_video' | 'interstitial'
  );

  res.json(result);
});

/**
 * AdMob Server-Side Verification (SSV) webhook
 * Called by Google AdMob when user completes a rewarded ad
 */
export const ssvWebhook = asyncHandler(async (req: AuthRequest, res: Response) => {
  const payload = req.query;

  // Verify SSV signature
  const isValid = await admobService.verifySSVCallback(payload as any);

  if (!isValid) {
    throw new AppError(400, 'Invalid SSV signature');
  }

  // Credit coins
  const userId = payload.user_id as string;
  const transactionId = payload.transaction_id as string;
  const adUnitId = payload.ad_unit as string;

  await admobService.creditRewardedVideo(userId, adUnitId, transactionId);

  // Google expects 200 OK response
  res.status(200).send('OK');
});
