import { CommissionConfig } from '../models/CommissionConfig';
import { logger } from '../lib/logger';

/**
 * Centralized Commission Config Service with caching
 * Reduces database queries for commission lookups
 */
class CommissionService {
  private static instance: CommissionService;
  private cachedConfig: any = null;
  private configCacheTime: number = 0;
  private readonly CACHE_TTL = 300000; // 5 minute cache (config rarely changes)

  private constructor() {}

  static getInstance(): CommissionService {
    if (!CommissionService.instance) {
      CommissionService.instance = new CommissionService();
    }
    return CommissionService.instance;
  }

  /**
   * Get active commission configuration with caching
   */
  async getConfig() {
    const now = Date.now();
    if (this.cachedConfig && now - this.configCacheTime < this.CACHE_TTL) {
      return this.cachedConfig;
    }

    let config = await CommissionConfig.findOne({ isActive: true }).lean();

    // Create default config if none exists
    if (!config) {
      logger.warn('No active commission config found, creating default');
      const newConfig = await CommissionConfig.create({
        responderCommissionPercentage: 60,
        adminCommissionPercentage: 40,
        coinToINRRate: 0.1,
        minimumRedemptionCoins: 100,
        isActive: true,
      });
      config = newConfig.toObject();
    }

    this.cachedConfig = config;
    this.configCacheTime = now;
    return config;
  }

  /**
   * Get responder commission percentage
   */
  async getResponderPercentage(): Promise<number> {
    const config = await this.getConfig();
    return config.responderCommissionPercentage;
  }

  /**
   * Get coin to INR conversion rate
   */
  async getCoinToINRRate(): Promise<number> {
    const config = await this.getConfig();
    return config.coinToINRRate;
  }

  /**
   * Get minimum redemption coins
   */
  async getMinimumRedemptionCoins(): Promise<number> {
    const config = await this.getConfig();
    return config.minimumRedemptionCoins;
  }

  /**
   * Clear config cache (call after admin updates)
   */
  clearConfigCache() {
    this.cachedConfig = null;
    this.configCacheTime = 0;
    logger.info('Commission config cache cleared');
  }
}

export const commissionService = CommissionService.getInstance();
