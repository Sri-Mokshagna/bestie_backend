import crypto from 'crypto';
import { logger } from './logger';

interface ZegoTokenConfig {
  appId: number;
  serverSecret: string;
  userId: string;
  roomId: string;
  expireTimeInSeconds?: number;
}

/**
 * Generate ZEGO authentication token
 * Based on ZEGO's official token generation algorithm
 */
export function generateZegoToken(config: ZegoTokenConfig): string {
  try {
    const {
      appId,
      serverSecret,
      userId,
      roomId,
      expireTimeInSeconds = 3600 // 1 hour default
    } = config;

    // Current timestamp in seconds
    const currentTime = Math.floor(Date.now() / 1000);
    const expireTime = currentTime + expireTimeInSeconds;

    // Create payload
    const payload = {
      iss: appId,
      exp: expireTime,
      iat: currentTime,
      aud: 'zego',
      jti: crypto.randomBytes(16).toString('hex'),
      // ZEGO specific claims
      room_id: roomId,
      user_id: userId,
      privilege: {
        1: 1, // Login room
        2: 1, // Publish stream
      }
    };

    // Create JWT header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    // Encode header and payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // Create signature
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto
      .createHmac('sha256', serverSecret)
      .update(signatureInput)
      .digest('base64url');

    const token = `${encodedHeader}.${encodedPayload}.${signature}`;

    logger.info({
      userId,
      roomId,
      expireTime: new Date(expireTime * 1000).toISOString()
    }, 'ZEGO token generated');

    return token;

  } catch (error) {
    logger.error({ error, config: { ...config, serverSecret: '***' } }, 'Failed to generate ZEGO token');
    throw new Error('Token generation failed');
  }
}

/**
 * Validate ZEGO token (basic validation)
 */
export function validateZegoToken(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const currentTime = Math.floor(Date.now() / 1000);

    // Check if token is expired
    if (payload.exp && payload.exp < currentTime) {
      logger.warn({ exp: payload.exp, currentTime }, 'ZEGO token expired');
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ error }, 'ZEGO token validation failed');
    return false;
  }
}

/**
 * Get ZEGO configuration from environment
 */
export function getZegoConfig() {
  const appId = process.env.ZEGO_APP_ID;
  const serverSecret = process.env.ZEGO_SERVER_SECRET;

  if (!appId || !serverSecret) {
    throw new Error('ZEGO_APP_ID and ZEGO_SERVER_SECRET must be configured');
  }

  return {
    appId: parseInt(appId, 10),
    serverSecret
  };
}
