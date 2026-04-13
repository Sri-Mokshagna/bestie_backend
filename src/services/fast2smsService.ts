import crypto from 'crypto';
import axios from 'axios';

// Fast2SMS credentials — set this as an environment variable on Render
// Get your key from: https://www.fast2sms.com/dashboard/dev-api
const API_KEY = process.env.FAST2SMS_API_KEY ?? '';

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_LENGTH = 6;

interface OtpEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
}

// In-memory OTP store: phone → { otp, expiresAt, attempts }
// NOTE: This is process-local. If you scale to multiple server instances,
// replace this Map with a Redis-backed store.
const otpStore = new Map<string, OtpEntry>();

/**
 * Fast2SMS OTP Service
 *
 * Fast2SMS does NOT provide a server-side OTP verification endpoint.
 * OTPs are generated here, stored in-memory with a TTL, and verified locally.
 *
 * Required env var:
 *   FAST2SMS_API_KEY  =  <your key from fast2sms.com/dashboard/dev-api>
 *
 * Fast2SMS account prerequisites:
 *   - KYC completed (Aadhaar verified)
 *   - Minimum ₹100 credit balance
 *   - OTP route enabled
 */
export const fast2smsService = {
  /**
   * Generate a 6-digit OTP, store it, and send it via Fast2SMS.
   * @param phone E.164 format, e.g. +919876543210
   */
  async sendOtp(phone: string): Promise<void> {
    if (!API_KEY) throw new Error('FAST2SMS_API_KEY environment variable is not set');

    // Strip leading +91 / + to get bare 10-digit number
    const mobile = phone.replace(/^\+91/, '').replace(/^\+/, '');
    if (!/^\d{10}$/.test(mobile)) {
      throw new Error(`Invalid Indian mobile number: ${mobile}`);
    }

    // Generate cryptographically random OTP
    const otp = crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();

    // Store with TTL and reset attempt counter
    otpStore.set(phone, {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0,
    });

    console.log(`📱 [Fast2SMS] Sending OTP to: ${mobile} | key_len=${API_KEY.length} key_prefix=${API_KEY.substring(0, 8)}`);

    let res: any;
    try {
      res = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
        params: {
          authorization: API_KEY,   // some endpoints need it as query param too
          variables_values: otp,
          route: 'otp',
          numbers: mobile,
        },
        headers: {
          authorization: API_KEY,
        },
        timeout: 10000,
      });
    } catch (err: any) {
      // Log the full Fast2SMS error body for easier debugging
      const body = err.response?.data;
      console.error(`❌ [Fast2SMS] HTTP ${err.response?.status} error:`, JSON.stringify(body));
      throw new Error(`Fast2SMS request failed (${err.response?.status}): ${JSON.stringify(body)}`);
    }

    console.log(`📱 [Fast2SMS] Send OTP response:`, JSON.stringify(res.data));

    if (!res.data?.return) {
      throw new Error(`Fast2SMS sendOtp failed: ${JSON.stringify(res.data)}`);
    }

    console.log(`✅ [Fast2SMS] OTP sent successfully to ${mobile}`);
  },

  /**
   * Verify OTP entered by user against the stored OTP.
   * Returns true if valid, false otherwise.
   * OTP is deleted from store on success or after 5 failed attempts.
   */
  verifyOtp(phone: string, otp: string): boolean {
    const entry = otpStore.get(phone);

    if (!entry) {
      console.warn(`⚠️ [Fast2SMS] No OTP found for: ${phone}`);
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(phone);
      console.warn(`⚠️ [Fast2SMS] OTP expired for: ${phone}`);
      return false;
    }

    entry.attempts += 1;

    const isValid = entry.otp === otp.trim();

    if (isValid) {
      otpStore.delete(phone);
      console.log(`✅ [Fast2SMS] OTP verified for: ${phone}`);
    } else {
      console.warn(`❌ [Fast2SMS] Invalid OTP for: ${phone} (attempt ${entry.attempts})`);
      // Invalidate after 5 failed attempts to prevent brute-force
      if (entry.attempts >= 5) {
        otpStore.delete(phone);
        console.warn(`🚫 [Fast2SMS] OTP invalidated after 5 failed attempts for: ${phone}`);
      }
    }

    return isValid;
  },
};
